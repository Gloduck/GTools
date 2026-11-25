import {expect, test} from '@playwright/test';

for (const locale of ['zh-CN', 'en-US']) {
    test(`工具摘要使用 ${locale}，跨轮保留文件事实而不保留正文`, async ({page}) => {
        const zh = locale === 'zh-CN';
        await page.addInitScript((locale) => {
            localStorage.setItem('ui-locale', locale);
            localStorage.setItem('browser-code-editor-settings', JSON.stringify({
                ai: {apiKey: 'test-key', agentModels: 'test-model', baseUrl: 'https://api.openai.com/v1'},
            }));
        }, locale);
        const requests = [];
        const calls = [
            ['read_file', {path: 'sample.txt', max_chars: 1000}],
            ['replace_in_files', {edits: [
                {path: 'sample.txt', old_text: 'original', new_text: 'changed'},
                {path: 'sample.txt', old_text: 'absent-pattern', new_text: 'unused'},
            ]}],
            ['read_files', {paths: ['sample.txt']}],
            ['open_file', {path: 'sample.txt'}],
            ['get_current_file', {}],
            ['run_javascript', {reason: '生成结果文件', code: "require('node:fs').writeFileSync('result.txt', 'generated-body-marker'); module.exports = 42;", format: 'commonjs', output_files: [{path: 'result.txt', type: 'text'}]}],
        ];
        await page.route('https://api.openai.com/v1/responses', async (route) => {
            requests.push(route.request().postDataJSON());
            const response = requests.length === 1 ? {output: calls.map(([name, args], index) => ({
                type: 'function_call', call_id: `summary-${index}`, name, arguments: JSON.stringify(args),
            }))} : {output_text: 'Done.', output: []};
            await route.fulfill({status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify({type: 'response.completed', response})}\n\ndata: [DONE]\n\n`});
        });
        // 浏览器可能拒绝持久化授权，按正常交互确认提示后继续检查摘要。
        const storageNotice = page.getByRole('dialog').filter({hasText: /持久存储|persistent storage/});
        await page.addLocatorHandler(storageNotice, async () => {
            await storageNotice.getByRole('button', {name: zh ? '确定' : 'OK', exact: true}).click();
        });
        await page.goto('/codeEditor');
        await expect(page.locator('.monaco-host:not(.diff-host) .monaco-editor')).toBeAttached();
        await page.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            const file = await root.getFileHandle('sample.txt', {create: true});
            const writer = await file.createWritable();
            await writer.write('original\nprivate-file-body-marker\n' + 'x'.repeat(1500));
            await writer.close();
        });
        await page.getByRole('button', {name: zh ? '打开浏览器文件夹' : 'Open Browser Folder', exact: true}).click();
        await page.getByRole('button', {name: zh ? 'AI 助手' : 'AI Assistant', exact: true}).click();
        await page.locator('.ai-chat-form textarea').fill('执行文件操作');
        await page.getByRole('button', {name: zh ? '发送' : 'Send', exact: true}).click();
        await expect(page.locator('.ai-message-assistant')).toContainText('Done.');
        expect(requests).toHaveLength(2);
        const results = requests[1].input.filter((item) => item.type === 'function_call_output').map((item) => JSON.parse(item.output));
        expect(results).toHaveLength(calls.length);
        expect(results.every((result) => result.ok)).toBe(true);
        expect(results[0]).toMatchObject({returned_chars: 1000, truncated: true});
        expect(results[0].summary).toContain(zh ? '部分内容' : 'partial content');
        expect(results[1]).toMatchObject({applied: 1, failed: 1});
        expect(results[1].summary).toContain(zh ? '第 2 项 sample.txt' : '#2 sample.txt');
        expect(results[2].files[0].content).toContain('private-file-body-marker');
        expect(results[2].summary).toContain(zh ? '未保存' : 'Unsaved');
        expect(results[4].summary).toContain(zh ? '当前文件' : 'Current file');
        expect(results[5]).toMatchObject({exit_code: 0});
        expect(results[5].summary).toContain('result.txt');
        for (const result of results) {
            expect(result.summary).not.toContain('codeEditor.');
            expect(result.summary).not.toContain('private-file-body-marker');
            expect(result.summary).not.toContain('generated-body-marker');
        }
        await page.locator('.ai-chat-form textarea').fill('继续刚才的工作');
        await page.getByRole('button', {name: zh ? '发送' : 'Send', exact: true}).click();
        await expect.poll(() => requests.length).toBe(3);
        const history = JSON.stringify(requests[2].input);
        expect(history).toContain('sample.txt');
        expect(history).toContain('result.txt');
        expect(history).toContain(zh ? '未保存' : 'Unsaved');
        expect(history).not.toContain('private-file-body-marker');
        expect(history).not.toContain('generated-body-marker');
    });
}

test('loadDocument 批量保留本地及远端文本，压缩和恢复后仍带全文', async ({page}) => {
    await page.addInitScript(() => {
        localStorage.setItem('ui-locale', 'zh-CN');
        localStorage.setItem('browser-code-editor-settings', JSON.stringify({
            ai: {apiKey: 'test-key', agentModels: 'test-model', baseUrl: 'https://api.openai.com/v1', autoSaveSessions: true},
            backend: {enabled: false},
        }));
    });
    const source = 'https://docs.example.test/manual';
    const text = '资料'.repeat(12000) + 'full-document-end';
    let reads = 0;
    await page.route(source, (route) => {
        reads++;
        return route.fulfill({contentType: 'application/octet-stream', body: Buffer.from('\ufeffremote-document-end', 'utf16le')});
    });
    const requests = [];
    await page.route('https://api.openai.com/v1/responses', (route) => {
        const body = route.request().postDataJSON();
        requests.push(body);
        const response = requests.length === 1 ? {output: [{
            type: 'function_call', call_id: 'load', name: 'loadDocument',
            arguments: JSON.stringify({sources: ['manual.custom', source, 'missing.txt', source]}),
        }]} : {output_text: body.instructions.startsWith('Compress') ? 'compressed' : 'Done.', output: []};
        return route.fulfill({contentType: 'text/event-stream', body: `data: ${JSON.stringify({type: 'response.completed', response})}\n\ndata: [DONE]\n\n`});
    });
    await page.addLocatorHandler(page.getByRole('dialog').filter({hasText: /持久存储/}), (dialog) =>
        dialog.getByRole('button', {name: '确定', exact: true}).click());
    await page.goto('/codeEditor');
    await page.evaluate(async (text) => {
        const root = await navigator.storage.getDirectory();
        const writer = await (await root.getFileHandle('manual.custom', {create: true})).createWritable();
        await writer.write(text);
        await writer.close();
    }, text);
    await page.getByRole('button', {name: '打开浏览器文件夹', exact: true}).click();
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    const send = async (prompt) => {
        await page.locator('.ai-chat-form textarea').fill(prompt);
        await page.getByRole('button', {name: '发送', exact: true}).click();
    };
    await send('加载文档');
    await expect(page.locator('.ai-message-assistant').last()).toContainText('Done.');
    const result = JSON.parse(requests[1].input.find((item) => item.type === 'function_call_output').output);
    expect(result.documents).toEqual([{source: 'manual.custom', content: text}, {source, content: 'remote-document-end'}]);
    expect(result.errors).toMatchObject([{source: 'missing.txt'}]);
    await page.getByRole('button', {name: '更多会话操作', exact: true}).click();
    await page.getByRole('menuitem', {name: '压缩上下文', exact: true}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('compressed');
    await page.reload();
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    await page.getByRole('button', {name: '切换会话', exact: true}).click();
    await page.locator('.ai-history-item-main').first().click();
    await send('继续分析文档');
    await expect(page.locator('.ai-message-assistant').last()).toContainText('Done.');
    const input = requests.at(-1).input;
    for (const doc of result.documents) {
        expect(input.filter((item) => item.content?.includes(JSON.stringify(doc)))).toHaveLength(1);
    }
    expect(reads).toBe(1);
    await page.getByRole('button', {name: '更多会话操作', exact: true}).click();
    await page.getByRole('menuitem', {name: '重置对话', exact: true}).click();
    await send('开始新的任务');
    await expect(page.locator('.ai-message-assistant').last()).toContainText('Done.');
    expect(JSON.stringify(requests.at(-1).input)).not.toContain('full-document-end');
    expect(JSON.stringify(requests.at(-1).input)).not.toContain('remote-document-end');
});
