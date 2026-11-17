import {expect, test} from '@playwright/test';

test('AI ask_user 工具显示建议选项并返回用户选择', async ({page}) => {
    const {dialog, requests} = await openQuestion(page);

    await expect(dialog.getByRole('button', {name: /使用 TypeScript/})).toBeVisible();
    await expect(dialog.getByRole('textbox')).toBeVisible();
    await dialog.getByRole('button', {name: /使用 TypeScript/}).click();
    await dialog.getByRole('button', {name: '提交答案'}).click();

    await expect(page.locator('.ai-message-assistant')).toContainText('已记录你的选择。');
    const result = getToolResult(requests);
    expect(result.answer).toBe('使用 TypeScript');
    expect(result.selected_option).toEqual({label: '使用 TypeScript', description: '类型更严格'});
    expect(result.custom).toBe(false);
});

test('AI ask_user 工具支持用户输入自定义答案', async ({page}) => {
    const {dialog, requests} = await openQuestion(page);

    await dialog.getByRole('textbox').fill('改用 Kotlin');
    await dialog.getByRole('textbox').press('Enter');

    await expect(page.locator('.ai-message-assistant')).toContainText('已记录你的选择。');
    const result = getToolResult(requests);
    expect(result.answer).toBe('改用 Kotlin');
    expect(result.selected_option).toBeNull();
    expect(result.custom).toBe(true);
});

test('AI ask_user 主动取消保留取消事实且不伪造答案', async ({page}) => {
    const {dialog, requests} = await openQuestion(page);
    await dialog.getByRole('button', {name: '取消', exact: true}).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.ai-message-assistant')).toContainText('已记录你的选择。');
    const result = getToolResult(requests);
    expect(result.cancelled).toBe(true);
    expect(result.interrupted).toBeUndefined();
    expect(result.answer).toBeUndefined();
    expect(result.selected_option).toBeUndefined();
});

test('AI ask_user 弹框按会话隔离', async ({page}) => {
    const requests = [];
    await page.addInitScript(() => {
        localStorage.setItem('browser-code-editor-settings', JSON.stringify({
            ai: {apiKey: 'test-key', agentModels: 'test-model', baseUrl: 'https://api.openai.com/v1'},
        }));
    });
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        requests.push(route.request().postDataJSON());
        const question = requests.length === 1 ? '会话 A 的问题' : '会话 B 的问题';
        const body = `data: ${JSON.stringify({type: 'response.completed', response: {output: [{type: 'function_call', call_id: `call-${requests.length}`, name: 'ask_user', arguments: JSON.stringify({question, options: [{label: '选项'}]})}]}})}\n\ndata: [DONE]\n\n`;
        await route.fulfill({status: 200, headers: {'content-type': 'text/event-stream'}, body});
    });

    await page.goto('/codeEditor');
    await page.getByRole('button', {name: 'AI 助手'}).click();
    await page.locator('.ai-chat-form textarea').fill('开始会话 A');
    await page.getByRole('button', {name: '发送'}).click();
    const dialog = page.getByRole('dialog', {name: 'AI 需要你的回答'});
    await expect(dialog).toContainText('会话 A 的问题');

    await page.getByRole('button', {name: '新建会话'}).click();
    await expect(dialog).toBeHidden();
    await page.locator('.ai-chat-form textarea').fill('开始会话 B');
    await page.getByRole('button', {name: '发送'}).click();
    await expect(dialog).toContainText('会话 B 的问题');

    await page.getByRole('button', {name: '切换会话'}).click();
    await expect(page.locator('.ai-history-item-main')).toHaveCount(2);
    await page.locator('.ai-history-item-main').filter({hasText: '会话 1'}).click();
    await expect(dialog).toContainText('会话 A 的问题');
});

async function openQuestion(page, locale = 'zh-CN') {
    const requests = [];
    await page.addInitScript((locale) => {
        localStorage.setItem('ui-locale', locale);
        localStorage.setItem('browser-code-editor-settings', JSON.stringify({
            ai: {apiKey: 'test-key', agentModels: 'test-model', baseUrl: 'https://api.openai.com/v1'},
        }));
    }, locale);
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        requests.push(route.request().postDataJSON());
        const response = requests.length === 1
            ? {
                output: [{
                    type: 'function_call',
                    id: 'function-call-1',
                    call_id: 'call-1',
                    name: 'ask_user',
                    arguments: JSON.stringify({
                        question: '选择实现语言',
                        options: [
                            {label: '使用 TypeScript', description: '类型更严格'},
                            {label: '使用 JavaScript', description: '配置更简单'},
                        ],
                    }),
                }],
            }
            : {output_text: '已记录你的选择。', output: []};
        const body = `data: ${JSON.stringify({type: 'response.completed', response})}\n\ndata: [DONE]\n\n`;
        await route.fulfill({status: 200, headers: {'content-type': 'text/event-stream'}, body});
    });

    await page.goto('/codeEditor');
    await page.getByRole('button', {name: locale === 'zh-CN' ? 'AI 助手' : 'AI Assistant', exact: true}).click();
    await page.locator('.ai-chat-form textarea').fill('帮我决定实现语言');
    await page.getByRole('button', {name: locale === 'zh-CN' ? '发送' : 'Send', exact: true}).click();

    const dialog = page.getByRole('dialog', {name: locale === 'zh-CN' ? 'AI 需要你的回答' : 'AI needs your answer'});
    await expect(dialog).toBeVisible();
    return {dialog, requests};
}

function getToolResult(requests) {
    expect(requests).toHaveLength(2);
    const output = requests[1].input.find((item) => item.type === 'function_call_output');
    return JSON.parse(output.output);
}

for (const locale of ['zh-CN', 'en-US']) {
    test(`问题摘要使用 ${locale}，后续普通对话保留用户真实回答`, async ({page}) => {
        const {dialog, requests} = await openQuestion(page, locale);
        await dialog.getByRole('textbox').fill('改用 Kotlin');
        await dialog.getByRole('textbox').press('Enter');
        await expect(page.locator('.ai-message-assistant')).toContainText('已记录你的选择。');
        const result = getToolResult(requests);
        expect(result.summary).toContain(locale === 'zh-CN' ? '用户回答：改用 Kotlin' : 'User answer: 改用 Kotlin');
        for (const line of result.summary.split('\n')) await expect(page.locator('.ai-message-tool').first()).toContainText(line);
        await page.locator('.ai-chat-form textarea').fill('接着按刚才的选择继续');
        await page.getByRole('button', {name: locale === 'zh-CN' ? '发送' : 'Send', exact: true}).click();
        await expect.poll(() => requests.length).toBe(3);
        const history = JSON.stringify(requests[2].input);
        expect(history).toContain('选择实现语言');
        expect(history).toContain('改用 Kotlin');
    });
}
