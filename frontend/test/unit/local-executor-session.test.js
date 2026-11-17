import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalExecutorSession} from '../../src/shared/local-executor/session.js';

const connection = {url: 'http://127.0.0.1:32100', token: 'a'.repeat(43)};
const info = {protocol_version: 2, runtime: 'python', platform: 'linux', shell: 'sh', default_cwd: '/tmp/project'};
const response = (data, status = 200) => ({ok: status === 200, status, json: async () => data});

test('场景：会话隔离阻止其他 AI 会话读取或取消任务，凭据不进入展示状态', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, options) => {
        requests.push({url, options});
        if (url.endsWith('/info')) return response(info);
        const task = JSON.parse(options.body || '{}');
        return response({lifecycle: 'task', id: task.id, status: 'running', cursor: 0, output: '', cwd: info.default_cwd, has_more: false});
    };
    const session = createLocalExecutorSession();
    try {
        await session.connect(connection);
        const result = await session.execute({command: 'pwd', reason: '确认命令工作目录', wait_seconds: 0}, {sessionId: 'a'});
        assert.equal(session.state.tasks[0].reason, '确认命令工作目录');
        assert.equal(JSON.parse(requests[1].options.body).reason, undefined);
        await assert.rejects(session.read(result.task_id, 0, {sessionId: 'b'}), /does not belong/);
        await assert.rejects(session.cancel(result.task_id, {sessionId: 'b'}), /does not belong/);
        assert.equal(requests.length, 3);
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
        const denied = await session.execute({command: 'pwd'}, {sessionId: 'a'});
        assert.equal(denied.status, 'failed');
        assert.equal(denied.execution_state, 'not_started');
        assert.match(denied.error, /no longer authorized/);
        assert.ok(denied.summary.includes(denied.task_id));
        assert.ok(denied.summary.includes(connection.url));
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
        if (options.method !== 'POST') return response({...submissions.at(-1), status: 'completed', cursor: 0, output: '', has_more: false});
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

test('场景：同步返回指定长度的首段，AI 游标独立于页面轮询并可继续读取', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    let id;
    const text = '开始\n中文😀错误原因\n';
    globalThis.fetch = async (url, options) => {
        requests.push({url, options});
        if (url.endsWith('/info')) return response(info);
        if (options.method === 'POST') {
            id = JSON.parse(options.body).id;
            return response({lifecycle: 'task', id, status: 'running', output: '', cursor: 0, has_more: false});
        }
        const query = new URL(url).searchParams;
        const start = Number(query.get('cursor'));
        const output = Array.from(text.slice(start)).slice(0, Number(query.get('max_chars'))).join('');
        const cursor = start + output.length;
        return response({lifecycle: 'task', id, status: 'failed', output, cursor, has_more: cursor < text.length, exit_code: 7, decoding_loss: true});
    };
    const session = createLocalExecutorSession();
    try {
        await session.connect(connection);
        const first = await session.execute({command: '运行并返回错误', max_chars: 4}, {sessionId: 'a'});
        assert.equal(first.status, 'failed');
        assert.equal(first.exit_code, 7);
        assert.equal(first.decoding_loss, true);
        assert.equal(first.output, '开始\n中');
        assert.equal(first.has_more, true);
        const tail = await session.read(id, first.cursor, {sessionId: 'a'}, undefined, 20);
        assert.equal(first.output + tail.output, text);
        assert.equal(tail.has_more, false);
        assert.equal(requests.filter((item) => item.options.method === 'POST').length, 1);
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
        return response({lifecycle: 'task', id, status: complete ? 'completed' : 'running', output: complete ? '完成' : '', cursor: complete ? 2 : 0, has_more: false, exit_code: complete ? 0 : null});
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
        return response({lifecycle: 'task', id, status: 'running', output: '', cursor: 0, has_more: false});
    };
    const controller = new AbortController();
    const session = createLocalExecutorSession();
    let timer;
    try {
        await session.connect(connection);
        const running = session.execute({command: '长任务'}, {sessionId: 'a'}, controller.signal);
        timer = setTimeout(() => controller.abort(new Error('用户停止')), 20);
        const result = await running;
        assert.equal(result.task_id, id);
        assert.equal(result.status, 'running');
        assert.equal(result.interrupted, true);
        assert.equal(result.cancel_requested, true);
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
        return response({lifecycle: 'task', id: JSON.parse(options.body).id, status: 'running', output: '', cursor: 0, has_more: false});
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
        if (url.endsWith('/tasks')) return response({lifecycle: 'task', id: JSON.parse(options.body).id, status: 'running', output: '已开始', cursor: 3, has_more: false});
        throw new TypeError('连接暂时中断');
    };
    const session = createLocalExecutorSession();
    try {
        await session.connect(connection);
        const result = await session.execute({command: '运行一次'}, {sessionId: 'a'});
        assert.equal(result.status, 'unknown');
        assert.equal(result.task_id, session.state.tasks[0].id);
        assert.equal(result.output, undefined);
        assert.equal(result.output_unavailable, true);
        assert.equal(result.cursor, undefined);
        assert.doesNotMatch(result.summary, /cursor=/);
        assert.match(result.error, /Cannot reach/);
        assert.equal(requests.filter((url) => url.endsWith('/tasks')).length, 1);
        assert.ok(!requests.some((url) => url.endsWith('/cancel')));
    } finally { session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：页面尾缓存裁剪后，AI 仍从执行端读取完整结果且不继承页面损失标记', async () => {
    const originalFetch = globalThis.fetch;
    const text = '开头😀' + '字'.repeat(120000) + '结束';
    let id;
    globalThis.fetch = async (url, options) => {
        if (url.endsWith('/info')) return response(info);
        if (options.method === 'POST') {
            id = JSON.parse(options.body).id;
            return response({lifecycle: 'task', id, status: 'running', output: '', cursor: 0, has_more: false});
        }
        const query = new URL(url).searchParams;
        const start = Number(query.get('cursor'));
        const output = Array.from(text.slice(start)).slice(0, Number(query.get('max_chars'))).join('');
        const cursor = start + output.length;
        // 让后台轮询实际累积超过页面容量，再完成任务。
        return response({lifecycle: 'task', id, status: cursor >= text.length ? 'completed' : 'running', output, cursor, has_more: cursor < text.length, truncated: false, output_lost: false, exit_code: 0});
    };
    const session = createLocalExecutorSession();
    try {
        await session.connect(connection);
        const result = await session.execute({command: '输出长文本', max_chars: 20000}, {sessionId: 'a'});
        assert.equal(session.state.tasks[0].output_lost, true);
        assert.ok(session.state.tasks[0].output.length <= 100000);
        assert.equal(result.output_lost, false);
        assert.equal(result.truncated, false);
        let all = result.output;
        let page = result;
        while (page.has_more) {
            page = await session.read(id, page.cursor, {sessionId: 'a'}, undefined, 20000);
            all += page.output;
        }
        assert.equal(all, text);
    } finally { session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：执行端滚动丢失标记原样交付 AI，后续从返回游标读取', async () => {
    const originalFetch = globalThis.fetch;
    let id;
    globalThis.fetch = async (url, options) => {
        if (url.endsWith('/info')) return response(info);
        if (options.method === 'POST') {
            id = JSON.parse(options.body).id;
            return response({lifecycle: 'task', id, status: 'running', output: '旧输出', cursor: 3, has_more: false});
        }
        const cursor = Number(new URL(url).searchParams.get('cursor'));
        return response(cursor < 300006
            ? {id, status: 'completed', output: '保留片段\n', cursor: 300006, has_more: true, output_lost: true, truncated: true, exit_code: 0}
            : {id, status: 'completed', output: '末尾中文😀', cursor: 300012, has_more: false, output_lost: false, truncated: true, exit_code: 0});
    };
    const session = createLocalExecutorSession();
    try {
        await session.connect(connection);
        const result = await session.execute({command: '持续输出直到缓冲滚动'}, {sessionId: 'a'});
        assert.equal(result.output, '保留片段\n');
        assert.equal(result.output_lost, true);
        assert.equal(result.truncated, true);
        const tail = await session.read(id, result.cursor, {sessionId: 'a'});
        assert.equal(tail.output, '末尾中文😀');
        assert.equal(tail.output_lost, false);
        assert.equal(tail.has_more, false);
    } finally { session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：任务记录消失时明确表示结果无法确认，不把已有文本或零退出码当成成功', async () => {
    const originalFetch = globalThis.fetch;
    let submissions = 0;
    globalThis.fetch = async (url, options) => {
        if (url.endsWith('/info')) return response(info);
        if (options.method === 'POST') {
            submissions++;
            return response({lifecycle: 'task', id: JSON.parse(options.body).id, status: 'running', output: '已开始检查', cursor: 5, has_more: false, exit_code: null});
        }
        return response({error: 'Task not found'}, 404);
    };
    const session = createLocalExecutorSession();
    try {
        await session.connect(connection);
        const result = await session.execute({command: '只执行一次的检查'}, {sessionId: 'a'});
        assert.equal(result.status, 'unknown');
        assert.equal(session.state.tasks[0].status, 'unknown');
        assert.equal(result.task_id, session.state.tasks[0].id);
        assert.equal(result.output, undefined);
        assert.equal(result.output_unavailable, true);
        assert.equal(result.cursor, undefined);
        assert.doesNotMatch(result.summary, /cursor=/);
        assert.match(result.summary, /do not repeat/);
        assert.match(result.error, /Task not found/);
        assert.equal(submissions, 1);
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


test('场景：打断后取消和快照均失败时保留任务编号并明确未知，不能伪造取消成功', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    let id;
    const controller = new AbortController();
    globalThis.fetch = async (url, options) => {
        requests.push(url);
        if (url.endsWith('/info')) return response(info);
        if (url.endsWith('/tasks')) {
            id = JSON.parse(options.body).id;
            return response({lifecycle: 'task', id, status: 'running', output: '', cursor: 0, has_more: false});
        }
        if (controller.signal.aborted) throw new TypeError('执行端连接已断开');
        return response({lifecycle: 'task', id, status: 'running', output: '', cursor: 0, has_more: false});
    };
    const session = createLocalExecutorSession();
    let timer;
    try {
        await session.connect(connection);
        const running = session.execute({command: '长任务'}, {sessionId: 'a'}, controller.signal);
        timer = setTimeout(() => controller.abort(new Error('新消息打断')), 20);
        const result = await running;
        assert.equal(result.task_id, id);
        assert.equal(result.status, 'unknown');
        assert.equal(result.interrupted, true);
        assert.equal(result.output_unavailable, true);
        assert.equal(result.output, undefined);
        assert.equal(result.cursor, undefined);
        assert.doesNotMatch(result.summary, /cursor=/);
        assert.equal(requests.filter((url) => url.endsWith('/tasks')).length, 1);
        assert.equal(requests.filter((url) => url.endsWith('/cancel')).length, 1);
    } finally { clearTimeout(timer); session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：session 任务被 AI 打断只结束等待，明确取消才请求清理', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    let id;
    let cancelled = false;
    globalThis.fetch = async (url, options) => {
        requests.push({url, options});
        if (url.endsWith('/info')) return response(info);
        if (url.endsWith('/tasks')) {
            const body = JSON.parse(options.body);
            id = body.id;
            assert.equal(body.lifecycle, 'session');
        }
        if (url.endsWith('/cancel')) cancelled = true;
        return response({id, lifecycle: 'session', status: cancelled ? 'cancelled' : 'running', output: '已启动', cursor: 3, has_more: false, exit_code: 0});
    };
    const session = createLocalExecutorSession();
    const controller = new AbortController();
    let timer;
    try {
        await session.connect(connection);
        const running = session.execute({command: 'start-service', lifecycle: 'session'}, {sessionId: 'a'}, controller.signal);
        timer = setTimeout(() => controller.abort(new Error('新的用户要求')), 20);
        const result = await running;
        assert.equal(result.interrupted, true);
        assert.equal(result.status, 'running');
        assert.equal(result.exit_code, 0);
        assert.equal(result.cancel_requested, false);
        assert.equal(requests.filter(({url}) => url.endsWith('/cancel')).length, 0);
        assert.ok(result.summary.includes(id));
        assert.ok(result.summary.includes(connection.url));
        assert.match(result.summary, /cursor=3/);
        const stopped = await session.cancel(id, {sessionId: 'a'});
        assert.equal(stopped.status, 'cancelled');
        assert.equal(stopped.exit_code, 0);
        assert.equal(requests.filter(({url}) => url.endsWith('/cancel')).length, 1);
    } finally { clearTimeout(timer); session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});

test('场景：任务列表只含当前连接 owner 元数据，summary 游标不被页面轮询推进', async () => {
    const originalFetch = globalThis.fetch;
    const records = new Map();
    const text = 'abc后续输出不得被列表泄漏';
    globalThis.fetch = async (url, options) => {
        if (url.endsWith('/info')) return response(info);
        if (url.endsWith('/tasks')) {
            const body = JSON.parse(options.body);
            records.set(body.id, body);
            return response({id: body.id, lifecycle: body.lifecycle, status: 'running', output: '', cursor: 0, has_more: false, exit_code: 0});
        }
        const parsed = new URL(url);
        const id = parsed.pathname.split('/').at(-1);
        const body = records.get(id);
        const cursor = Number(parsed.searchParams.get('cursor'));
        const end = Math.min(text.length, cursor + Number(parsed.searchParams.get('max_chars')));
        return response({id, lifecycle: body.lifecycle, status: 'completed', output: text.slice(cursor, end), cursor: end, has_more: end < text.length, exit_code: 0});
    };
    const session = createLocalExecutorSession();
    try {
        await session.connect(connection);
        const first = await session.execute({command: 'owner-a-command', reason: '本会话任务', lifecycle: 'session', wait_seconds: 0, max_chars: 3}, {sessionId: 'a'});
        const other = await session.execute({command: 'owner-b-private', lifecycle: 'task', wait_seconds: 0, max_chars: 3}, {sessionId: 'b'});
        const deadline = Date.now() + 4000;
        while (session.state.tasks.some((task) => task.cursor < text.length) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
        assert.ok(session.state.tasks.every((task) => task.cursor === text.length));
        assert.match(first.summary, /cursor=3/);
        assert.doesNotMatch(first.summary, new RegExp(`cursor=${text.length}(?:;|\\b)`));
        const listed = await session.list({sessionId: 'a'});
        assert.equal(listed.endpoint, connection.url);
        assert.equal(listed.tasks.length, 1);
        assert.equal(listed.tasks[0].task_id, first.task_id);
        assert.equal(listed.tasks[0].status, 'completed');
        assert.equal(listed.tasks[0].lifecycle, 'session');
        for (const key of ['output', 'cursor', 'token']) assert.equal(key in listed.tasks[0], false);
        assert.ok(!JSON.stringify(listed).includes(other.task_id));
        assert.ok(!JSON.stringify(listed).includes('owner-b-private'));
        assert.ok(!JSON.stringify(listed).includes(text));
        assert.ok(!JSON.stringify(listed).includes(connection.token));
        const tail = await session.read(first.task_id, first.cursor, {sessionId: 'a'}, undefined, 100);
        assert.equal(first.output + tail.output, text);
        assert.match(tail.summary, new RegExp(`cursor=${text.length}(?:;|\\b)`));
        session.disconnect({cancel: false});
        await session.connect({...connection, url: 'http://127.0.0.1:32101'});
        assert.deepEqual((await session.list({sessionId: 'a'})).tasks, []);
    } finally { session.disconnect({cancel: false}); globalThis.fetch = originalFetch; }
});
