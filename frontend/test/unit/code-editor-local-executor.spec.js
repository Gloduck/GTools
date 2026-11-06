import {expect, test} from '@playwright/test';
import {spawn} from 'node:child_process';
import {inflateRawSync, deflateRawSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

let service;
let connection;
const requests = [];
let terminalOutput = '';
const script = fileURLToPath(new URL('../../public/local-executor/v1/executor.py', import.meta.url));

test.beforeAll(async () => {
    service = spawn('python3', ['-B', script, '--origin', 'http://127.0.0.1:4174'], {stdio: ['ignore', 'pipe', 'pipe']});
    service.stderr.on('data', (chunk) => { terminalOutput += chunk; });
    connection = await new Promise((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('执行器连接端启动超时')), 10000);
        service.once('error', reject);
        service.once('exit', (code) => { clearTimeout(timer); reject(new Error(`执行器连接端提前退出：${code}`)); });
        service.stdout.on('data', (chunk) => {
            output += chunk;
            const line = output.split('\n').find((value) => value.startsWith('{"url":'));
            if (line) { clearTimeout(timer); resolve(JSON.parse(line)); }
        });
    });
});

test.afterAll(async () => {
    if (!service || service.exitCode !== null) return;
    await new Promise((resolve) => { service.once('exit', resolve); service.kill('SIGTERM'); });
});

async function connect(page) {
    await page.getByRole('button', {name: '执行器连接', exact: true}).click();
    const panel = page.locator('.local-executor-dialog');
    await panel.getByLabel('终端显示的连接 JSON').fill(JSON.stringify(connection));
    await panel.getByRole('button', {name: '连接执行器', exact: true}).click();
    await expect(panel.getByText(connection.url, {exact: true})).toBeVisible();
    await expect(panel.getByRole('checkbox', {name: '允许 AI 使用此连接'})).toHaveCount(0);
    await expect(page.locator('.local-status-button')).toHaveClass(/local-status-connected/);
    return panel;
}

async function setup(page, command, options = {}, settingsOverrides = {}) {
    requests.length = 0;
    await page.addInitScript((settingsOverrides) => {
        // 每个浏览器上下文只初始化一次，刷新和导入场景保留真实持久化结果。
        if (sessionStorage.getItem('local-test-initialized')) return;
        sessionStorage.setItem('local-test-initialized', 'true');
        localStorage.setItem('browser-code-editor-settings', JSON.stringify({
            ai: {apiKey: 'test-key', agentModels: 'test-model', baseUrl: 'https://api.openai.com/v1'},
            backend: {enabled: false},
            ...settingsOverrides,
        }));
    }, settingsOverrides);
    // 模型使用固定响应，命令由真实执行器连接端处理；禁止访问 应用后端 API。
    await page.route('**/api/**', async (route) => {
        throw new Error(`不应访问 应用后端：${route.request().url()}`);
    });
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        const body = route.request().postDataJSON();
        requests.push(body);
        const response = requests.length === 1
            ? {output: [{type: 'function_call', call_id: 'local-command', name: 'execute_executor_command', arguments: JSON.stringify({command, reason: '验证执行器连接能力', commands: [command.split(' ')[0]], high_risk: false, ...options})}]}
            : {output_text: '本机命令请求已处理。', output: []};
        await route.fulfill({status: 200, headers: {'content-type': 'text/event-stream'}, body: `data: ${JSON.stringify({type: 'response.completed', response})}\n\ndata: [DONE]\n\n`});
    });
    await page.goto('/codeEditor');
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
}

async function ask(page) {
    await page.locator('.local-executor-dialog').getByRole('button', {name: '关闭', exact: true}).click();
    await expect(page.locator('.local-status-button')).toHaveClass(/local-status-connected/);
    await page.locator('.ai-chat-form textarea').fill('执行一次本机命令');
    await page.getByRole('button', {name: '发送', exact: true}).click();
}

test('场景：任务列表不展示已完成任务，执行结果仍返回 AI 且凭据不进入模型或设置', async ({page}) => {
    await setup(page, "printf '执行器连接成功\\n'");
    const panel = await connect(page);
    await ask(page);
    const dialog = page.getByRole('dialog', {name: '执行命令'});
    await expect(dialog).toContainText('验证执行器连接能力');
    await expect(dialog).toContainText(connection.url);
    await expect(dialog).toContainText('printf');
    await dialog.getByRole('button', {name: '执行命令'}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('本机命令请求已处理');
    await page.getByRole('button', {name: '执行器连接', exact: true}).click();
    await expect(panel.locator('.local-output')).toHaveCount(0);
    await expect.poll(() => terminalOutput).toMatch(/\] 执行器连接成功\n/);
    await expect(panel.locator('.local-task')).toHaveCount(0);
    await expect(panel.locator('.local-tasks')).toHaveCount(0);
    expect(JSON.stringify(requests)).not.toContain(connection.token);
    const settings = await page.evaluate(() => JSON.stringify({...localStorage}));
    expect(settings).not.toContain(connection.token);
    expect(requests[0].tools.find((tool) => tool.name === 'execute_executor_command')).toBeTruthy();
    const result = JSON.parse(requests[1].input.find((item) => item.type === 'function_call_output').output);
    expect(result).toMatchObject({ok: true, status: 'completed', exit_code: 0, has_more: false});
    expect(result.output).toContain('执行器连接成功');
});

test('场景：任务列表不展示失败任务，错误输出和退出码仍返回 AI', async ({page}) => {
    await setup(page, "printf '失败信息\\n' >&2; exit 7", {commands: ['printf', 'exit']}, {localExecutor: {autoApprove: true}});
    const panel = await connect(page);
    await ask(page);
    await expect(page.locator('.ai-message-assistant')).toContainText('本机命令请求已处理');
    await page.getByRole('button', {name: '执行器连接', exact: true}).click();
    await expect(panel.locator('.local-task')).toHaveCount(0);
    await expect(panel.locator('.local-tasks')).toHaveCount(0);
    const result = JSON.parse(requests[1].input.find((item) => item.type === 'function_call_output').output);
    expect(result).toMatchObject({status: 'failed', exit_code: 7});
    expect(result.output).toContain('失败信息');
});

test('场景：拒绝本机命令授权后不提交执行任务', async ({page}) => {
    await setup(page, "printf '不应执行'");
    let submissions = 0;
    page.on('request', (request) => {
        if (request.url() === connection.url + '/v1/tasks' && request.method() === 'POST') submissions++;
    });
    await connect(page);
    await ask(page);
    const dialog = page.getByRole('dialog', {name: '执行命令'});
    await dialog.getByRole('button', {name: '取消', exact: true}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('本机命令请求已处理');
    expect(submissions).toBe(0);
    const result = requests[1].input.find((item) => item.type === 'function_call_output');
    expect(JSON.parse(result.output)).toMatchObject({ok: false});
});

test('场景：任务列表展示运行状态，断开取消长任务并清空列表和连接信息', async ({page}) => {
    await setup(page, 'sleep 30', {wait_seconds: 1});
    const panel = await connect(page);
    await ask(page);
    await page.getByRole('dialog', {name: '执行命令'}).getByRole('button', {name: '执行命令'}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('本机命令请求已处理');
    await page.getByRole('button', {name: '执行器连接', exact: true}).click();
    await expect(panel.locator('.local-task')).toHaveCount(1);
    await expect(panel.locator('.local-task-status')).toHaveText('运行中');
    await expect(panel.locator('.local-task-details')).toHaveCount(0);
    const cancellation = page.waitForResponse((response) => response.url().startsWith(connection.url + '/v1/tasks/') && response.url().endsWith('/cancel'));
    await panel.getByRole('button', {name: '断开并请求取消任务'}).click();
    const response = await cancellation;
    expect(response.ok()).toBeTruthy();
    const {id} = await response.json();
    await expect.poll(() => terminalOutput).toContain(`[${id}] 执行结束 | 状态: cancelled`);
    await expect(panel.getByRole('button', {name: '连接执行器', exact: true})).toBeVisible();
    await expect(panel.getByLabel('终端显示的连接 JSON')).toHaveValue('');
    await expect(panel.locator('.local-task')).toHaveCount(0);
});

test('场景：任务列表分别展开和停止，停止失败可重试且不影响另一任务', async ({page}) => {
    await setup(page, 'pwd', {}, {localExecutor: {autoApprove: true}});
    const commands = [
        {command: "printf '任务甲输出\\n'; sleep 30", reason: '任务甲原因'},
        {command: "printf '任务乙输出\\n'; sleep 30", reason: '任务乙原因'},
    ];
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        requests.push(route.request().postDataJSON());
        const response = requests.length === 1
            ? {output: commands.map((args, index) => ({type: 'function_call', call_id: `task-${index}`, name: 'execute_executor_command', arguments: JSON.stringify({...args, commands: ['printf', 'sleep'], high_risk: false, wait_seconds: 0})}))}
            : {output_text: '两条命令已提交。', output: []};
        await route.fulfill({status: 200, headers: {'content-type': 'text/event-stream'}, body: `data: ${JSON.stringify({type: 'response.completed', response})}\n\ndata: [DONE]\n\n`});
    });
    const panel = await connect(page);
    await ask(page);
    await expect(page.locator('.ai-message-assistant')).toContainText('两条命令已提交');
    await page.getByRole('button', {name: '执行器连接', exact: true}).click();
    await expect(panel.locator('.local-task')).toHaveCount(2);
    const first = panel.locator('.local-task').filter({has: page.locator('.local-task-reason', {hasText: '任务甲原因'})});
    const second = panel.locator('.local-task').filter({has: page.locator('.local-task-reason', {hasText: '任务乙原因'})});
    await expect(first.locator('.local-task-status')).toHaveText('运行中');
    await expect(first.locator('.local-task-details')).toHaveCount(0);
    const expand = first.getByRole('button', {name: '展开', exact: true});
    await expect(expand).toHaveAttribute('aria-expanded', 'false');
    await expand.click();
    await expect(first.locator('.local-command')).toHaveText(commands[0].command);
    await expect(first.locator('.local-output')).toHaveText('任务甲输出');
    await expect(second.locator('.local-task-details')).toHaveCount(0);
    const collapse = first.getByRole('button', {name: '收起', exact: true});
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await collapse.click();
    await expect(first.locator('.local-task-details')).toHaveCount(0);
    const id = await first.locator('.local-task-id').textContent();
    const results = requests[1].input.filter((item) => item.type === 'function_call_output').map((item) => JSON.parse(item.output));
    expect(results.some((result) => result.task_id === id)).toBe(true);
    let stopRequests = 0;
    let failStop;
    await page.route(`${connection.url}/v1/tasks/${id}/cancel`, async (route) => {
        stopRequests++;
        if (stopRequests === 1) {
            // 首次响应可控，验证等待期间不会重复请求，以及失败后仍可重试。
            await new Promise((resolve) => { failStop = resolve; });
            await route.fulfill({status: 503, json: {error: '模拟停止失败'}});
        } else await route.continue();
    });
    await first.getByRole('button', {name: '停止', exact: true}).click();
    await expect(first.getByRole('button', {name: '停止中…', exact: true})).toBeDisabled();
    await expect.poll(() => stopRequests).toBe(1);
    failStop();
    await expect(first.getByRole('alert')).toHaveText('模拟停止失败');
    await expect(first.getByRole('button', {name: '停止', exact: true})).toBeEnabled();
    await first.getByRole('button', {name: '停止', exact: true}).click();
    await expect(first).toHaveCount(0);
    await expect(panel.locator('.local-task')).toHaveCount(1);
    await expect(second.locator('.local-task-status')).toHaveText('运行中');
    await expect(second.getByRole('button', {name: '停止', exact: true})).toBeEnabled();
    await second.getByRole('button', {name: '展开', exact: true}).click();
    await expect(second.locator('.local-output')).toHaveText('任务乙输出');
    await second.getByRole('button', {name: '停止', exact: true}).click();
    await expect(second).toHaveCount(0);
    await expect(panel.locator('.local-tasks')).toHaveCount(0);
    expect(stopRequests).toBe(2);
    await expect.poll(() => terminalOutput).toContain(`[${id}] 执行结束 | 状态: cancelled`);
});

test('场景：低风险白名单命令直接执行，重新连接自动回填白名单', async ({page}) => {
    await setup(page, "printf '白名单测试'");
    const panel = await connect(page);
    await panel.getByLabel('AI 白名单主命令').fill('printf');
    await ask(page);
    await expect(page.locator('.ai-message-assistant')).toContainText('本机命令请求已处理');
    await expect(page.getByRole('dialog', {name: '执行命令'})).toHaveCount(0);
    await page.getByRole('button', {name: '执行器连接', exact: true}).click();
    await expect.poll(() => terminalOutput).toContain('白名单测试');
    await panel.getByRole('button', {name: '断开并请求取消任务'}).click();
    await panel.getByLabel('终端显示的连接 JSON').fill(JSON.stringify(connection));
    await panel.getByRole('button', {name: '连接执行器', exact: true}).click();
    await expect(panel.getByRole('checkbox', {name: '允许 AI 使用此连接'})).toHaveCount(0);
    await expect(panel.getByLabel('AI 白名单主命令')).toHaveValue('printf');
});

test('场景：免审批直接执行白名单外高风险命令，未保存文件保持原样，重新连接恢复已保存的开关', async ({page}) => {
    // 使用无副作用的命令并申报高风险，验证审批分支而不执行危险操作。
    await setup(page, "printf '免审批执行成功'", {high_risk: true});
    await page.evaluate(() => Object.defineProperty(navigator.storage, 'persisted', {configurable: true, value: async () => true}));
    await page.getByRole('button', {name: '资源管理器', exact: true}).click();
    await page.getByRole('button', {name: '打开浏览器文件夹', exact: true}).click();
    await page.locator('.file-tree').dispatchEvent('contextmenu', {clientX: 240, clientY: 240});
    await page.getByRole('menuitem', {name: '新建文件', exact: true}).click();
    const createDialog = page.getByRole('dialog', {name: '新建文件', exact: true});
    await createDialog.getByRole('textbox').fill('未保存.txt');
    await createDialog.getByRole('checkbox', {name: '立即应用到磁盘'}).uncheck();
    await createDialog.getByRole('button', {name: '新建文件', exact: true}).click();
    await expect(page.locator('.tab[title="未保存.txt"] .dirty-dot')).toHaveText('•');
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    const panel = await connect(page);
    const autoApprove = panel.getByRole('checkbox', {name: '执行命令免审批', exact: true});
    await expect(autoApprove).not.toBeChecked();
    await panel.getByLabel('AI 白名单主命令').fill('pwd');
    await autoApprove.check();
    await expect(panel.getByLabel('AI 白名单主命令')).toBeDisabled();
    await ask(page);
    await expect(page.locator('.ai-message-assistant')).toContainText('本机命令请求已处理');
    await expect(page.getByRole('dialog', {name: '执行命令', exact: true})).toHaveCount(0);
    const result = JSON.parse(requests[1].input.find((item) => item.type === 'function_call_output').output);
    expect(result).toMatchObject({ok: true, status: 'completed', exit_code: 0});
    expect(result.output).toContain('免审批执行成功');
    await expect(page.locator('.tab[title="未保存.txt"] .dirty-dot')).toHaveText('•');
    expect(await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        for await (const name of root.keys()) if (name === '未保存.txt') return true;
        return false;
    })).toBe(false);

    await page.getByRole('button', {name: '执行器连接', exact: true}).click();
    await expect(autoApprove).toBeChecked();
    await expect(panel.getByLabel('AI 白名单主命令')).toHaveValue('pwd');
    await panel.getByRole('button', {name: '断开并请求取消任务'}).click();
    await panel.getByLabel('终端显示的连接 JSON').fill(JSON.stringify(connection));
    await panel.getByRole('button', {name: '连接执行器', exact: true}).click();
    await expect(autoApprove).toBeChecked();
    await expect(panel.getByLabel('AI 白名单主命令')).toBeDisabled();
    await expect(panel.getByLabel('AI 白名单主命令')).toHaveValue('pwd');
    await autoApprove.uncheck();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('browser-code-editor-settings')).localExecutor.autoApprove)).toBe(false);
    await panel.getByRole('button', {name: '断开并请求取消任务'}).click();
    await panel.getByLabel('终端显示的连接 JSON').fill(JSON.stringify(connection));
    await panel.getByRole('button', {name: '连接执行器', exact: true}).click();
    await expect(autoApprove).not.toBeChecked();
    await expect(panel.getByLabel('AI 白名单主命令')).toBeEnabled();
});

for (const scenario of [
    {name: '白名单外命令', whitelist: 'pwd', highRisk: false},
    {name: '高风险命令', whitelist: 'printf', highRisk: true},
]) {
    test(`场景：取消免审批后${scenario.name}恢复确认，模型参数不能开启免审批`, async ({page}) => {
        await setup(page, "printf '不应执行'", {high_risk: scenario.highRisk, auto_approve: true});
        let submissions = 0;
        page.on('request', (request) => {
            if (request.url() === connection.url + '/v1/tasks' && request.method() === 'POST') submissions++;
        });
        const panel = await connect(page);
        await panel.getByLabel('AI 白名单主命令').fill(scenario.whitelist);
        const autoApprove = panel.getByRole('checkbox', {name: '执行命令免审批', exact: true});
        await autoApprove.check();
        await autoApprove.uncheck();
        await expect(panel.getByLabel('AI 白名单主命令')).toHaveValue(scenario.whitelist);
        await ask(page);
        const approval = page.getByRole('dialog', {name: '执行命令', exact: true});
        await expect(approval).toContainText(scenario.name);
        await approval.getByRole('button', {name: '取消', exact: true}).click();
        await expect(page.locator('.ai-message-assistant')).toContainText('本机命令请求已处理');
        expect(submissions).toBe(0);
    });
}


test('场景：AI Agent 顶部按钮打开配置，关闭弹窗保持连接，服务不可达时显示异常状态', async ({page}) => {
    await setup(page, 'pwd');
    await expect(page.locator('.command-bar .local-status-button')).toHaveCount(0);
    await expect(page.locator('.ai-header-actions .local-status-button')).toHaveClass(/local-status-disconnected/);
    await page.getByRole('button', {name: '资源管理器', exact: true}).click();
    await expect(page.getByRole('button', {name: '执行器连接', exact: true})).toBeHidden();
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    await connect(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.local-executor-dialog')).toHaveCount(0);
    await expect(page.locator('.local-status-button')).toHaveClass(/local-status-connected/);
    await page.route(connection.url + '/v1/info', (route) => route.abort());
    await expect(page.locator('.local-status-button')).toHaveClass(/local-status-unreachable/, {timeout: 20000});
    await page.unroute(connection.url + '/v1/info');
    await expect(page.locator('.local-status-button')).toHaveClass(/local-status-connected/, {timeout: 20000});
});


test('场景：Windows 两个启动入口均无需权限模式参数', async ({page}) => {
    await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', {get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}));
    await setup(page, 'pwd');
    await page.getByRole('button', {name: '执行器连接', exact: true}).click();
    const dialog = page.locator('.local-executor-dialog');
    await expect(dialog.getByRole('combobox', {name: '执行权限', exact: true})).toHaveCount(0);
    const command = dialog.getByLabel('启动命令', {exact: true});
    await expect(dialog.getByRole('combobox', {name: '系统', exact: true})).toHaveValue('windows');
    await expect(command).not.toHaveValue(/Sandbox/);
    await dialog.getByRole('combobox', {name: '粘贴启动命令的终端', exact: true}).selectOption('cmd');
    const encoded = (await command.inputValue()).split(' ').at(-1);
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).not.toMatch(/Sandbox/);
    await dialog.getByRole('combobox', {name: '系统', exact: true}).selectOption('unix');
    await expect(command).not.toHaveValue(/sandbox/);
    await dialog.getByRole('combobox', {name: '系统', exact: true}).selectOption('windows');
});

test('场景：同步等待期间可停止 AI 任务，并在终端确认取消结果', async ({page}) => {
    await setup(page, 'sleep 30');
    await connect(page);
    await ask(page);
    const submission = page.waitForResponse((response) => response.url() === connection.url + '/v1/tasks' && response.request().method() === 'POST');
    await page.getByRole('dialog', {name: '执行命令'}).getByRole('button', {name: '执行命令'}).click();
    const {id} = await (await submission).json();
    const cancellation = page.waitForResponse((response) => response.url() === `${connection.url}/v1/tasks/${id}/cancel`);
    await page.getByRole('button', {name: '停止 AI 任务', exact: true}).click();
    expect((await cancellation).ok()).toBeTruthy();
    await expect.poll(() => terminalOutput).toContain(`[${id}] 执行结束 | 状态: cancelled`);
    await expect(page.getByRole('button', {name: '停止 AI 任务', exact: true})).toBeDisabled();
});

test('场景：与 SSH 相同，高风险命令即使命中白名单也必须审批', async ({page}) => {
    await setup(page, "printf '高风险测试'", {high_risk: true});
    const panel = await connect(page);
    await panel.getByLabel('AI 白名单主命令').fill('printf');
    await ask(page);
    const dialog = page.getByRole('dialog', {name: '执行命令'});
    await expect(dialog).toContainText('高风险命令');
    await dialog.getByRole('button', {name: '取消', exact: true}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('本机命令请求已处理');
    expect(JSON.parse(requests[1].input.find((item) => item.type === 'function_call_output').output)).toMatchObject({ok: false});
});

test('场景：管道主命令未全部命中白名单时仍需审批', async ({page}) => {
    await setup(page, "printf '管道测试' | cat", {commands: ['printf', 'cat']});
    const panel = await connect(page);
    await panel.getByLabel('AI 白名单主命令').fill('printf');
    await ask(page);
    const dialog = page.getByRole('dialog', {name: '执行命令'});
    await expect(dialog).toContainText('白名单外命令');
    await expect(dialog).toContainText('printf, cat');
    await dialog.getByRole('button', {name: '取消', exact: true}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('本机命令请求已处理');
});


test('场景：预置模板只复制到当前连接，手动修改不污染模板或已保存的 SSH 配置', async ({page}) => {
    await setup(page, 'pwd', {}, {ssh: {whitelistTemplate: 'ssh-template-only', connections: [
        {id: 'ssh-existing', name: '已有 SSH', host: 'example.invalid', username: 'test', whitelist: ['ssh-command-only'], exposeToAi: false},
    ]}});
    const readSshSettings = () => page.evaluate(() => JSON.parse(localStorage.getItem('browser-code-editor-settings')).ssh);
    const sshBefore = await readSshSettings();
    const panel = await connect(page);
    const whitelist = panel.getByRole('textbox', {name: /AI 白名单主命令/});
    const preset = panel.getByRole('combobox', {name: '预置白名单模板', exact: true});
    await expect(preset).toHaveValue('sh');
    await expect(whitelist).toHaveValue('');
    await panel.getByRole('button', {name: '填入模板', exact: true}).click();
    await expect(whitelist).toHaveValue(/(?:^|\n)pwd(?:\n|$)/);
    await whitelist.fill('当前连接自定义命令');
    await preset.selectOption('powershell');
    await expect(whitelist).toHaveValue('当前连接自定义命令');
    await panel.getByRole('button', {name: '填入模板', exact: true}).click();
    await expect(whitelist).toHaveValue(/Get-ChildItem/);
    await preset.selectOption('cmd');
    await panel.getByRole('button', {name: '填入模板', exact: true}).click();
    await expect(whitelist).toHaveValue(/(?:^|\n)dir(?:\n|$)/);
    await expect(whitelist).not.toHaveValue(/Get-ChildItem/);
    await preset.selectOption('sh');
    await panel.getByRole('button', {name: '填入模板', exact: true}).click();
    await expect(whitelist).not.toHaveValue(/当前连接自定义命令/);
    expect(await readSshSettings()).toEqual(sshBefore);
    await whitelist.fill('journalctl\nvmstat');
    const persisted = await page.evaluate(() => JSON.stringify({...localStorage}));
    expect(persisted).toContain('journalctl');
    expect(persisted).not.toContain(connection.token);
    expect(persisted).not.toContain(connection.url);
    await page.reload();
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    await connect(page);
    await expect(whitelist).toHaveValue('journalctl\nvmstat');
    await expect(preset).toHaveValue('sh');
    await expect(preset.locator('option[value="saved"]')).toHaveCount(0);
    await whitelist.fill('');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('browser-code-editor-settings')).localExecutor.whitelist)).toEqual([]);
});


test('场景：设置链接导出白名单、IP、端口和免审批，导入后回填并生效且不恢复凭据', async ({page}) => {
    await setup(page, "printf '导入免审批成功'", {high_risk: true}, {localExecutor: {listenAddress: '192.168.1.25', port: 8321}});
    const panel = await connect(page);
    await panel.getByLabel('AI 白名单主命令').fill('pwd\nls\npwd');
    await panel.getByRole('checkbox', {name: '执行命令免审批', exact: true}).check();
    await panel.getByRole('button', {name: '关闭', exact: true}).click();
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {
        writeText: async (value) => { window.exportedSettingsUrl = value; },
    }}));
    await page.getByRole('button', {name: '设置', exact: true}).click();
    await page.getByRole('button', {name: '复制导出 URL', exact: true}).click();
    await expect.poll(() => page.evaluate(() => window.exportedSettingsUrl)).toBeTruthy();
    const exported = await page.evaluate(() => window.exportedSettingsUrl);
    const encoded = new URLSearchParams(new URL(exported).hash.slice(1)).get('settings');
    const snapshot = JSON.parse(inflateRawSync(Buffer.from(encoded, 'base64url')));
    expect(snapshot.localExecutor).toEqual({whitelist: ['pwd', 'ls'], listenAddress: '192.168.1.25', port: 8321, autoApprove: true});
    expect(JSON.stringify(snapshot)).not.toContain(connection.token);
    expect(JSON.stringify(snapshot)).not.toContain(connection.url);

    // 可复用配置正常导入，外部设置夹带的凭据和运行状态被过滤。
    const imported = {whitelist: ['Get-WinEvent', 'Get-NetTCPConnection'], listenAddress: '::1', port: 0, autoApprove: true};
    snapshot.localExecutor = {...imported, ...connection,
        connected: true, shell: 'cmd', bindWorkspace: true, tasks: [{id: '不应保存'}]};
    const importUrl = '/codeEditor#settings=' + deflateRawSync(Buffer.from(JSON.stringify(snapshot))).toString('base64url');
    await page.goto(importUrl);
    // 只修改 hash 属于同页导航；实际导入在打开页面时检查。
    await page.reload();
    await page.getByRole('dialog', {name: '发现导入设置'}).getByRole('button', {name: '覆盖配置', exact: true}).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('browser-code-editor-settings')).localExecutor))
        .toEqual(imported);
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    await expect(page.locator('.local-status-button')).toHaveClass(/local-status-disconnected/);
    await page.getByRole('button', {name: '执行器连接', exact: true}).click();
    await expect(panel.getByLabel('监听 IP', {exact: true})).toHaveValue('::1');
    await expect(panel.getByLabel('监听端口（0 为自动分配）', {exact: true})).toHaveValue('0');
    await expect(panel.getByLabel('终端显示的连接 JSON')).toHaveValue('');
    await panel.getByLabel('终端显示的连接 JSON').fill(JSON.stringify(connection));
    await panel.getByRole('button', {name: '连接执行器', exact: true}).click();
    await expect(panel.getByLabel('AI 白名单主命令')).toHaveValue('Get-WinEvent\nGet-NetTCPConnection');
    await expect(panel.getByRole('checkbox', {name: '执行命令免审批', exact: true})).toBeChecked();
    await ask(page);
    await expect(page.locator('.ai-message-assistant')).toContainText('本机命令请求已处理');
    const result = JSON.parse(requests[1].input.find((item) => item.type === 'function_call_output').output);
    expect(result).toMatchObject({ok: true, status: 'completed', exit_code: 0});
    expect(result.output).toContain('导入免审批成功');
});


test('场景：监听 IP 和端口修改后自动保存，刷新回填，非法输入不覆盖配置', async ({page}) => {
    await setup(page, 'pwd');
    await page.getByRole('button', {name: '执行器连接', exact: true}).click();
    const dialog = page.locator('.local-executor-dialog');
    const ip = dialog.getByLabel('监听 IP', {exact: true});
    const port = dialog.getByLabel('监听端口（0 为自动分配）', {exact: true});
    await expect(dialog.getByLabel('访问地址（可选，含协议和端口）', {exact: true})).toHaveCount(0);
    await expect(ip).toHaveValue('127.0.0.1');
    await expect(port).toHaveValue('0');
    await ip.fill('192.168.1.25');
    await port.fill('8321');
    await dialog.getByRole('combobox', {name: '系统', exact: true}).selectOption('unix');
    await expect(dialog.getByLabel('启动命令', {exact: true})).toHaveValue(/'192\.168\.1\.25' 8321 ''/);
    await dialog.getByRole('combobox', {name: '系统', exact: true}).selectOption('windows');
    await expect(dialog.getByLabel('启动命令', {exact: true})).toHaveValue(/-ListenAddress '192\.168\.1\.25' -Port 8321$/);
    await page.reload();
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    await page.getByRole('button', {name: '执行器连接', exact: true}).click();
    await expect(ip).toHaveValue('192.168.1.25');
    await expect(port).toHaveValue('8321');
    await ip.fill('0.0.0.0');
    await port.fill('65536');
    await expect(dialog.getByRole('button', {name: '复制启动命令', exact: true})).toBeDisabled();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('browser-code-editor-settings')).localExecutor))
        .toEqual({whitelist: [], listenAddress: '192.168.1.25', port: 8321, autoApprove: false});
    await page.reload();
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    await page.getByRole('button', {name: '执行器连接', exact: true}).click();
    await expect(ip).toHaveValue('192.168.1.25');
    await expect(port).toHaveValue('8321');
});

test('场景：刷新页面后重新连接恢复保存的免审批，关闭开关后下次连接需要审批', async ({page}) => {
    await setup(page, "printf '恢复审批测试'", {high_risk: true});
    const panel = await connect(page);
    const autoApprove = panel.getByRole('checkbox', {name: '执行命令免审批', exact: true});
    await autoApprove.check();
    await page.reload();
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    await connect(page);
    await expect(autoApprove).toBeChecked();
    await autoApprove.uncheck();
    await page.reload();
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    await connect(page);
    await expect(autoApprove).not.toBeChecked();
    await ask(page);
    const approval = page.getByRole('dialog', {name: '执行命令', exact: true});
    await expect(approval).toContainText('高风险命令');
    await approval.getByRole('button', {name: '取消', exact: true}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('本机命令请求已处理');
});


test('场景：局域网 HTTP 地址可配对并执行，审批明确显示目标地址', async ({page}) => {
    await setup(page, "printf '远程入口结果'");
    const endpoint = 'http://192.168.1.25:8321';
    // 将模拟局域网地址的请求交给真实 Python 执行端，验证客户端使用指定地址。
    await page.route(endpoint + '/**', async (route) => {
        const source = new URL(route.request().url());
        const response = await route.fetch({url: connection.url + source.pathname + source.search});
        await route.fulfill({response});
    });
    await page.getByRole('button', {name: '执行器连接', exact: true}).click();
    const panel = page.locator('.local-executor-dialog');
    await panel.getByLabel('终端显示的连接 JSON').fill(JSON.stringify({...connection, url: endpoint}));
    await panel.getByRole('button', {name: '连接执行器', exact: true}).click();
    await expect(panel.getByText(endpoint, {exact: true})).toBeVisible();
    await ask(page);
    const approval = page.getByRole('dialog', {name: '执行命令', exact: true});
    await expect(approval).toContainText(endpoint);
    await approval.getByRole('button', {name: '执行命令', exact: true}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('本机命令请求已处理');
    const result = JSON.parse(requests[1].input.find((item) => item.type === 'function_call_output').output);
    expect(result).toMatchObject({ok: true, status: 'completed', exit_code: 0});
    expect(result.output).toContain('远程入口结果');
});
