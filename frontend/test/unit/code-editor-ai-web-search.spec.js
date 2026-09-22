import {expect, test} from '@playwright/test';

test.use({channel: 'chromium'});

const search = {
    type: 'web_search_call', id: 'ws-1', status: 'completed',
    action: {type: 'search', queries: ['Vue 最新文档'], sources: [{type: 'url', url: 'https://vuejs.org/guide/', title: 'Vue 文档'}]},
};

async function setup(page, responses, {stream = true, items = []} = {}) {
    const requests = [];
    await page.addInitScript(() => {
        localStorage.setItem('ui-locale', 'zh-CN');
        localStorage.setItem('browser-code-editor-settings', JSON.stringify({
            ai: {apiKey: 'test-key', agentModels: 'test-model', baseUrl: 'https://api.openai.com/v1', autoSaveSessions: true},
        }));
    });
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        requests.push(route.request().postDataJSON());
        const response = responses[requests.length - 1] || {output_text: '已完成。'};
        const events = items.map((item, output_index) => ({type: 'response.output_item.done', item, output_index}));
        events.push({type: 'response.completed', response});
        await route.fulfill({
            status: 200,
            contentType: stream ? 'text/event-stream' : 'application/json',
            body: stream ? events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') : JSON.stringify(response),
        });
    });
    await page.goto('/codeEditor');
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    await page.locator('.ai-chat-form textarea').fill('搜索 Vue 文档。');
    await page.getByRole('button', {name: '发送', exact: true}).click();
    await expect(page.locator('.ai-message:not(.ai-message-user)')).not.toHaveCount(0);
    await expect(page.locator('.ai-chat-form textarea')).toBeEnabled();
    return requests;
}

for (const terminalHasOutput of [true, false]) {
    test(`原生搜索仅展示一次且不触发本地搜索或额外模型请求（结束事件包含输出：${terminalHasOutput}）`, async ({page}) => {
        const requests = await setup(page, [{output: terminalHasOutput ? [search] : []}], {items: [search]});
        const card = page.locator('.ai-message-tool');
        await expect(card).toHaveCount(1);
        await expect(card).toContainText('服务端网页搜索已完成');
        await expect(card.locator('.ai-tool-toggle')).toContainText('成功');
        await expect(card.getByRole('link', {name: '[1] Vue 文档', exact: true})).toHaveAttribute('href', 'https://vuejs.org/guide/');
        await card.locator('.ai-tool-toggle').click();
        await expect(card.locator('.ai-tool-details')).toContainText('Vue 最新文档');
        expect(requests).toHaveLength(1);
        expect(requests[0].tools.every((tool) => tool.type === 'function')).toBe(true);
        await expect(page.locator('.ai-message-assistant')).toHaveCount(0);
    });
}

test('网页搜索与本地函数混合返回时仅回传函数结果并保留搜索上下文', async ({page}) => {
    const call = {type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'get_tool_availability', arguments: JSON.stringify({names: ['read_image']})};
    const requests = await setup(page, [{output: [search, call]}, {output_text: '已结合搜索结果检查工具。'}]);
    expect(requests).toHaveLength(2);
    const input = requests[1].input;
    expect(input.find((item) => item.type === 'web_search_call')).toEqual(search);
    const results = input.filter((item) => item.type === 'function_call_output');
    expect(results).toHaveLength(1);
    expect(results[0].call_id).toBe('call-1');
    expect(JSON.parse(results[0].output).ok).toBe(true);
    await expect(page.locator('.ai-tool-toggle').nth(0)).toContainText('web_search_call');
    await expect(page.locator('.ai-tool-toggle').nth(1)).toContainText('get_tool_availability');
    await expect(page.locator('.ai-message-assistant')).toContainText('已结合搜索结果检查工具。');
});

test('非流式回答展示安全去重来源，特殊字符和查询参数保持原样', async ({page}) => {
    const url = 'https://example.com/docs?a=1&b=2';
    const title = '<img src=x onerror=alert(1)> & [文档]';
    await setup(page, [{output_text: '文档说明。', output: [search, {type: 'message', content: [{
        type: 'output_text', text: '文档说明。', annotations: [
            {type: 'url_citation', url, title, start_index: 0, end_index: 5},
            {type: 'url_citation', url, title: '重复来源'},
            {type: 'url_citation', url: 'javascript:alert(1)', title: '危险来源'},
            {type: 'url_citation', url: 'data:text/html,test', title: '数据来源'},
            {type: 'url_citation', url: 'https://user:password@example.com/', title: '带凭据来源'},
        ],
    }]}]}], {stream: false});
    const answer = page.locator('.ai-message-assistant');
    await expect(answer).toContainText('文档说明。');
    await expect(answer.locator('.ai-message-sources a')).toHaveCount(1);
    const link = answer.locator('.ai-message-sources a');
    await expect(link).toHaveAttribute('href', url);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveText(`[1] ${title}`);
    await expect(answer.locator('img')).toHaveCount(0);
});

test('已保存会话恢复后保留搜索来源链接', async ({page}) => {
    await setup(page, [{output: [search]}]);
    await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
        const open = indexedDB.open('browser-code-editor');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const request = db.transaction('aiSessions').objectStore('aiSessions').getAll();
            request.onsuccess = () => { db.close(); resolve(request.result.some((session) => session.messages.some((message) => message.sources?.length))); };
            request.onerror = () => { db.close(); reject(request.error); };
        };
    }))).toBe(true);
    await page.reload();
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    await page.getByRole('button', {name: '切换会话', exact: true}).click();
    await page.locator('.ai-history-item-main').first().click();
    await expect(page.locator('.ai-message-sources a')).toHaveAttribute('href', 'https://vuejs.org/guide/');
});

test('打开网页和页内查找使用同一搜索卡片且没有工作区要求', async ({page}) => {
    await setup(page, [{output: [
        {...search, id: 'ws-open', action: {type: 'open_page', url: 'https://vuejs.org/guide/'}},
        {...search, id: 'ws-find', action: {type: 'find_in_page', url: 'https://vuejs.org/guide/', pattern: 'reactivity'}},
    ]}]);
    await expect(page.locator('.ai-message-tool').nth(0)).toContainText('服务端网页读取已完成');
    await expect(page.locator('.ai-message-tool').nth(1)).toContainText('服务端页内查找已完成');
    await expect(page.locator('.ai-message-sources a')).toHaveCount(2);
});

test('失败或未完成的服务端搜索不会展示为成功或一直运行', async ({page}) => {
    await setup(page, [{output: [
        {...search, id: 'ws-failed', status: 'failed', error: {message: '搜索额度不足'}},
        {...search, id: 'ws-pending', status: 'in_progress'},
    ]}]);
    for (const card of await page.locator('.ai-message-tool').all()) {
        await expect(card.locator('.ai-tool-toggle')).toContainText('失败');
        await expect(card).toContainText('未成功完成');
    }
    await expect(page.locator('.ai-tool-details').first()).toContainText('搜索额度不足');
});

test('未支持的调用明确提示且不会执行，推理记录不被误判为工具', async ({page}) => {
    const requests = await setup(page, [{output: [
        {type: 'reasoning', id: 'reason-1', summary: []},
        {type: 'computer_call', id: 'computer-1', action: {type: 'click', x: 1, y: 1}},
        {type: 'mcp_approval_request', id: 'approval-1'},
    ]}]);
    expect(requests).toHaveLength(1);
    await expect(page.locator('.ai-message-tool')).toHaveCount(2);
    await expect(page.locator('.ai-message-tool').nth(0)).toContainText('暂不支持 AI 返回的 computer_call');
    await expect(page.locator('.ai-message-tool').nth(1)).toContainText('暂不支持 AI 返回的 mcp_approval_request');
    await expect(page.getByRole('dialog')).toHaveCount(0);
});
