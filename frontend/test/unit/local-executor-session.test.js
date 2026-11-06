import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalExecutorSession} from '../../src/shared/local-executor/session.js';

const connection = {url: 'http://127.0.0.1:32100', token: 'a'.repeat(43)};
const info = {protocol_version: 1, runtime: 'python', platform: 'linux', shell: 'sh', default_cwd: '/tmp/project'};
const response = (data, status = 200) => ({ok: status === 200, status, json: async () => data});

test('场景：会话隔离阻止其他 AI 会话读取或取消任务，凭据不进入展示状态', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push({url, options});
        if (url.endsWith('/info')) return response(info);
        const task = JSON.parse(options.body || '{}');
        return response({id: task.id, status: 'running', cursor: 0, output: '', cwd: info.default_cwd, has_more: false});
    };
    const session = createLocalExecutorSession();
    try {
        await session.connect(connection);
        const result = await session.execute({command: 'pwd', wait_seconds: 0}, {sessionId: 'a'});
        await assert.rejects(session.read(result.task_id, 0, {sessionId: 'b'}), /does not belong/);
        await assert.rejects(session.cancel(result.task_id, {sessionId: 'b'}), /does not belong/);
        assert.equal(requests.length, 2);
        assert.ok(!JSON.stringify(session.state).includes(connection.token));
        session.disconnect({cancel: false});
        assert.equal(session.state.whitelistText, '');
    } finally { session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：连接断开后迟到的握手响应不能恢复连接', async () => {
    const originalFetch = globalThis.fetch;
    let finish;
    globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
    const session = createLocalExecutorSession();
    try {
        const connecting = session.connect(connection);
        session.disconnect();
        finish(response(info));
        await connecting;
        assert.equal(session.state.connected, false);
        assert.equal(session.state.info, null);
    } finally { session.dispose(); globalThis.fetch = originalFetch; }
});

test('场景：明确拒绝的提交不被标为已运行，也不自动重试', async () => {
    const originalFetch = globalThis.fetch;
    let submissions = 0;
    globalThis.fetch = async (url) => {
        if (url.endsWith('/info')) return response(info);
        submissions++;
        return response({error: 'Connection is no longer authorized'}, 403);
    };
    const session = createLocalExecutorSession();
    try {
        await session.connect(connection);
        await assert.rejects(session.execute({command: 'pwd'}, {sessionId: 'a'}), /no longer authorized/);
        assert.equal(session.state.tasks[0].status, 'failed');
        assert.equal(submissions, 1);
    } finally { session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：提交响应丢失时保留任务编号，不自动重跑或取消命令', async () => {
    const originalFetch = globalThis.fetch;
    const requested = [];
    globalThis.fetch = async (url) => {
        requested.push(url);
        if (url.endsWith('/info')) return response(info);
        throw new TypeError('模拟连接中断');
    };
    const session = createLocalExecutorSession();
    try {
        await session.connect(connection);
        const result = await session.execute({command: 'pwd'}, {sessionId: 'a'});
        assert.equal(result.status, 'unknown');
        assert.equal(result.task_id, session.state.tasks[0].id);
        assert.equal(requested.length, 2);
        assert.ok(!requested.some((url) => url.endsWith('/cancel')));
    } finally { session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：临时断线保留白名单和免审批配置，无法连接时禁止执行', async () => {
    const originalFetch = globalThis.fetch;
    let online = true;
    globalThis.fetch = async () => { if (!online) throw new TypeError('模拟服务关闭'); return response(info); };
    const session = createLocalExecutorSession({heartbeatMs: 0});
    const waitFor = async (predicate) => {
        const deadline = Date.now() + 4000;
        while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
        assert.ok(predicate());
    };
    try {
        await session.connect(connection);
        session.state.whitelistText = 'pwd';
        session.state.autoApprove = true;
        online = false;
        await waitFor(() => !session.state.reachable);
        assert.equal(session.state.whitelistText, 'pwd');
        assert.equal(session.state.autoApprove, true);
        await assert.rejects(session.execute({command: 'pwd'}, {sessionId: 'a'}), /not connected/);
        online = true;
        await waitFor(() => session.state.reachable);
        assert.equal(session.state.whitelistText, 'pwd');
        assert.equal(session.state.autoApprove, true);
    } finally { session.dispose(); globalThis.fetch = originalFetch; }
});

test('场景：任务使用用户选择的 Shell，显式选择会覆盖默认值并拒绝不可用 Shell', async () => {
    const originalFetch = globalThis.fetch;
    const submissions = [];
    globalThis.fetch = async (url, options) => {
        if (url.endsWith('/info')) return response({...info, shell: 'powershell', shells: ['powershell', 'cmd']});
        const task = JSON.parse(options.body);
        submissions.push(task);
        return response({...task, status: 'completed', cursor: 0, output: '', has_more: false});
    };
    const session = createLocalExecutorSession();
    try {
        await session.connect(connection);
        session.state.shell = 'cmd';
        await session.execute({command: 'echo hello'}, {sessionId: 'a'});
        await session.execute({command: 'Write-Output hello', shell: 'powershell'}, {sessionId: 'a'});
        await assert.rejects(session.execute({command: 'pwd', shell: 'sh'}, {sessionId: 'a'}), /unavailable/);
        assert.deepEqual(submissions.map((task) => task.shell), ['cmd', 'powershell']);
    } finally { session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：默认等待短任务完成，合并多页输出并返回真实退出码和原始游标', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    let id;
    let reads = 0;
    globalThis.fetch = async (url, options) => {
        requests.push({url, options});
        if (url.endsWith('/info')) return response(info);
        if (options.method === 'POST') {
            const body = JSON.parse(options.body);
            id = body.id;
            assert.equal('wait_seconds' in body, false);
            return response({id, status: 'running', output: '开始\n', cursor: 4, has_more: false});
        }
        reads++;
        return response({id, status: 'failed', output: reads === 1 ? '执行输出\n' : '错误原因\n', cursor: reads === 1 ? 10 : 17, has_more: reads === 1, exit_code: 7});
    };
    const completed = [];
    const session = createLocalExecutorSession({onFinished: (task) => completed.push(task.id)});
    try {
        await session.connect(connection);
        const result = await session.execute({command: '运行并返回错误'}, {sessionId: 'a'});
        assert.equal(result.status, 'failed');
        assert.equal(result.exit_code, 7);
        assert.equal(result.output, '开始\n执行输出\n错误原因\n');
        assert.equal(result.has_more, false);
        assert.equal(result.cursor, 17);
        assert.equal(requests.filter((item) => item.options.method === 'POST').length, 1);
        assert.ok(requests[2].url.endsWith('?cursor=4'));
        assert.ok(requests[3].url.endsWith('?cursor=10'));
        assert.deepEqual(completed, [id]);
    } finally { session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：等待窗口结束只返回任务编号，不取消命令，之后仍能读取执行结果', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    let id;
    let complete = false;
    globalThis.fetch = async (url, options) => {
        requests.push({url, options});
        if (url.endsWith('/info')) return response(info);
        if (options.method === 'POST') id = JSON.parse(options.body).id;
        return response({id, status: complete ? 'completed' : 'running', output: complete ? '完成' : '', cursor: complete ? 2 : 0, has_more: false, exit_code: complete ? 0 : null});
    };
    const session = createLocalExecutorSession();
    try {
        await session.connect(connection);
        const result = await session.execute({command: '长任务', wait_seconds: 1}, {sessionId: 'a'});
        assert.equal(result.status, 'running');
        assert.equal(result.task_id, id);
        assert.equal(requests.filter((item) => item.options.method === 'POST').length, 1);
        complete = true;
        const finished = await session.read(id, result.cursor, {sessionId: 'a'});
        assert.equal(finished.output, '完成');
        assert.equal(finished.exit_code, 0);
        assert.ok(!requests.some((item) => item.url.endsWith('/cancel')));
    } finally { session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：用户停止正在同步等待的调用时请求取消，已经取消的调用不会提交任务', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    let id;
    globalThis.fetch = async (url, options) => {
        requests.push(url);
        if (url.endsWith('/info')) return response(info);
        if (url.endsWith('/tasks')) id = JSON.parse(options.body).id;
        return response({id, status: 'running', output: '', cursor: 0, has_more: false});
    };
    const controller = new AbortController();
    const session = createLocalExecutorSession();
    let timer;
    try {
        await session.connect(connection);
        const running = session.execute({command: '长任务'}, {sessionId: 'a'}, controller.signal);
        timer = setTimeout(() => controller.abort(new Error('用户停止')), 20);
        await assert.rejects(running, /用户停止/);
        assert.equal(requests.filter((url) => url.endsWith('/cancel')).length, 1);
        await assert.rejects(session.execute({command: '不应提交'}, {sessionId: 'a'}, controller.signal), /用户停止/);
        assert.equal(requests.filter((url) => url.endsWith('/tasks')).length, 1);
    } finally { clearTimeout(timer); session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：主动断开连接会结束同步等待，取消请求仅发送一次', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push(url);
        if (url.endsWith('/info')) return response(info);
        return response({id: JSON.parse(options.body).id, status: 'running', output: '', cursor: 0, has_more: false});
    };
    const session = createLocalExecutorSession();
    let timer;
    try {
        await session.connect(connection);
        const running = session.execute({command: '长任务'}, {sessionId: 'a'});
        timer = setTimeout(() => session.disconnect(), 20);
        await assert.rejects(running, /Connection changed/);
        assert.equal(requests.filter((url) => url.endsWith('/cancel')).length, 1);
    } finally { clearTimeout(timer); session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：等待期间读取失败保留任务编号，不重新提交也不自动取消', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push(url);
        if (url.endsWith('/info')) return response(info);
        if (url.endsWith('/tasks')) return response({id: JSON.parse(options.body).id, status: 'running', output: '已开始', cursor: 3, has_more: false});
        throw new TypeError('连接暂时中断');
    };
    const session = createLocalExecutorSession();
    try {
        await session.connect(connection);
        const result = await session.execute({command: '运行一次'}, {sessionId: 'a'});
        assert.equal(result.status, 'unknown');
        assert.equal(result.task_id, session.state.tasks[0].id);
        assert.equal(result.output, '已开始');
        assert.match(result.error, /Cannot reach/);
        assert.equal(requests.filter((url) => url.endsWith('/tasks')).length, 1);
        assert.ok(!requests.some((url) => url.endsWith('/cancel')));
    } finally { session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：同步结果超过前端输出缓存时明确标记截断并保留可继续读取的游标', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
        if (url.endsWith('/info')) return response(info);
        return response({id: JSON.parse(options.body).id, status: 'completed', output: '字'.repeat(100005), cursor: 200010, has_more: false, exit_code: 0});
    };
    const session = createLocalExecutorSession();
    try {
        await session.connect(connection);
        const result = await session.execute({command: '大量输出'}, {sessionId: 'a'});
        assert.equal(result.output.length, 100000);
        assert.equal(result.truncated, true);
        assert.equal(result.output_lost, true);
        assert.equal(result.cursor, 200010);
    } finally { session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：连接之间的白名单和免审批设置相互独立，切换连接后不会继承上一条授权', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => response(info);
    const first = createLocalExecutorSession();
    const second = createLocalExecutorSession();
    try {
        await assert.rejects(first.execute({command: 'pwd'}, {sessionId: 'a'}), /not connected/);
        await first.connect(connection);
        await second.connect({...connection, url: 'http://127.0.0.1:32101', token: 'b'.repeat(43)});
        assert.equal(first.state.autoApprove, false);
        first.state.autoApprove = true;
        first.state.whitelistText = 'pwd\nls';
        second.state.whitelistText = 'Get-Location';
        assert.equal(first.state.whitelistText, 'pwd\nls');
        assert.equal(second.state.whitelistText, 'Get-Location');
        assert.equal(second.state.autoApprove, false);
        first.disconnect({cancel: false});
        assert.equal(first.state.autoApprove, false);
        await first.connect({...connection, url: 'http://127.0.0.1:32102', token: 'c'.repeat(43)});
        assert.equal(first.state.whitelistText, '');
        assert.equal(first.state.autoApprove, false);
        assert.equal(second.state.whitelistText, 'Get-Location');
    } finally { first.dispose(); second.dispose(); globalThis.fetch = originalFetch; }
});
