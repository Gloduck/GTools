import {expect, test} from '@playwright/test';

test('execute_ssh_command 授权框显示在对应 AI 会话内', async ({page}) => {
    const requests = [];
    await page.addInitScript(() => {
        localStorage.setItem('browser-code-editor-settings', JSON.stringify({
            ai: {apiKey: 'test-key', agentModels: 'test-model', baseUrl: 'https://api.openai.com/v1'},
            backend: {enabled: true, baseUrl: location.origin},
            ssh: {
                connections: [{
                    id: 'ssh-test',
                    name: 'Test SSH',
                    host: 'example.com',
                    port: 22,
                    username: 'tester',
                    authType: 'password',
                    password: 'secret',
                    exposeToAi: true,
                    whitelist: ['pwd'],
                }],
            },
        }));

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
                    setTimeout(() => this.dispatchEvent(new MessageEvent('message', {
                        data: JSON.stringify({type: 'connected', connectionId: 'connection-1'}),
                    })));
                }
            }

            close() {
                this.readyState = MockWebSocket.CLOSED;
                this.dispatchEvent(new Event('close'));
            }
        }

        Object.defineProperty(globalThis, 'WebSocket', {configurable: true, value: MockWebSocket});
    });
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
