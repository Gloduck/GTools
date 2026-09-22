import {expect, test} from '@playwright/test';

test.use({
    channel: 'chromium',
    viewport: {width: 1280, height: 900},
    // 只自动接受浏览器选择器，截图和工作区写入均使用真实实现。
    launchOptions: async ({launchOptions}, use) => {
        await use({...launchOptions, args: [...(launchOptions.args || []), '--auto-accept-this-tab-capture']});
    },
});

async function setup(page) {
    const requests = [];
    let pending = [], sequence = 0;
    await page.addInitScript(() => {
        if (window !== window.top) return;
        localStorage.setItem('ui-locale', 'en-US');
        localStorage.setItem('browser-code-editor-settings', JSON.stringify({
            ai: {apiKey: 'test-key', agentModels: 'test-model', baseUrl: 'https://api.openai.com/v1'},
        }));
        window.displayRequests = 0;
        const getDisplayMedia = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getDisplayMedia = (...args) => {
            window.displayRequests++;
            return getDisplayMedia(...args);
        };
    });
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        requests.push(route.request().postDataJSON());
        const output = pending;
        pending = [];
        const response = output.length ? {output} : {output: [], output_text: '检查完成'};
        await route.fulfill({
            status: 200,
            headers: {'content-type': 'text/event-stream'},
            body: `data: ${JSON.stringify({type: 'response.completed', response})}\n\ndata: [DONE]\n\n`,
        });
    });
    await page.goto('/codeEditor');
    await expect(page.locator('.monaco-host:not(.diff-host) .monaco-editor')).toBeAttached({timeout: 15000});
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        for await (const [name] of root.entries()) await root.removeEntry(name, {recursive: true});
        for (const [name, content] of Object.entries({
            'index.html': '<style>body{background:rgb(20,180,60)}</style><h1>Original</h1><script src="main.js"></script>',
            'main.js': 'document.querySelector("h1").dataset.version="saved";',
            'existing.png': 'existing-file-content',
        })) {
            const handle = await root.getFileHandle(name, {create: true});
            const writable = await handle.createWritable();
            await writable.write(content);
            await writable.close();
        }
    });
    await page.getByRole('button', {name: 'Open Browser Folder', exact: true}).click();
    await expect(page.locator('.file-tree').getByTitle('index.html', {exact: true})).toBeVisible();

    async function start(calls) {
        const startIndex = requests.length;
        sequence++;
        const ids = calls.map((_, index) => `preview-${sequence}-${index}`);
        pending = calls.map(([name, args = {}], index) => ({
            type: 'function_call', id: ids[index], call_id: ids[index], name, arguments: JSON.stringify(args),
        }));
        if (!await page.locator('.ai-chat-form textarea').isVisible()) {
            await page.getByRole('button', {name: 'AI Assistant', exact: true}).click();
        }
        await page.locator('.ai-chat-form textarea').fill(`检查预览 ${sequence}`);
        await page.getByRole('button', {name: 'Send', exact: true}).click();
        return {startIndex, ids};
    }
    async function finish({startIndex, ids}) {
        await expect.poll(() => requests.length, {timeout: 20000}).toBe(startIndex + 2);
        await expect(page.getByRole('button', {name: 'Stop AI task', exact: true})).toBeDisabled();
        const request = requests[startIndex + 1];
        const results = ids.map((id) => JSON.parse(request.input.find((item) => item.type === 'function_call_output' && item.call_id === id).output));
        const images = request.input.flatMap((item) => Array.isArray(item.content) ? item.content : []).filter((item) => item.type === 'input_image');
        return {results, images, request};
    }
    return {requests, start, finish, run: async (calls) => finish(await start(calls))};
}

test('预览工具无需共享即可检查和执行，未授权截图明确失败且不写文件', async ({page}) => {
    const ai = await setup(page);
    const {results, images} = await ai.run([
        ['preview_get_state'],
        ['preview_open', {path: 'index.html'}],
        ['preview_evaluate', {code: 'await new Promise(r=>setTimeout(r,10)); document.querySelector("h1").textContent=args.title; console.warn("检查警告"); return document.querySelector("h1").textContent;', args: {title: 'Temporary'}}],
        ['preview_inspect', {selector: 'h1', include_styles: true}],
        ['preview_get_errors'],
        ['preview_screenshot', {path: 'denied.png'}],
        ['get_tool_availability', {names: ['preview_inspect', 'preview_screenshot']}],
    ]);
    expect(results[0]).toMatchObject({ok: true, attached: false});
    expect(results[0]).not.toHaveProperty('content');
    expect(results[1]).toMatchObject({ok: true, path: 'index.html', ready: true, attached: true});
    expect(results[2]).toMatchObject({ok: true, value: 'Temporary'});
    expect(results[3].value.elements[0]).toMatchObject({tag: 'h1', text: 'Temporary'});
    expect(results[4].errors.some((entry) => entry.kind === 'console.warn')).toBe(true);
    expect(results[5]).toMatchObject({ok: false});
    expect(results[5].summary).toContain('enable sharing');
    expect(results[6].tools.map((tool) => tool.available)).toEqual([true, false]);
    expect(images).toHaveLength(0);
    expect(await page.evaluate(() => window.displayRequests)).toBe(0);
    expect(await readFile(page, 'denied.png')).toBeNull();
    expect(await readFile(page, 'index.html')).toContain('Original');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const definitions = ai.requests[0].tools.filter((tool) => tool.name.startsWith('preview_'));
    expect(definitions.map((tool) => tool.name).sort()).toEqual(['preview_evaluate', 'preview_get_errors', 'preview_get_state', 'preview_inspect', 'preview_open', 'preview_refresh', 'preview_screenshot', 'preview_set_viewport']);
    expect(definitions.find((tool) => tool.name === 'preview_screenshot').parameters.properties).toHaveProperty('path');

    const refreshed = await ai.run([
        ['write_file', {path: 'main.js', content: 'document.querySelector("h1").dataset.version="unsaved";'}],
        ['preview_refresh'],
        ['preview_evaluate', {code: 'return {title:document.querySelector("h1").textContent, version:document.querySelector("h1").dataset.version};'}],
    ]);
    expect(refreshed.results.every((result) => result.ok)).toBe(true);
    expect(refreshed.results[2].value).toEqual({title: 'Original', version: 'unsaved'});
});

test('截图按路径进入临时态，可读取且拒绝覆盖，用户保存后才落盘', async ({page}) => {
    const ai = await setup(page);
    await ai.run([['preview_open', {path: 'index.html'}]]);
    await page.getByRole('button', {name: 'Share Preview for Screenshots', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Stop Preview Sharing', exact: true})).toBeVisible({timeout: 10000});

    const attached = await ai.run([
        ['preview_screenshot'],
        ['preview_screenshot', {path: '', timeout_ms: 10000}],
        ['preview_screenshot', {path: '   '}],
    ]);
    for (const result of attached.results) {
        expect(result).toMatchObject({ok: true, path: 'index.html', image_path: null, dirty: false, mime_type: 'image/png'});
    }
    expect(attached.images).toHaveLength(3);
    for (const image of attached.images) expect(image.image_url).toMatch(/^data:image\/png;base64,/);
    expect(await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const names = [];
        for await (const [name] of root.entries()) names.push(name);
        return names.sort();
    })).toEqual(['existing.png', 'index.html', 'main.js']);

    const staged = await ai.run([['preview_screenshot', {path: 'screenshots/home.png'}]]);
    expect(staged.results[0]).toMatchObject({ok: true, path: 'index.html', image_path: 'screenshots/home.png', dirty: true});
    expect(staged.results[0]).not.toHaveProperty('blob');
    expect(staged.results[0]).not.toHaveProperty('dataUrl');
    expect(staged.images).toHaveLength(1);
    expect(await readFile(page, 'screenshots/home.png', true)).toBeNull();
    expect(await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const names = [];
        for await (const [name] of root.entries()) names.push(name);
        return names.includes('screenshots');
    })).toBe(false);
    const bytes = [...Buffer.from(staged.images[0].image_url.split(',')[1], 'base64')];
    expect(bytes.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(await page.locator('.tab[title="screenshots/home.png"]').count()).toBe(0);

    const read = await ai.run([['read_image', {path: 'screenshots/home.png'}]]);
    expect(read.results[0].ok).toBe(true);
    expect(read.images[0].image_url).toBe(staged.images[0].image_url);

    const collision = await ai.run([['preview_screenshot', {path: 'screenshots/home.png'}]]);
    expect(collision.results[0]).toMatchObject({ok: false});
    expect(collision.results[0].summary).toContain('already exists');
    expect(collision.images).toHaveLength(0);
    expect(await readFile(page, 'screenshots/home.png', true)).toBeNull();
    await page.getByRole('button', {name: 'Changes', exact: true}).click();
    const change = page.locator('.change-row').filter({has: page.locator('small', {hasText: 'screenshots/home.png'})});
    await expect(change).toBeVisible();
    await change.getByRole('checkbox').check();
    await page.getByRole('button', {name: 'Save Selected', exact: true}).click();
    await expect(change).toHaveCount(0);
    expect(await readFile(page, 'screenshots/home.png', true)).toEqual(bytes);
    expect(await page.evaluate(() => window.displayRequests)).toBe(1);
    await page.getByRole('button', {name: 'Stop Preview Sharing', exact: true}).click();
    const stopped = await ai.run([['preview_screenshot']]);
    expect(stopped.results[0].ok).toBe(false);
    expect(stopped.images).toHaveLength(0);
});

test('截图拒绝非法路径和暂存失败，不覆盖文件也不附加失败图片', async ({page}) => {
    const ai = await setup(page);
    await ai.run([['preview_open', {path: 'index.html'}]]);
    await page.getByRole('button', {name: 'Share Preview for Screenshots', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Stop Preview Sharing', exact: true})).toBeVisible({timeout: 10000});
    await page.evaluate(async () => {
        const {FileSession} = await import('/src/shared/file-system/file-session.js');
        const stageBlob = FileSession.prototype.stageBlob;
        FileSession.prototype.stageBlob = function (path, ...args) {
            if (path === 'blocked.png') throw new Error('测试暂存失败');
            return stageBlob.call(this, path, ...args);
        };
    });
    const {results, images} = await ai.run([
        ...['/tmp/a.png', 'C:\\temp\\a.png', 'https://example.com/a.png', '../a.png', 'image.jpg', null, 12, 'existing.png', 'blocked.png'].map((path) => ['preview_screenshot', {path}]),
    ]);
    expect(results.every((result) => result.ok === false)).toBe(true);
    expect(results.at(-1).summary).toContain('测试暂存失败');
    expect(images).toHaveLength(0);
    expect(await readFile(page, 'existing.png')).toBe('existing-file-content');
    expect(await readFile(page, 'blocked.png')).toBeNull();
    // 复用文件暂存流程的错误提示，关闭提示后确认没有残留变更。
    const notice = page.getByRole('dialog', {name: 'Notice', exact: true});
    await expect(notice).toContainText('测试暂存失败');
    await notice.getByRole('button', {name: 'OK', exact: true}).click();
    await page.getByRole('button', {name: 'Changes', exact: true}).click();
    await expect(page.locator('.change-row')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('未保存的截图可以回滚，且不留下本地文件或目录', async ({page}) => {
    const ai = await setup(page);
    await ai.run([['preview_open', {path: 'index.html'}]]);
    await page.getByRole('button', {name: 'Share Preview for Screenshots', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Stop Preview Sharing', exact: true})).toBeVisible({timeout: 10000});
    const staged = await ai.run([['preview_screenshot', {path: 'temporary/revert.png'}]]);
    expect(staged.results[0]).toMatchObject({ok: true, dirty: true});
    await page.getByRole('button', {name: 'Changes', exact: true}).click();
    const change = page.locator('.change-row').filter({has: page.locator('small', {hasText: 'temporary/revert.png'})});
    await expect(change).toBeVisible();
    await change.click({button: 'right'});
    await page.getByRole('menuitem', {name: 'Revert Changes', exact: true}).click();
    await page.getByRole('dialog', {name: 'Revert Changes'}).getByRole('button', {name: 'OK', exact: true}).click();
    await expect(change).toHaveCount(0);
    const read = await ai.run([['read_image', {path: 'temporary/revert.png'}]]);
    expect(read.results[0].ok).toBe(false);
    expect(await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        const names = [];
        for await (const [name] of root.entries()) names.push(name);
        return names.includes('temporary');
    })).toBe(false);
});

test('执行期间关闭预览会返回失败，不把旧文档结果作为成功', async ({page}) => {
    const ai = await setup(page);
    await ai.run([['preview_open', {path: 'index.html'}]]);
    const run = await ai.start([['preview_evaluate', {code: 'document.body.dataset.waiting="yes"; await new Promise(r=>setTimeout(r,10000)); return "旧文档结果";', timeout_ms: 15000}]]);
    await expect(page.frameLocator('.preview-frame').locator('body')).toHaveAttribute('data-waiting', 'yes');
    await page.locator('.preview-header').getByRole('button', {name: 'Close', exact: true}).click();
    const {results} = await ai.finish(run);
    expect(results[0].ok).toBe(false);
    expect(results[0].summary).toMatch(/changed|ready/i);
});

test('预览容器隐藏时 AI 仍可刷新读取错误和检查 DOM，恢复显示后无需重开', async ({page}) => {
    const ai = await setup(page);
    await ai.run([['preview_open', {path: 'index.html'}]]);
    await page.locator('.preview-viewport-host').evaluate((host) => { host.style.display = 'none'; });
    const result = await ai.run([
        ['preview_refresh'],
        ['preview_evaluate', {code: 'console.warn("预览隐藏日志"); document.body.dataset.retained="yes";'}],
        ['preview_get_errors', {limit: 15, since: 0}],
        ['preview_inspect', {selector: 'body', limit: 5, include_styles: false, timeout_ms: 5000}],
        ['preview_get_state'],
    ]);
    expect(result.results.every((item) => item.ok)).toBe(true);
    expect(result.results[2].errors.some((entry) => entry.kind === 'console.warn')).toBe(true);
    expect(result.results[3].value).toHaveProperty('elements');
    expect(result.results[4]).toMatchObject({ready: true, viewportReady: false, visible: false, error: null});
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.locator('.preview-viewport-host').evaluate((host) => { host.style.display = ''; });
    await expect(page.frameLocator('.preview-frame').locator('body')).toHaveAttribute('data-retained', 'yes');
    const recovered = await ai.run([['preview_get_state']]);
    expect(recovered.results[0]).toMatchObject({ready: true, viewportReady: true, visible: true});
    expect(recovered.results[0].revision).toBe(result.results[4].revision);
});

test('AI 与用户共用指定视口和恢复控制，缩放不重载页面或清空表单', async ({page}) => {
    const ai = await setup(page);
    const opened = await ai.run([
        ['preview_open', {path: 'index.html'}],
        ['preview_evaluate', {code: 'const input=document.createElement("input");input.id="retained";input.value="保留输入";document.body.append(input);const style=document.createElement("style");style.textContent="h1{color:rgb(0,0,255)}@media(min-width:1000px){h1{color:rgb(255,0,0)}}";document.head.append(style);'}],
    ]);
    const revision = opened.results[0].revision;
    const frame = page.frameLocator('.preview-frame');
    const resized = await ai.run([
        ['preview_set_viewport', {width: 1440, height: 900}],
        ['preview_evaluate', {code: 'return {width:innerWidth,height:innerHeight,value:document.querySelector("#retained").value};'}],
    ]);
    expect(resized.results[0]).toMatchObject({ok: true, revision, viewportReady: true, viewport: {mode: 'fixed', width: 1440, height: 900}});
    expect(resized.results[0].display.scale).toBeLessThan(1);
    expect(resized.results[1]).toMatchObject({ok: true, revision, value: {width: 1440, height: 900, value: '保留输入'}});
    const toggleViewport = page.getByRole('button', {name: 'Toggle Preview Dimensions', exact: true});
    await expect(toggleViewport).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.preview-viewport-controls')).toBeHidden();
    await toggleViewport.click();
    await expect(page.getByRole('spinbutton', {name: 'Preview Width', exact: true})).toHaveValue('1440');
    await expect(page.getByRole('spinbutton', {name: 'Preview Height', exact: true})).toHaveValue('900');
    await expect(frame.locator('h1')).toHaveCSS('color', 'rgb(255, 0, 0)');

    await page.getByRole('combobox', {name: 'Preview Dimension Preset', exact: true}).selectOption('390x844');
    await expect.poll(() => frame.locator('body').evaluate(() => ({width: innerWidth, height: innerHeight}))).toEqual({width: 390, height: 844});
    await expect(frame.locator('h1')).toHaveCSS('color', 'rgb(0, 0, 255)');
    await page.getByRole('spinbutton', {name: 'Preview Width', exact: true}).fill('1200');
    await page.getByRole('spinbutton', {name: 'Preview Height', exact: true}).fill('800');
    await page.getByRole('button', {name: 'Apply Preview Dimensions', exact: true}).click();
    await expect.poll(() => frame.locator('body').evaluate(() => ({width: innerWidth, height: innerHeight}))).toEqual({width: 1200, height: 800});
    await expect(page.getByRole('combobox', {name: 'Preview Dimension Preset', exact: true})).toHaveValue('custom');
    await toggleViewport.click();
    await expect(page.locator('.preview-viewport-controls')).toBeHidden();
    expect(await frame.locator('body').evaluate(() => ({width: innerWidth, height: innerHeight}))).toEqual({width: 1200, height: 800});
    await expect(frame.locator('#retained')).toHaveValue('保留输入');
    await toggleViewport.click();

    const reset = await ai.run([['preview_set_viewport', {reset: true}], ['preview_set_viewport', {width: 0, height: 900}]]);
    expect(reset.results[0]).toMatchObject({ok: true, revision, viewportReady: true, viewport: {mode: 'container'}, display: {scale: 1}});
    expect(reset.results[1].ok).toBe(false);
    await expect(page.getByRole('combobox', {name: 'Preview Dimension Preset', exact: true})).toHaveValue('container');
    const container = await page.locator('.preview-viewport-host').evaluate((node) => ({width: node.clientWidth, height: node.clientHeight}));
    expect(await frame.locator('body').evaluate(() => ({width: innerWidth, height: innerHeight}))).toEqual(container);
    await expect(frame.locator('#retained')).toHaveValue('保留输入');
    expect(await page.evaluate(() => window.displayRequests)).toBe(0);
});

test('执行预览脚本期间切换编辑文件不会中断请求或丢失 DOM 状态', async ({page}) => {
    const ai = await setup(page);
    await ai.run([['preview_open', {path: 'index.html'}]]);
    const run = await ai.start([['preview_evaluate', {code: 'document.body.dataset.waiting="yes"; await new Promise(resolve => window.finishInspection=resolve); return document.querySelector("h1").textContent;', timeout_ms: 15000}]]);
    const frame = page.frameLocator('.preview-frame');
    await expect(frame.locator('body')).toHaveAttribute('data-waiting', 'yes');
    await page.getByRole('button', {name: 'Explorer', exact: true}).click();
    await page.locator('.file-tree').getByTitle('main.js', {exact: true}).click();
    await frame.locator('body').evaluate(() => window.finishInspection());
    // 返回 AI 面板只改变界面，不应使已经完成的预览结果过期。
    await page.getByRole('button', {name: 'AI Assistant', exact: true}).click();
    const {results} = await ai.finish(run);
    expect(results[0]).toMatchObject({ok: true, value: 'Original'});
    await expect(frame.locator('body')).toHaveAttribute('data-waiting', 'yes');
});

test('停止 AI 立即结束预览脚本等待，不继续执行后续工具', async ({page}) => {
    const ai = await setup(page);
    await ai.run([['preview_open', {path: 'index.html'}]]);
    const run = await ai.start([
        ['preview_evaluate', {code: 'document.body.dataset.waiting="yes"; await new Promise(()=>{});', timeout_ms: 30000}],
        ['preview_evaluate', {code: 'document.querySelector("h1").textContent="不应执行";'}],
    ]);
    await expect(page.frameLocator('.preview-frame').locator('body')).toHaveAttribute('data-waiting', 'yes');
    await page.getByRole('button', {name: 'Stop AI task', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Stop AI task', exact: true})).toBeDisabled();
    expect(ai.requests).toHaveLength(run.startIndex + 1);
    await expect(page.frameLocator('.preview-frame').locator('h1')).toHaveText('Original');
});

test('截图编码期间停止共享会丢弃结果，不保存也不附图', async ({page}) => {
    const ai = await setup(page);
    await ai.run([['preview_open', {path: 'index.html'}]]);
    await page.getByRole('button', {name: 'Share Preview for Screenshots', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Stop Preview Sharing', exact: true})).toBeVisible({timeout: 10000});
    await page.evaluate(() => {
        const toBlob = HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
            toBlob.call(this, (blob) => { window.finishScreenshot = () => callback(blob); }, ...args);
        };
    });
    const run = await ai.start([['preview_screenshot', {path: 'stopped.png'}]]);
    await expect.poll(() => page.evaluate(() => typeof window.finishScreenshot)).toBe('function');
    await page.getByRole('button', {name: 'Stop Preview Sharing', exact: true}).click();
    await page.evaluate(() => window.finishScreenshot());
    const {results, images} = await ai.finish(run);
    expect(results[0].ok).toBe(false);
    expect(images).toHaveLength(0);
    expect(await readFile(page, 'stopped.png')).toBeNull();
});

async function readFile(page, path, binary = false) {
    return page.evaluate(async ({path, binary}) => {
        try {
            let directory = await navigator.storage.getDirectory();
            const parts = path.split('/');
            const name = parts.pop();
            for (const part of parts) directory = await directory.getDirectoryHandle(part);
            const file = await (await directory.getFileHandle(name)).getFile();
            return binary ? [...new Uint8Array(await file.arrayBuffer())] : file.text();
        } catch (error) {
            if (error.name === 'NotFoundError') return null;
            throw error;
        }
    }, {path, binary});
}
