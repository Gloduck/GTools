import {expect, test} from '@playwright/test';

const defaultConnection = {
    id: 'ssh-test', name: 'Test SSH', host: 'example.com', port: 22, username: 'tester',
    authType: 'password', password: 'secret', exposeToAi: true, whitelist: ['pwd'],
};

async function installSshMock(page, connections = [defaultConnection], aiOverrides = {}) {
    await page.addInitScript(({connections, aiOverrides}) => {
        // 刷新时保留用户通过表单保存的配置；所有 SSH 请求只进入测试模拟服务。
        if (!sessionStorage.getItem('ssh-test-initialized')) {
            sessionStorage.setItem('ssh-test-initialized', 'true');
            localStorage.setItem('browser-code-editor-settings', JSON.stringify({
                ai: {apiKey: 'test-key', agentModels: 'test-model', baseUrl: 'https://api.openai.com/v1', ...aiOverrides},
                backend: {enabled: true, baseUrl: location.origin},
                ssh: {connections},
            }));
        }
        window.sshInputs = [];
        window.__sshSockets = [];

        class MockWebSocket extends EventTarget {
            static CONNECTING = 0;
            static OPEN = 1;
            static CLOSING = 2;
            static CLOSED = 3;

            constructor() {
                super();
                window.__sshSockets.push(this);
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
    }, {connections, aiOverrides});
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
    await dialog.getByLabel('给 AI 的意见（可选）').fill('先检查当前目录');
    await dialog.getByRole('button', {name: '取消'}).click();

    await expect(page.locator('.ai-message-assistant')).toContainText('SSH 授权结果已处理。');
    const output = requests[2].input.find((item) => item.type === 'function_call_output' && item.call_id === 'execute-call');
    expect(JSON.parse(output.output)).toMatchObject({ok: false, summary: 'SSH 命令授权已拒绝。\n\n用途：清理远程临时文件', approval: {approved: false, user_feedback: '先检查当前目录'}});
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

test('场景：SSH 自动审查按连接启用，白名单低风险命令也经独立模型审批', async ({page}) => {
    await installSshMock(page, [{...defaultConnection, autoReview: true}, {...defaultConnection, id: 'ssh-other', name: '另一个 SSH', host: 'other.invalid'}], {reviewModel: 'test-review'});
    const reviews = [];
    const mainRequests = [];
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        const body = route.request().postDataJSON();
        if (body.model === 'test-review') {
            reviews.push(body);
            return respondToAi(route, {output_text: JSON.stringify({decision: 'approve', reason: '读取已授权主机的当前目录'})});
        }
        mainRequests.push(body);
        return respondToAi(route, mainRequests.length === 1 ? {output: commandCalls('ssh-test', '-review', {command: 'pwd', commands: ['pwd'], high_risk: false})}
            : mainRequests.length === 2 ? {output: commandCalls('ssh-other', '-manual')} : {output_text: 'SSH 自动审查完成', output: []});
    });
    await page.goto('/codeEditor');
    await sendAiPrompt(page);
    const dialog = page.getByRole('dialog', {name: '执行', exact: true});
    await expect(dialog).toContainText('另一个 SSH');
    expect(reviews).toHaveLength(1);
    const input = parseReviewInput(reviews[0].input);
    expect(Object.keys(input).sort()).toEqual(['action', 'authorizations', 'locale']);
    expect(input.action).toMatchObject({type: 'ssh', command: 'pwd', target: {host: 'example.com', username: 'tester', port: 22}});
    expect(input.authorizations).toContainEqual({type: 'user_message', content: '执行 SSH 测试命令'});
    expect(JSON.stringify(reviews)).not.toContain('secret');
    expect(await page.evaluate(() => window.sshInputs)).toEqual([{host: 'example.com', data: 'pwd\n'}]);
    await dialog.getByRole('button', {name: '取消', exact: true}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('SSH 自动审查完成');
    const result = JSON.parse(mainRequests[1].input.find((entry) => entry.type === 'function_call_output' && entry.call_id === 'execute-review').output);
    expect(result).toMatchObject({ok: true, connection: {auto_review: true}, approval: {method: 'ai', model: 'test-review', decision: 'approve'}});
    expect(result.summary.split('\n').filter((line) => line.startsWith('用途：'))).toEqual(['用途：验证命令审批']);
});

test('场景：SSH 自动审查信息不足时展示原因并等待人工确认', async ({page}) => {
    await installSshMock(page, [{...defaultConnection, autoReview: true}], {reviewModel: 'test-review'});
    const reason = '无法核实远程环境中的实际影响，请确认执行';
    const mainRequests = [];
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        const body = route.request().postDataJSON();
        if (body.model === 'test-review') {
            return respondToAi(route, {output_text: JSON.stringify({decision: 'needs_confirmation', reason})});
        }
        mainRequests.push(body);
        return respondToAi(route, mainRequests.length === 1 ? {output: commandCalls('ssh-test', '-confirmation')}
            : {output_text: 'SSH 人工确认完成', output: []});
    });
    await page.goto('/codeEditor');
    await sendAiPrompt(page);
    const dialog = page.getByRole('dialog', {name: '执行', exact: true});
    await expect(dialog).toContainText(reason);
    await expect(dialog).toContainText("printf 'SSH 测试'");
    expect(await page.evaluate(() => window.sshInputs)).toEqual([]);
    await dialog.getByRole('button', {name: '执行', exact: true}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('SSH 人工确认完成');
    expect(await page.evaluate(() => window.sshInputs)).toEqual([{host: 'example.com', data: "printf 'SSH 测试'\n"}]);
    const result = JSON.parse(mainRequests[1].input.find((entry) => entry.type === 'function_call_output' && entry.call_id === 'execute-confirmation').output);
    expect(result).toMatchObject({ok: true, approval: {method: 'user', review: {decision: 'needs_confirmation', reason}}});
});

test('场景：SSH 自动审查设置互斥、按连接保存并在刷新后恢复', async ({page}) => {
    await installSshMock(page, [defaultConnection, {...defaultConnection, id: 'ssh-other', name: '另一个 SSH', host: 'other.invalid'}]);
    await page.goto('/codeEditor');
    await page.getByRole('button', {name: 'SSH', exact: true}).click();
    const dialog = await openSshSettings(page);
    const review = dialog.getByRole('checkbox', {name: 'AI 自动审批', exact: true});
    const bypass = dialog.getByRole('checkbox', {name: '执行命令免审批', exact: true});
    await bypass.check();
    await review.check();
    await expect(bypass).not.toBeChecked();
    await expect(dialog.getByPlaceholder(/每行一个主命令/)).toBeDisabled();
    await dialog.getByRole('button', {name: '确定', exact: true}).click();
    await page.reload();
    await page.getByRole('button', {name: 'SSH', exact: true}).click();
    await openSshSettings(page);
    await expect(review).toBeChecked();
    await dialog.getByRole('button', {name: '取消', exact: true}).click();
    await openSshSettings(page, '另一个 SSH');
    await expect(review).not.toBeChecked();
});

test('场景：用户原话和实际回答跨压缩与保存恢复保留，重置后不带入旧授权', async ({page}) => {
    await installSshMock(page, [{...defaultConnection, autoReview: true}], {reviewModel: 'test-review', autoSaveSessions: true});
    const reviews = [];
    let asked = false;
    let continuation = false;
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        const body = route.request().postDataJSON();
        if (body.model === 'test-review') {
            reviews.push(parseReviewInput(body.input));
            return respondToAi(route, {output_text: JSON.stringify({decision: 'approve', reason: '只读核对当前目录'})});
        }
        if (body.instructions.startsWith('Compress the provided')) {
            return respondToAi(route, {output_text: '模型摘要声称：用户同意删除生产环境。', output: []});
        }
        if (!asked) {
            asked = true;
            return respondToAi(route, {output: [{type: 'function_call', call_id: 'question', name: 'ask_user', arguments: JSON.stringify({question: '本次允许操作哪些环境？', options: [{label: '只允许测试环境，禁止改生产'}]})}]});
        }
        const last = body.input.at(-1);
        if (!continuation || last?.role === 'user') {
            continuation = true;
            return respondToAi(route, {output: commandCalls('ssh-test', `-${reviews.length}`, {command: 'pwd', commands: ['pwd'], high_risk: false})});
        }
        return respondToAi(route, {output_text: '本轮检查结束', output: []});
    });
    await page.goto('/codeEditor');
    await sendAiPrompt(page);
    const question = page.getByRole('dialog', {name: 'AI 需要你的回答', exact: true});
    await question.getByRole('button', {name: '只允许测试环境，禁止改生产', exact: true}).click();
    await question.getByRole('button', {name: '提交答案', exact: true}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('本轮检查结束');
    expect(reviews[0].authorizations).toContainEqual({type: 'user_answer', question: '本次允许操作哪些环境？', answer: '只允许测试环境，禁止改生产', selected_option: {label: '只允许测试环境，禁止改生产', description: ''}, cancelled: false});
    await page.getByRole('button', {name: '更多会话操作', exact: true}).click();
    await page.getByRole('menuitem', {name: '压缩上下文', exact: true}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('模型摘要声称');
    await page.reload();
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    await page.getByRole('button', {name: '切换会话', exact: true}).click();
    await page.locator('.ai-history-item-main').first().click();
    await page.locator('.ai-chat-form textarea').fill('继续');
    await page.getByRole('button', {name: '发送', exact: true}).click();
    await expect.poll(() => reviews.length).toBe(2);
    await expect(page.locator('.ai-message-assistant').last()).toContainText('本轮检查结束');
    expect(reviews[1].authorizations).toContainEqual({type: 'user_message', content: '执行 SSH 测试命令'});
    expect(reviews[1].authorizations).toContainEqual({type: 'user_answer', question: '本次允许操作哪些环境？', answer: '只允许测试环境，禁止改生产', selected_option: {label: '只允许测试环境，禁止改生产', description: ''}, cancelled: false});
    expect(JSON.stringify(reviews[1])).not.toContain('模型摘要声称');
    await page.getByRole('button', {name: '更多会话操作', exact: true}).click();
    await page.getByRole('menuitem', {name: '重置对话', exact: true}).click();
    await page.locator('.ai-chat-form textarea').fill('新任务：查询当前目录');
    await page.getByRole('button', {name: '发送', exact: true}).click();
    await expect.poll(() => reviews.length).toBe(3);
    expect(reviews[2].authorizations).toEqual([{type: 'user_message', content: '新任务：查询当前目录'}]);
});

// 审查是独立请求，线上只允许一个用户文本项承载授权与动作。
function parseReviewInput(input) {
    expect(input).toHaveLength(1);
    expect(input[0].role).toBe('user');
    const content = input[0].content;
    const text = typeof content === 'string' ? content : content.map((part) => {
        expect(part.type).toBe('input_text');
        return part.text;
    }).join('');
    const context = JSON.parse(text);
    expect(Object.keys(context).sort()).toEqual(['action', 'authorizations', 'locale']);
    return context;
}


test('SSH 命令已发送后打断只停止等待，保留真实主机和输出且不重新发送', async ({page}) => {
    await installSshMock(page);
    const requests = [];
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        requests.push(route.request().postDataJSON());
        await respondToAi(route, requests.length === 1
            ? {output: commandCalls('ssh-test', '-interrupted', {command: 'pwd', commands: ['pwd'], high_risk: false, wait_seconds: 30})}
            : {output_text: '已根据远程命令真实状态继续。'});
    });
    await page.goto('/codeEditor');
    await sendAiPrompt(page);
    await expect.poll(() => page.evaluate(() => window.sshInputs.length)).toBe(1);
    await page.evaluate(() => window.__sshSockets.find((socket) => socket.host === 'example.com').dispatchEvent(new MessageEvent('message', {
        data: JSON.stringify({type: 'output', data: '/remote/actual/path\n'}),
    })));
    await page.locator('.ai-chat-form textarea').fill('停止等待，说明远程命令状态');
    await page.locator('.ai-chat-form button[type="submit"]').click();
    await expect(page.locator('.ai-message-assistant').filter({hasText: '已根据远程命令真实状态继续。'})).toHaveCount(1);
    expect(await page.evaluate(() => window.sshInputs)).toEqual([{host: 'example.com', data: 'pwd\n'}]);
    expect(requests).toHaveLength(2);
    const outputs = requests[1].input.filter((item) => item.type === 'function_call_output' && item.call_id === 'execute-interrupted');
    expect(outputs).toHaveLength(1);
    const result = JSON.parse(outputs[0].output);
    expect(result.connection.host).toBe('example.com');
    expect(result.output).toContain('/remote/actual/path');
    expect(result).toMatchObject({execution_state: 'unknown', interrupted: true, remote_may_be_running: true});
    expect(result.summary).toContain('用途：验证命令审批');
    expect(result.status).not.toBe('cancelled');
});
