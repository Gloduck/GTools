import {expect, test} from '@playwright/test';

test.use({channel: 'chromium'});

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGD4DwAAAP//cGajQwAAAAZJREFUAwABDgEC81VxbAAAAABJRU5ErkJggg==';
const image = {id: 'ig-1', type: 'image_generation_call', status: 'completed', output_format: 'png', result: png};
const emptyMessage = {type: 'message', role: 'assistant', content: [{type: 'output_text', text: ''}]};

async function setup(page, response, {stream = true, items = [], workspace = true, beforeSend} = {}) {
    const requests = [];
    await page.addInitScript(() => {
        localStorage.setItem('ui-locale', 'en-US');
        localStorage.setItem('browser-code-editor-settings', JSON.stringify({
            ai: {apiKey: 'test-key', agentModels: 'test-model', imageModel: 'test-image-model', baseUrl: 'https://api.openai.com/v1'},
        }));
    });
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        requests.push(route.request().postDataJSON());
        const events = items.map((item, output_index) => ({type: 'response.output_item.done', item, output_index}));
        const result = typeof response === 'function' ? response(requests) : response;
        events.push({type: 'response.completed', response: {status: 'completed', ...result}});
        await route.fulfill({
            status: 200,
            contentType: stream ? 'text/event-stream' : 'application/json',
            body: stream ? events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') : JSON.stringify(result),
        });
    });
    await page.goto('/codeEditor');
    await expect(page.locator('.monaco-host:not(.diff-host) .monaco-editor')).toBeAttached({timeout: 15000});
    if (workspace) {
        await page.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            for await (const [name] of root.entries()) await root.removeEntry(name, {recursive: true});
            const handle = await root.getFileHandle('existing.png', {create: true});
            const writable = await handle.createWritable();
            await writable.write('existing-file-content');
            await writable.close();
        });
        await page.getByRole('button', {name: 'Open Browser Folder', exact: true}).click();
        await expect(page.locator('.file-tree').getByTitle('existing.png', {exact: true})).toBeVisible();
    }
    if (beforeSend) await beforeSend();
    await page.getByRole('button', {name: 'AI Assistant', exact: true}).click();
    await page.locator('.ai-chat-form textarea').fill('生成一个简单角色的建模参考图。');
    await page.getByRole('button', {name: 'Send', exact: true}).click();
    await expect(page.locator('.ai-message:not(.ai-message-user)')).not.toHaveCount(0);
    await expect(page.getByRole('button', {name: 'Stop AI task', exact: true})).toBeDisabled();
    return requests;
}

for (const terminalHasOutput of [true, false]) {
    test(`原生图片流式结果仅暂存一次，手动保存后才落盘（结束事件包含输出：${terminalHasOutput}）`, async ({page}) => {
        const requests = await setup(page, {output: terminalHasOutput ? [image, emptyMessage] : []}, {items: [image, emptyMessage]});
        const preview = page.locator('.ai-message-tool .ai-image-result');
        await expect(preview).toHaveCount(1);
        await expect(preview).toBeVisible();
        await expect.poll(() => preview.locator('img').evaluate((element) => element.naturalWidth)).toBe(1);
        expect(requests).toHaveLength(1);
        expect(requests[0].stream).toBe(true);
        const path = await preview.getAttribute('title');
        expect(path).toMatch(/^generated-image-.*\.png$/);
        expect(await readFile(page, path)).toBeNull();
        await preview.click();
        await expect(page.locator('.tab').filter({hasText: path})).toBeVisible();
        await page.locator('.ai-tool-toggle').click();
        const result = JSON.parse(await page.locator('.ai-tool-details pre').nth(1).textContent());
        expect(result).toMatchObject({ok: true, image_path: path, input_path: null, operation: 'generated', dirty: true, created: true, mime_type: 'image/png', width: 1, height: 1});
        expect(result).not.toHaveProperty('blob');
        expect(result).not.toHaveProperty('result');
        await saveImage(page, path);
        expect(await readFile(page, path)).toEqual([...Buffer.from(png, 'base64')]);
        expect(Buffer.from(await readFile(page, 'existing.png')).toString()).toBe('existing-file-content');
    });
}

test('非流式响应同时暂存多张原生图片并展示文字', async ({page}) => {
    await setup(page, {output_text: '', output: [
        image, {...image, id: 'ig-2'},
        {type: 'message', content: [{type: 'output_text', text: '参考图已生成。'}]},
    ]}, {stream: false});
    const previews = page.locator('.ai-message-tool .ai-image-result');
    await expect(previews).toHaveCount(2);
    expect(await previews.nth(0).getAttribute('title')).not.toBe(await previews.nth(1).getAttribute('title'));
    await expect(page.locator('.ai-message-assistant').first()).toContainText('参考图已生成。');
});

test('空结果明确报错而不是静默结束', async ({page}) => {
    await setup(page, {output: [emptyMessage]});
    await expect(page.locator('.ai-message-assistant')).toContainText('AI returned no displayable text');
});

test('图片结果缺少数据时展示失败工具卡片且不产生图片改动', async ({page}) => {
    await setup(page, {output: [{...image, result: null}, emptyMessage]});
    await expect(page.locator('.ai-message-tool')).toContainText('without image data');
    await expect(page.locator('.ai-image-result')).toHaveCount(0);
    await expect(page.locator('.ai-tool-toggle')).toContainText('ERROR');
});

test('拒绝答复正常展示而不是被当作空结果', async ({page}) => {
    await setup(page, {output: [{type: 'message', content: [{type: 'refusal', refusal: '无法完成此请求。'}]}]});
    await expect(page.locator('.ai-message-assistant')).toContainText('无法完成此请求。');
});

test('重置对话释放图片预览链接但保留暂存改动', async ({page}) => {
    await setup(page, {output: [image]});
    const path = await page.locator('.ai-image-result').getAttribute('title');
    const url = await page.locator('.ai-image-result img').getAttribute('src');
    await page.getByRole('button', {name: 'More session actions', exact: true}).click();
    await page.getByRole('menuitem', {name: 'Reset Chat', exact: true}).click();
    await expect(page.locator('.ai-image-result')).toHaveCount(0);
    expect(await page.evaluate(async (url) => {
        try { await fetch(url); return false; } catch { return true; }
    }, url)).toBe(true);
    await saveImage(page, path);
    expect(await readFile(page, path)).toEqual([...Buffer.from(png, 'base64')]);
});

test('未打开工作区时按图片工具规则提示失败', async ({page}) => {
    await setup(page, {output: [image]}, {workspace: false});
    await expect(page.locator('.ai-message-tool')).toContainText('Open a workspace first.');
    await expect(page.locator('.ai-image-result')).toHaveCount(0);
});

test('图片暂存失败时不展示成功预览也不遗留改动', async ({page}) => {
    await setup(page, {output: [image]}, {beforeSend: () => page.evaluate(async () => {
        const {FileSession} = await import('/src/shared/file-system/file-session.js');
        FileSession.prototype.stageBlob = async () => { throw new Error('模拟图片暂存失败'); };
    })});
    await expect(page.locator('.ai-message-tool')).toContainText('模拟图片暂存失败');
    await expect(page.locator('.ai-image-result')).toHaveCount(0);
    // 复用文件暂存流程的错误提示，关闭后检查是否残留改动。
    const notice = page.getByRole('dialog', {name: 'Notice', exact: true});
    await expect(notice).toContainText('模拟图片暂存失败');
    await notice.getByRole('button', {name: 'OK', exact: true}).click();
    await page.getByRole('button', {name: 'Changes', exact: true}).click();
    await expect(page.locator('.change-row')).toHaveCount(0);
});

test('普通图片生成工具复用相同暂存流程且向模型返回原有结果结构', async ({page}) => {
    let imageRequests = 0;
    await page.route('https://api.openai.com/v1/images/generations', async (route) => {
        imageRequests++;
        await route.fulfill({json: {data: [{b64_json: png}]}});
    });
    const requests = await setup(page, (requests) => requests.length === 1 ? {output: [{
        type: 'function_call', id: 'call-1', call_id: 'call-1', name: 'generate_or_edit_image',
        arguments: JSON.stringify({prompt: '生成角色参考图', output_path: 'reference.png'}),
    }]} : {output_text: '参考图已生成。'});
    expect(requests).toHaveLength(2);
    expect(imageRequests).toBe(1);
    const result = JSON.parse(requests[1].input.find((item) => item.type === 'function_call_output').output);
    expect(result).toMatchObject({ok: true, image_path: 'reference.png', input_path: null, operation: 'generated', dirty: true, created: true});
    await expect(page.locator('.ai-image-result')).toHaveCount(1);
    expect(await readFile(page, 'reference.png')).toBeNull();
    await saveImage(page, 'reference.png');
    expect(await readFile(page, 'reference.png')).toEqual([...Buffer.from(png, 'base64')]);
});

test('三种调用混合返回时分别处理，只有本地函数触发工具结果回传', async ({page}) => {
    const requests = await setup(page, (requests) => requests.length === 1 ? {output: [
        image,
        {type: 'web_search_call', id: 'ws-1', status: 'completed', action: {type: 'search', query: '角色建模参考'}},
        {type: 'function_call', id: 'fc-1', call_id: 'call-1', name: 'get_tool_availability', arguments: '{}'},
    ]} : {output_text: '已处理图片、搜索和本地工具。'});
    expect(requests).toHaveLength(2);
    expect(requests[1].input.filter((item) => item.type === 'function_call_output')).toHaveLength(1);
    expect(requests[1].input.filter((item) => item.type === 'web_search_call')).toHaveLength(1);
    const cards = page.locator('.ai-message-tool');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0).locator('.ai-tool-toggle')).toContainText('image_generation_call');
    await expect(cards.nth(1).locator('.ai-tool-toggle')).toContainText('web_search_call');
    await expect(cards.nth(2).locator('.ai-tool-toggle')).toContainText('get_tool_availability');
    await expect(page.locator('.ai-image-result')).toHaveCount(1);
    const path = await page.locator('.ai-image-result').getAttribute('title');
    await saveImage(page, path);
    expect(await readFile(page, path)).toEqual([...Buffer.from(png, 'base64')]);
});

async function saveImage(page, path) {
    await page.getByRole('button', {name: 'Changes', exact: true}).click();
    const change = page.locator('.change-row').filter({has: page.locator('small', {hasText: path})});
    await expect(change).toBeVisible();
    await change.getByRole('checkbox').check();
    await page.getByRole('button', {name: 'Save Selected', exact: true}).click();
    await expect(change).toHaveCount(0);
}

async function readFile(page, path) {
    return page.evaluate(async (path) => {
        try {
            const root = await navigator.storage.getDirectory();
            const file = await (await root.getFileHandle(path)).getFile();
            return [...new Uint8Array(await file.arrayBuffer())];
        } catch (error) {
            if (error.name === 'NotFoundError') return null;
            throw error;
        }
    }, path);
}
