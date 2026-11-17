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
