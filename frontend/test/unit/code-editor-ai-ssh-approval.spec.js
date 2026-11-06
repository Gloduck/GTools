import {expect, test} from '@playwright/test';

const defaultConnection = {
    id: 'ssh-test', name: 'Test SSH', host: 'example.com', port: 22, username: 'tester',
    authType: 'password', password: 'secret', exposeToAi: true, whitelist: ['pwd'],
};

async function installSshMock(page, connections = [defaultConnection]) {
    await page.addInitScript((connections) => {
        // 刷新时保留用户通过表单保存的配置；所有 SSH 请求只进入测试模拟服务。
        if (!sessionStorage.getItem('ssh-test-initialized')) {
            sessionStorage.setItem('ssh-test-initialized', 'true');
            localStorage.setItem('browser-code-editor-settings', JSON.stringify({
                ai: {apiKey: 'test-key', agentModels: 'test-model', baseUrl: 'https://api.openai.com/v1'},
                backend: {enabled: true, baseUrl: location.origin},
                ssh: {connections},
            }));
        }
        window.sshInputs = [];

        class MockWebSocket extends EventTarget {
            static CONNECTING = 0;
            static OPEN = 1;
            static CLOSING = 2;
            static CLOSED = 3;

            constructor() {
                super();
                this.readyState = MockWebSocket.CONNECTING;
                setTimeout(() => {
                    this.readyState = MockWebSocket.OPEN;
                    this.dispatchEvent(new Event('open'));
                });
            }

            send(raw) {
                const message = JSON.parse(raw);
                if (message.type === 'connect') {
                    this.host = message.host;
                    setTimeout(() => this.dispatchEvent(new MessageEvent('message', {
                        data: JSON.stringify({type: 'connected', connectionId: 'connection-1'}),
                    })));
                }
                if (message.type === 'input') window.sshInputs.push({host: this.host, data: message.data});
            }

            close() {
                this.readyState = MockWebSocket.CLOSED;
                this.dispatchEvent(new Event('close'));
            }
        }

        Object.defineProperty(globalThis, 'WebSocket', {configurable: true, value: MockWebSocket});
    }, connections);
}

async function openSshSettings(page, name = defaultConnection.name) {
    const card = page.locator('.ssh-card').filter({has: page.getByText(name, {exact: true})});
    await card.getByRole('button', {name: '修改', exact: true}).click();
    return page.getByRole('dialog', {name: '修改 SSH 设置', exact: true});
}

async function sendAiPrompt(page) {
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    await page.locator('.ai-chat-form textarea').fill('执行 SSH 测试命令');
    await page.getByRole('button', {name: '发送', exact: true}).click();
}

function commandCalls(connection, suffix = '', overrides = {}) {
    return [
        {type: 'function_call', call_id: `open${suffix}`, name: 'open_ssh_connection', arguments: JSON.stringify({connection})},
        {type: 'function_call', call_id: `execute${suffix}`, name: 'execute_ssh_command', arguments: JSON.stringify({
            connection, command: "printf 'SSH 测试'", commands: ['printf'], high_risk: true, reason: '验证命令审批', wait_seconds: 1, ...overrides,
        })},
    ];
}

async function respondToAi(route, response) {
    await route.fulfill({status: 200, headers: {'content-type': 'text/event-stream'},
        body: `data: ${JSON.stringify({type: 'response.completed', response})}\n\ndata: [DONE]\n\n`});
}

test('execute_ssh_command 授权框显示在对应 AI 会话内', async ({page}) => {
    const requests = [];
    await installSshMock(page);
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        requests.push(route.request().postDataJSON());
        const response = requests.length === 1
            ? {output: [
                {type: 'function_call', call_id: 'open-call', name: 'open_ssh_connection', arguments: JSON.stringify({connection: 'ssh-test'})},
                {type: 'function_call', call_id: 'execute-call', name: 'execute_ssh_command', arguments: JSON.stringify({connection: 'ssh-test', command: 'rm /tmp/demo', commands: ['rm'], high_risk: true, reason: '清理远程临时文件'})},
            ]}
            : requests.length === 2
                ? {output: [{type: 'function_call', call_id: 'question-call', name: 'ask_user', arguments: JSON.stringify({question: '会话 B 的问题', options: [{label: '选项 B'}]})}]}
                : {output_text: 'SSH 授权结果已处理。', output: []};
        const body = `data: ${JSON.stringify({type: 'response.completed', response})}\n\ndata: [DONE]\n\n`;
        await route.fulfill({status: 200, headers: {'content-type': 'text/event-stream'}, body});
    });

    await page.goto('/codeEditor');
    await page.getByRole('button', {name: 'AI 助手'}).click();
    await page.locator('.ai-chat-form textarea').fill('清理远程临时文件');
    await page.getByRole('button', {name: '发送'}).click();

    const dialog = page.getByRole('dialog', {name: '执行'});
    await expect(dialog).toContainText('AI 请求执行高风险 SSH 命令');
    await expect(page.locator('.ai-chat .ai-interaction-dialog')).toBeVisible();
    await expect(page.locator('.editor-dialog-backdrop')).toHaveCount(0);

    await page.getByRole('button', {name: '新建会话'}).click();
    await expect(dialog).toBeHidden();
    await page.locator('.ai-chat-form textarea').fill('开始会话 B');
    await page.getByRole('button', {name: '发送'}).click();
    await expect(page.getByRole('dialog', {name: 'AI 需要你的回答'})).toContainText('会话 B 的问题');

    await page.getByRole('button', {name: '切换会话'}).click();
    await page.locator('.ai-history-item-main').filter({hasText: '会话 1'}).click();
    await expect(dialog).toContainText('AI 请求执行高风险 SSH 命令');
    await dialog.getByRole('button', {name: '取消'}).click();

    await expect(page.locator('.ai-message-assistant')).toContainText('SSH 授权结果已处理。');
    const output = requests[2].input.find((item) => item.type === 'function_call_output' && item.call_id === 'execute-call');
    expect(JSON.parse(output.output)).toMatchObject({ok: false, summary: 'SSH 命令授权已拒绝。'});
});

test('场景：SSH 免审批按连接保存，取消修改不生效，刷新后恢复该连接的配置', async ({page}) => {
    await installSshMock(page, [defaultConnection, {...defaultConnection, id: 'ssh-other', name: '另一个 SSH', host: 'other.invalid'}]);
    await page.goto('/codeEditor');
    await page.getByRole('button', {name: 'SSH', exact: true}).click();
    const dialog = await openSshSettings(page);
    const autoApprove = dialog.getByRole('checkbox', {name: '执行命令免审批', exact: true});
    const whitelist = dialog.getByPlaceholder(/每行一个主命令/);
    await expect(autoApprove).not.toBeChecked();
    await autoApprove.check();
    await expect(whitelist).toBeDisabled();
    await dialog.getByRole('button', {name: '取消', exact: true}).click();
    await openSshSettings(page);
    await expect(autoApprove).not.toBeChecked();
    await autoApprove.check();
    await dialog.getByRole('button', {name: '确定', exact: true}).click();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('browser-code-editor-settings')).ssh.connections.map(
        ({id, autoApprove, whitelist}) => ({id, autoApprove, whitelist})
    ))).toEqual([
        {id: 'ssh-test', autoApprove: true, whitelist: ['pwd']},
        {id: 'ssh-other', autoApprove: false, whitelist: ['pwd']},
    ]);
    await page.reload();
    await page.getByRole('button', {name: 'SSH', exact: true}).click();
    await openSshSettings(page);
    await expect(autoApprove).toBeChecked();
    await expect(whitelist).toHaveValue('pwd');
    await dialog.getByRole('button', {name: '取消', exact: true}).click();
    await openSshSettings(page, '另一个 SSH');
    await expect(autoApprove).not.toBeChecked();
    await expect(whitelist).toBeEnabled();
});

test('场景：开启免审批的 SSH 直接执行白名单外高风险命令，另一条连接仍需审批', async ({page}) => {
    const requests = [];
    await installSshMock(page, [{...defaultConnection, autoApprove: true}, {...defaultConnection, id: 'ssh-other', name: '另一个 SSH', host: 'other.invalid'}]);
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        requests.push(route.request().postDataJSON());
        await respondToAi(route, requests.length === 1
            ? {output: commandCalls('ssh-test', '-first')}
            : requests.length === 2
                ? {output: [{type: 'function_call', call_id: 'list', name: 'get_ssh_connections', arguments: '{}'}, ...commandCalls('ssh-other', '-second')]}
                : {output_text: 'SSH 审批检查完成', output: []});
    });
    await page.goto('/codeEditor');
    await sendAiPrompt(page);
    const approval = page.getByRole('dialog', {name: '执行', exact: true});
    await expect(approval).toContainText('另一个 SSH');
    await expect(approval).toContainText('高风险 SSH 命令');
    expect(await page.evaluate(() => window.sshInputs)).toEqual([{host: 'example.com', data: "printf 'SSH 测试'\n"}]);
    await approval.getByRole('button', {name: '取消', exact: true}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('SSH 审批检查完成');
    const firstResult = JSON.parse(requests[1].input.find((item) => item.call_id === 'execute-first' && item.type === 'function_call_output').output);
    expect(firstResult).toMatchObject({ok: true, connection: {id: 'ssh-test', auto_approve: true}});
    const listResult = JSON.parse(requests[2].input.find((item) => item.call_id === 'list' && item.type === 'function_call_output').output);
    expect(listResult.connections.map(({id, auto_approve}) => ({id, auto_approve}))).toEqual([
        {id: 'ssh-test', auto_approve: true}, {id: 'ssh-other', auto_approve: false},
    ]);
});

test('场景：关闭 SSH 免审批后高风险白名单命令恢复确认，模型不能通过参数开启免审批', async ({page}) => {
    const requests = [];
    await installSshMock(page, [{...defaultConnection, autoApprove: true, whitelist: ['printf']}]);
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        requests.push(route.request().postDataJSON());
        await respondToAi(route, requests.length === 1
            ? {output: commandCalls('ssh-test', '', {auto_approve: true})}
            : {output_text: 'SSH 审批检查完成', output: []});
    });
    await page.goto('/codeEditor');
    await page.getByRole('button', {name: 'SSH', exact: true}).click();
    const dialog = await openSshSettings(page);
    await dialog.getByRole('checkbox', {name: '执行命令免审批', exact: true}).uncheck();
    await expect(dialog.getByPlaceholder(/每行一个主命令/)).toHaveValue('printf');
    await dialog.getByRole('button', {name: '确定', exact: true}).click();
    await sendAiPrompt(page);
    const approval = page.getByRole('dialog', {name: '执行', exact: true});
    await expect(approval).toContainText('高风险 SSH 命令');
    await approval.getByRole('button', {name: '取消', exact: true}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('SSH 审批检查完成');
    expect(await page.evaluate(() => window.sshInputs)).toEqual([]);
});
