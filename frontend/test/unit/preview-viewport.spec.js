import {expect, test} from '@playwright/test';

async function setup(page, withContainer = true) {
    await page.goto('/test/runtime-harness.html');
    await page.evaluate(async (withContainer) => {
        const {createPreviewSession} = await import('/src/shared/preview/index.js');
        document.body.innerHTML = `
            <button id="capture">开始共享</button>
            <div id="container" style="position:relative;width:600px;height:400px">
                <iframe style="position:absolute;border:0;width:100%;height:100%"></iframe>
            </div>`;
        window.originalFrame = document.querySelector('iframe');
        window.originalStyle = originalFrame.style.cssText;
        window.session = createPreviewSession([{
            path: 'index.html', mimeType: 'text/html', content: `
                <style>
                    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
                    #target { position: absolute; left: 120px; top: 80px; width: 240px; height: 60px; box-sizing: border-box; color: rgb(30,70,220); }
                    @media (min-width: 1000px) { #target { color: rgb(20,180,60); } }
                </style>
                <input id="input" value="初始值"><button id="target">点击计数</button>
                <script>
                    window.sentinel = {token: Math.random().toString(36), clicks: 0};
                    window.originalDocument = document;
                    window.originalInput = document.querySelector('#input');
                    document.querySelector('#target').onclick = () => { sentinel.clicks++; };
                </script>`,
        }]);
        session.attachFrame(originalFrame, withContainer ? {container: document.querySelector('#container')} : undefined);
        await session.open('index.html');
    }, withContainer);
    await expect.poll(() => page.evaluate(() => session.getState().viewportReady)).toBe(true);
}

test.afterEach(async ({page}) => {
    await page.evaluate(() => window.session?.dispose());
});

test('固定视口使用真实布局和媒体查询，容器缩放与恢复跟随不重建文档或丢失交互状态', async ({page}) => {
    await setup(page);
    const frame = page.frameLocator('iframe');
    await frame.locator('#input').fill('保留用户输入');
    const initial = await page.evaluate(async () => ({
        state: session.getState(), srcdoc: originalFrame.srcdoc,
        token: (await session.evaluate({code: 'return sentinel.token'})).value,
    }));
    let viewportRevision = initial.state.viewportRevision;
    let clicks = 0;

    for (const step of [
        {size: {width: 1440, height: 900}, viewport: {mode: 'fixed', width: 1440, height: 900}, width: 600, height: 375, scale: 600 / 1440, click: true},
        {resize: true, viewport: {mode: 'fixed', width: 1440, height: 900}, width: 300, height: 187.5, scale: 300 / 1440, click: true},
        {size: null, viewport: {mode: 'container', width: 300, height: 200}, width: 300, height: 200, scale: 1},
        {size: {width: 240, height: 160}, viewport: {mode: 'fixed', width: 240, height: 160}, width: 240, height: 160, scale: 1},
        {size: null, viewport: {mode: 'container', width: 300, height: 200}, width: 300, height: 200, scale: 1},
    ]) {
        if (step.resize) {
            // 只改变宿主尺寸，必须由观察器更新缩放，而不是由查询或设置视口触发。
            await page.locator('#container').evaluate((container) => {
                container.style.width = '300px';
                container.style.height = '200px';
            });
        } else {
            const settled = await page.evaluate((size) => session.setViewport(size), step.size);
            expect(settled).toMatchObject({viewportReady: true, viewport: step.viewport});
        }
        await expect.poll(() => page.evaluate(() => {
            const state = session.getState();
            return {ready: state.viewportReady, width: state.display.width, height: state.display.height};
        })).toEqual({ready: true, width: step.width, height: step.height});
        const current = await page.evaluate(() => ({
            state: session.getState(), sameFrame: document.querySelector('iframe') === originalFrame,
            srcdoc: originalFrame.srcdoc,
        }));
        expect(current).toMatchObject({sameFrame: true, srcdoc: initial.srcdoc, state: {
            revision: initial.state.revision, content: initial.state.content, ready: true, viewport: step.viewport,
        }});
        expect(current.state.display.scale).toBeCloseTo(step.scale, 8);
        expect(current.state.viewportRevision).toBeGreaterThan(viewportRevision);
        viewportRevision = current.state.viewportRevision;

        const bounds = await page.locator('iframe').boundingBox();
        expect(bounds.width).toBeCloseTo(step.width, 2);
        expect(bounds.height).toBeCloseTo(step.height, 2);
        const inspected = await page.evaluate(() => session.inspect({selector: '#target', includeStyles: true}));
        expect(inspected.value.viewport).toEqual({width: step.viewport.width, height: step.viewport.height});
        // 检查接口返回文档内部 CSS 像素，不能混入宿主的缩放坐标。
        expect(inspected.value.elements[0].rect).toEqual({x: 120, y: 80, width: 240, height: 60});
        expect(inspected.value.elements[0].styles.color).toBe(step.viewport.width >= 1000 ? 'rgb(20, 180, 60)' : 'rgb(30, 70, 220)');
        if (step.click) {
            await page.mouse.click(bounds.x + 240 * step.scale, bounds.y + 110 * step.scale);
            clicks++;
        }
        const runtime = await page.evaluate(() => session.evaluate({code: `return {
            width: innerWidth, height: innerHeight, token: sentinel.token, clicks: sentinel.clicks,
            sameDocument: document === originalDocument,
            sameInput: document.querySelector('#input') === originalInput,
            input: document.querySelector('#input').value,
        }`}));
        expect(runtime.value).toEqual({
            width: step.viewport.width, height: step.viewport.height, token: initial.token,
            clicks,
            sameDocument: true, sameInput: true, input: '保留用户输入',
        });
    }
});

test('非法视口尺寸拒绝且保持布局与版本，公开上限八千一百九十二仍可使用', async ({page}) => {
    await setup(page);
    await page.evaluate(() => session.setViewport({width: 1440, height: 900}));
    expect(await page.evaluate(async () => (await import('/src/shared/preview/index.js')).PREVIEW_VIEWPORT_MAX_SIZE)).toBe(8192);
    const before = await page.evaluate(() => ({state: session.getState(), style: originalFrame.style.cssText, srcdoc: originalFrame.srcdoc}));
    for (const dimension of ['width', 'height']) {
        for (const invalid of [0, -1, 1.5, 8193, NaN, Infinity, '1440', undefined]) {
            const result = await page.evaluate(async ({dimension, invalid}) => {
                let failure = null;
                try { await session.setViewport({width: 1440, height: 900, [dimension]: invalid}); }
                catch (error) { failure = error.name; }
                return {failure, state: session.getState(), style: originalFrame.style.cssText, srcdoc: originalFrame.srcdoc};
            }, {dimension, invalid});
            expect(result).toEqual({failure: 'RangeError', ...before});
        }
    }
    expect((await page.evaluate(() => session.evaluate({code: 'return {width: innerWidth, height: innerHeight}'}))).value)
        .toEqual({width: 1440, height: 900});
    const maximum = await page.evaluate(() => session.setViewport({width: 8192, height: 8192}));
    expect(maximum).toMatchObject({viewport: {mode: 'fixed', width: 8192, height: 8192}, viewportReady: true});
    expect((await page.evaluate(() => session.evaluate({code: 'return {width: innerWidth, height: innerHeight}'}))).value)
        .toEqual({width: 8192, height: 8192});
});

test('未提供容器的旧式挂载不修改内联样式且拒绝设置视口', async ({page}) => {
    await setup(page, false);
    const result = await page.evaluate(async () => {
        const before = session.getState();
        const failures = [];
        for (const size of [{width: 1440, height: 900}, null]) {
            try { await session.setViewport(size); failures.push(null); }
            catch (error) { failures.push(error.message); }
        }
        return {before, after: session.getState(), failures, originalStyle, style: originalFrame.style.cssText};
    });
    expect(result.style).toBe(result.originalStyle);
    expect(result.after).toEqual(result.before);
    expect(result.after).toMatchObject({viewport: {mode: 'container', width: 600, height: 400}, display: {width: 600, height: 400, scale: 1}});
    for (const failure of result.failures) expect(failure).toMatch(/container/i);
});

test('重置恢复调用方样式并支持再次打开，销毁后宿主变化不再修改样式或发布状态', async ({page}) => {
    await setup(page);
    await page.evaluate(() => session.setViewport({width: 1440, height: 900}));
    const reset = await page.evaluate(() => {
        session.reset();
        return {state: session.getState(), originalStyle, style: originalFrame.style.cssText, srcdoc: originalFrame.srcdoc};
    });
    expect(reset.style).toBe(reset.originalStyle);
    expect(reset.srcdoc).toBe('');
    expect(reset.state).toMatchObject({path: '', ready: false, disposed: false, attached: true, capture: {status: 'idle'}});
    await page.evaluate(() => session.open('index.html'));
    await expect.poll(() => page.evaluate(() => session.getState().viewportReady)).toBe(true);
    expect(await page.evaluate(() => session.getState())).toMatchObject({viewport: {mode: 'container', width: 600, height: 400}});
    await page.evaluate(() => session.setViewport({width: 390, height: 844}));
    const disposed = await page.evaluate(async () => {
        window.publications = 0;
        session.subscribe(() => { window.publications++; });
        session.dispose();
        session.dispose();
        const count = publications;
        document.querySelector('#container').style.width = '300px';
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {state: session.getState(), originalStyle, style: originalFrame.style.cssText, count, publications};
    });
    expect(disposed.style).toBe(disposed.originalStyle);
    expect(disposed.publications).toBe(disposed.count);
    expect(disposed.state).toMatchObject({disposed: true, attached: false, path: '', viewportReady: false});
    expect(await page.evaluate(() => session.setViewport(null).then(() => null, (error) => error.message))).toMatch(/disposed/i);
});

test('截图编码期间切换视口会拒绝旧尺寸图片但不停止共享', async ({page}) => {
    await setup(page);
    await page.evaluate(async () => {
        await session.setViewport({width: 1440, height: 900});
        // 仅此用例模拟共享源；原生裁剪与尺寸验证由独立的原生测试覆盖。
        window.CropTarget = {fromElement: async () => ({})};
        navigator.mediaDevices.getDisplayMedia = async () => {
            const canvas = document.createElement('canvas');
            canvas.width = 600;
            canvas.height = 375;
            const paint = () => canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
            paint();
            window.mockStream = canvas.captureStream(10);
            window.paintTimer = setInterval(paint, 50);
            const track = mockStream.getVideoTracks()[0];
            track.getSettings = () => ({displaySurface: 'browser'});
            track.applyConstraints = async () => {};
            track.cropTo = async () => {};
            return mockStream;
        };
        document.querySelector('#capture').onclick = () => {
            window.captureStarted = session.startCapture().then(() => null, (error) => error.message);
        };
    });
    try {
        await page.locator('#capture').click();
        expect(await page.evaluate(() => window.captureStarted)).toBeNull();
        await page.evaluate(() => {
            window.originalToBlob = HTMLCanvasElement.prototype.toBlob;
            HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
                originalToBlob.call(this, (blob) => {
                    window.releaseBlob = () => callback(blob);
                }, ...args);
            };
            window.pendingShot = session.screenshot({timeoutMs: 10000}).then(() => null, (error) => error.message);
        });
        await expect.poll(() => page.evaluate(() => typeof window.releaseBlob), {timeout: 10000}).toBe('function');
        const result = await page.evaluate(async () => {
            await session.setViewport({width: 390, height: 844});
            releaseBlob();
            return {failure: await pendingShot, capture: session.getState().capture, track: mockStream.getVideoTracks()[0].readyState};
        });
        expect(result.failure).toMatch(/changed/i);
        expect(result).toMatchObject({capture: {status: 'active', error: null}, track: 'live'});
    } finally {
        await page.evaluate(() => {
            if (window.originalToBlob) HTMLCanvasElement.prototype.toBlob = originalToBlob;
            window.releaseBlob?.();
            clearInterval(window.paintTimer);
            session.stopCapture();
        });
    }
});
