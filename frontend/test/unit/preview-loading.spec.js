import {expect, test} from '@playwright/test';

test.use({
    channel: 'chromium',
    viewport: {width: 960, height: 720},
    // 当前 Chromium 的沙箱独立进程会漏掉首批资源拦截；仅测试中禁用进程拆分，sandbox 权限不变。
    // 共享选择自动接受，视频流和截图仍由浏览器生成。
    launchOptions: async ({launchOptions}, use) => {
        await use({...launchOptions, args: [...(launchOptions.args || []), '--auto-accept-this-tab-capture', '--disable-features=IsolateSandboxedIframes']});
    },
});

test.afterEach(async ({page}) => {
    await page.evaluate(() => window.session?.dispose());
});

test('桥接连接后即可检查和截图，慢脚本与图片只影响加载状态', async ({page, baseURL}) => {
    let releaseScript, releaseImage;
    let scriptRequests = 0;
    const scriptUrl = `${baseURL}/test/slow-loading-script.js`;
    const imageUrl = `${baseURL}/test/slow-loading-image.svg`;
    const scriptGate = new Promise((resolve) => { releaseScript = resolve; });
    const imageGate = new Promise((resolve) => { releaseImage = resolve; });
    // 所有资源由请求拦截返回，不连接外部地址，也不启动额外服务。
    await page.context().route(scriptUrl, async (route) => {
        scriptRequests++;
        await scriptGate;
        await route.fulfill({contentType: 'text/javascript', body: 'console.warn("脚本完成"); window.scriptFinished=true;'});
    });
    await page.context().route(imageUrl, async (route) => {
        await imageGate;
        await route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="9"/>'});
    });
    try {
        await page.goto('/test/runtime-harness.html');
        const initial = await page.evaluate(async ({scriptUrl, imageUrl}) => {
            const {createPreviewSession} = await import('/src/shared/preview/index.js');
            document.body.innerHTML = '<button>共享</button><iframe style="width:480px;height:320px;border:0"></iframe>';
            window.session = createPreviewSession([{path: 'index.html', mimeType: 'text/html', content: `
                <h1>加载中</h1><input value="initial"><img src="${imageUrl}">
                <script src="${scriptUrl}"></script><p id="last">解析结束</p>`}]);
            session.attachFrame(document.querySelector('iframe'));
            document.querySelector('button').onclick = () => { window.sharing = session.startCapture(); };
            return session.open('index.html');
        }, {scriptUrl, imageUrl});
        await expect.poll(() => scriptRequests).toBeGreaterThan(0);
        expect(await page.locator('iframe').getAttribute('sandbox')).not.toContain('allow-same-origin');
        expect(await page.evaluate(() => document.querySelector('iframe').contentDocument)).toBeNull();
        expect(initial).toMatchObject({ready: true, pageState: {readyState: 'loading', domContentLoaded: false, loadEventFired: false}});
        const result = await page.evaluate(() => session.evaluate({code: 'document.querySelector("input").value="保留"; console.warn("加载中日志"); return {state:document.readyState,last:!!document.querySelector("#last")};'}));
        expect(result.value).toEqual({state: 'loading', last: false});
        expect((await page.evaluate(() => session.inspect({selector: 'h1'}))).value.elements[0].text).toBe('加载中');
        expect(await page.evaluate(() => session.getErrors())).toEqual(expect.arrayContaining([expect.objectContaining({value: ['加载中日志']})]));
        await page.getByRole('button', {name: '共享', exact: true}).click();
        await page.evaluate(() => sharing);
        const image = await page.evaluate(async () => {
            const shot = await session.screenshot();
            return {width: shot.width, height: shot.height, type: shot.blob.type, load: session.getState().pageState.loadEventFired};
        });
        expect(image).toEqual({width: 480, height: 320, type: 'image/png', load: false});

        releaseScript();
        await expect.poll(() => page.evaluate(() => session.getState().pageState)).toMatchObject({readyState: 'interactive', domContentLoaded: true, loadEventFired: false});
        releaseImage();
        await expect.poll(() => page.evaluate(() => session.getState().pageState)).toMatchObject({readyState: 'complete', domContentLoaded: true, loadEventFired: true});
        expect(await page.evaluate(() => session.getState().revision)).toBe(initial.revision);
        await expect(page.frameLocator('iframe').locator('input')).toHaveValue('保留');
    } finally {
        releaseScript();
        releaseImage();
        await page.context().unrouteAll({behavior: 'wait'});
    }
});

test('桥接等待超时不清空页面，迟到连接仍可用且旧版本消息被忽略', async ({page}) => {
    await page.goto('/test/runtime-harness.html');
    const result = await page.evaluate(async () => {
        window.handshakes = [];
        window.holdHandshake = false;
        window.addEventListener('message', (event) => {
            if (!event.isTrusted || event.data?.channel !== 'preview-session' || event.data.type !== 'ready') return;
            handshakes.push({data: event.data, source: event.source, origin: event.origin});
            if (holdHandshake) event.stopImmediatePropagation();
        }, true);
        const {createPreviewSession} = await import('/src/shared/preview/index.js');
        document.body.innerHTML = '<iframe></iframe>';
        window.session = createPreviewSession([{path: 'index.html', mimeType: 'text/html', content: '<h1>保留文档</h1>'}]);
        session.attachFrame(document.querySelector('iframe'));
        await session.open('index.html');
        holdHandshake = true;
        const originalTimeout = window.setTimeout;
        // 仅缩短桥接等待定时器，避免测试实际空等十秒。
        window.setTimeout = (callback, delay, ...args) => originalTimeout(callback, delay === 10000 ? 100 : delay, ...args);
        try {
            await session.refresh();
            return null;
        } catch (error) {
            return {code: error.code, state: session.getState(), content: document.querySelector('iframe').srcdoc};
        } finally {
            window.setTimeout = originalTimeout;
        }
    });
    expect(result).toMatchObject({code: 'PREVIEW_BRIDGE_TIMEOUT', state: {ready: false, error: null}});
    expect(result.content).toContain('保留文档');
    await expect.poll(() => page.evaluate(() => handshakes.length)).toBe(2);
    expect(await page.evaluate(() => {
        window.dispatchEvent(new MessageEvent('message', handshakes[0]));
        return session.getState().ready;
    })).toBe(false);
    const recovered = await page.evaluate(async () => {
        holdHandshake = false;
        window.dispatchEvent(new MessageEvent('message', handshakes[1]));
        return session.evaluate({code: 'return document.querySelector("h1").textContent;'});
    });
    expect(recovered.value).toBe('保留文档');
    expect(await page.evaluate(() => session.getState().revision)).toBe(result.state.revision);
});
