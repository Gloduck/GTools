import {expect, test} from '@playwright/test';

const files = [
    {path: 'site/index.html', mimeType: 'text/html', content: '<link rel="stylesheet" href="css/main.css"><style>#inline{background-image:url(../images/tile.svg)}</style><h1>Hello</h1><div id="inline">Inline</div><div id="attr" style="background:url(../images/tile.svg)">Attribute</div><img src="../images/tile.svg"><a href="pages/next.html#target">Next</a><script src="js/app.js"></script>'},
    {path: 'site/css/main.css', mimeType: 'text/css', content: '@import "nested/base.css"; h1{color:rgb(12,34,56);background-image:url(../../images/tile.svg)}'},
    {path: 'site/css/nested/base.css', mimeType: 'text/css', content: 'body{background:rgb(240,241,242)} #inline{border:3px solid red;background-size:7px 9px}'},
    {path: 'site/js/app.js', mimeType: 'text/javascript', content: 'document.querySelector("h1").dataset.script="loaded"; console.warn("linked warning");'},
    {path: 'images/tile.svg', mimeType: 'image/svg+xml', content: '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="9"><rect width="7" height="9" fill="red"/></svg>'},
    {path: 'site/pages/next.html', mimeType: 'text/html', content: '<h1 id="target">Next page</h1><a href="../index.html">Home</a>'},
];

async function setup(page, input = files) {
    await page.goto('/test/runtime-harness.html');
    await page.evaluate(async (input) => {
        const {createPreviewSession} = await import('/src/shared/preview/index.js');
        window.files = input;
        const image = input.find((file) => file.mimeType === 'image/svg+xml');
        if (image) image.content = new Blob([image.content], {type: image.mimeType});
        document.body.innerHTML = '<button id="capture">Capture</button><iframe style="width:640px;height:400px"></iframe>';
        window.session = createPreviewSession(input);
        window.detach = session.attachFrame(document.querySelector('iframe'));
        window.captureError = '';
        document.querySelector('button').onclick = () => session.startCapture().catch((error) => { window.captureError = error.message; });
        await session.open(input[0].path);
    }, input);
    await ready(page);
}

async function ready(page) {
    await expect.poll(() => page.evaluate(() => session.getState().ready)).toBe(true);
}

test('real opaque iframe renders scripts, binary images, imported CSS and relative inline CSS', async ({page}) => {
    await setup(page);
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('h1')).toHaveAttribute('data-script', 'loaded');
    await expect(frame.locator('h1')).toHaveCSS('color', 'rgb(12, 34, 56)');
    await expect(frame.locator('body')).toHaveCSS('background-color', 'rgb(240, 241, 242)');
    await expect(frame.locator('#inline')).toHaveCSS('border-top-width', '3px');
    expect(await frame.locator('img').evaluate((image) => image.naturalWidth)).toBe(7);
    for (const selector of ['h1', '#inline', '#attr']) expect(await frame.locator(selector).evaluate((node) => getComputedStyle(node).backgroundImage)).toContain('data:image/svg+xml');
    expect(await page.locator('iframe').getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(await page.evaluate(() => document.querySelector('iframe').contentDocument)).toBeNull();
    const isolation = await page.evaluate(() => session.evaluate({code: 'try { return parent.document.body.innerHTML } catch(e) { return e.name }'}));
    expect(isolation).toMatchObject({path: 'site/index.html', value: 'SecurityError'});
    await frame.getByRole('link', {name: 'Next', exact: true}).click();
    await expect(frame.locator('h1')).toHaveText('Next page');
    await ready(page);
    expect(await page.evaluate(() => session.getState().path)).toBe('site/pages/next.html');
});

test('inspect/evaluate await, mutate, bound values, report logs/errors, reject stale operations and refresh', async ({page}) => {
    await setup(page);
    const result = await page.evaluate(() => session.evaluate({code: 'await new Promise(r=>setTimeout(r,10)); document.querySelector("h1").textContent=args.title; return {title:document.querySelector("h1").textContent}', args: {title: 'Changed'}}));
    expect(result).toMatchObject({path: 'site/index.html', value: {title: 'Changed'}});
    const summary = await page.evaluate(() => session.inspect({selector: 'h1'}));
    expect(summary.value.elements[0].text).toBe('Changed');
    expect(summary.value.elements[0].rect.width).toBeGreaterThan(0);
    const failed = await page.evaluate(() => session.evaluate({code: 'throw new Error("Expected failure")'}).catch((error) => ({name: error.name, message: error.message})));
    expect(failed.message).toBe('Expected failure');
    const bounded = await page.evaluate(() => session.evaluate({code: 'const x={text:"a".repeat(50000)}; x.self=x; return x'}));
    expect(JSON.stringify(bounded).length).toBeLessThan(21000);
    const timeout = await page.evaluate(() => session.evaluate({code: 'await new Promise(()=>{})', timeoutMs: 100}).catch((error) => ({name: error.name})));
    expect(timeout.name).toBe('TimeoutError');
    await page.evaluate(() => session.evaluate({code: 'console.error("evaluation error"); setTimeout(()=>{throw new Error("runtime failure")}); Promise.reject(new Error("rejection failure")); const img=new Image(); img.src="data:image/png,broken"; document.body.append(img)'}));
    await expect.poll(() => page.evaluate(() => session.getErrors().map((entry) => entry.kind))).toEqual(expect.arrayContaining(['console.warn', 'console.error', 'runtime', 'unhandledrejection', 'resource']));
    expect(await page.evaluate(() => session.getErrors({limit: 2}).length)).toBe(2);
    const stale = await page.evaluate(async () => {
        const pending = session.evaluate({code: 'await new Promise(r=>setTimeout(r,500)); return 1'}).catch((error) => error.message);
        await session.refresh();
        return pending;
    });
    expect(stale).toContain('changed');
    await ready(page);
    await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Hello');
    await page.evaluate(() => session.evaluate({code: 'for(let i=0;i<300;i++)console.warn(i)'}));
    expect(await page.evaluate(() => session.getErrors({limit: 500}).length)).toBeLessThanOrEqual(200);
});

test('full file replacement refreshes dependencies, latest update wins, reset retains files and dispose detaches', async ({page}) => {
    await setup(page);
    await page.evaluate(async () => {
        const modified = files.map((file) => file.path.endsWith('main.css') ? {...file, content: 'h1{color:rgb(1,2,3)}'} : file);
        await Promise.all([session.setFiles(files), session.setFiles(modified)]);
    });
    await ready(page);
    await expect(page.frameLocator('iframe').locator('h1')).toHaveCSS('color', 'rgb(1, 2, 3)');
    await page.evaluate(async () => { session.reset(); await session.open('site/index.html'); });
    await ready(page);
    await expect(page.frameLocator('iframe').locator('h1')).toHaveCSS('color', 'rgb(1, 2, 3)');
    await page.evaluate(() => session.setFiles([]));
    expect(await page.evaluate(() => session.getState().error)).toContain('File not found');
    await expect(page.frameLocator('iframe').locator('body')).toBeEmpty();
    await page.evaluate(() => { detach(); session.dispose(); session.dispose(); });
    expect(await page.evaluate(() => session.getState())).toMatchObject({disposed: true, attached: false, path: ''});
});

test('Markdown preview and nested CSS imports resolve from their referencing file', async ({page}) => {
    await setup(page, [
        {path: 'docs/readme.md', mimeType: 'text/markdown', content: '# Markdown\n\n![tile](../images/tile.svg)\n\n[Next](../site/pages/next.html)'},
        ...files,
    ]);
    await expect(page.frameLocator('iframe').getByRole('heading', {name: 'Markdown'})).toBeVisible();
    expect(await page.frameLocator('iframe').locator('img').evaluate((image) => image.naturalWidth)).toBe(7);
    await page.frameLocator('iframe').getByRole('link', {name: 'Next'}).click();
    await expect(page.frameLocator('iframe').locator('h1')).toHaveText('Next page');
});

test('open waits for readiness and inspect summarizes visible controls without password values', async ({page}) => {
    await setup(page, [{path: 'index.html', mimeType: 'text/html', content: `
        <style>.hidden { display: none; } button { color: rgb(12,34,56); }</style>
        <label for="email">Email</label><input id="email" value="sample@example.com">
        <input id="password" type="password" value="secret">
        <input id="choice" type="checkbox" checked><button disabled>Submit</button>
        <div class="hidden">Hidden content</div>
    `}]);
    const result = await page.evaluate(async () => {
        await session.refresh();
        return session.inspect({includeStyles: true});
    });
    expect(result.path).toBe('index.html');
    const nodes = result.value.elements;
    expect(nodes.find((node) => node.id === 'email')).toMatchObject({name: 'Email', value: 'sample@example.com'});
    expect(nodes.find((node) => node.id === 'password')).not.toHaveProperty('value');
    expect(nodes.find((node) => node.id === 'choice')).toMatchObject({checked: true});
    expect(nodes.find((node) => node.tag === 'button')).toMatchObject({disabled: true, styles: {color: 'rgb(12, 34, 56)'}});
    expect(nodes.some((node) => node.text === 'Hidden content')).toBe(false);
    expect(await page.evaluate(async () => (await session.inspect({limit: 2})).value.truncated)).toBe(true);
});

async function mockCapture(page, mode = 'success') {
    await page.evaluate((mode) => {
        window.captureMock = {stopped: 0, crops: 0, requests: [], constraints: []};
        window.CropTarget = {fromElement: async (element) => { if (element.tagName !== 'IFRAME') throw new Error('Expected preview-only target'); return {}; }};
        Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {configurable: true, value: async (options) => {
            captureMock.requests.push(options);
            if (mode === 'cancel') throw new DOMException('Permission cancelled', 'NotAllowedError');
            const canvas = document.createElement('canvas');
            canvas.width = 320; canvas.height = 180;
            const paint = () => { const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgb(255,0,0)'; ctx.fillRect(0,0,320,180); };
            paint();
            const stream = canvas.captureStream(10);
            const interval = setInterval(paint, 50);
            const track = stream.getVideoTracks()[0];
            const stop = track.stop.bind(track);
            track.stop = () => { captureMock.stopped++; clearInterval(interval); stop(); };
            track.getSettings = () => ({displaySurface: mode === 'wrong' ? 'monitor' : 'browser'});
            track.applyConstraints = async (constraints) => { captureMock.constraints.push(constraints); };
            track.cropTo = async () => { captureMock.crops++; if (mode === 'crop-fail') throw new Error('Wrong tab or crop failure'); };
            captureMock.end = () => { track.stop(); track.dispatchEvent(new Event('ended')); };
            return stream;
        }});
        if (mode === 'unsupported') delete window.CropTarget;
    }, mode);
}

for (const mode of ['unsupported', 'cancel', 'wrong', 'crop-fail']) {
    test(`capture mock: ${mode} fails clearly and releases acquired tracks`, async ({page}) => {
        await setup(page);
        await mockCapture(page, mode);
        await page.locator('#capture').click();
        await expect.poll(() => page.evaluate(() => session.getState().capture.status)).toBe('error');
        expect(await page.evaluate(() => captureError)).not.toBe('');
        expect(await page.evaluate(() => captureMock.stopped)).toBe(['wrong', 'crop-fail'].includes(mode) ? 1 : 0);
    });
}

test('capture mock: crop, real video/canvas PNG, refresh preservation, stale screenshot, ended/stop/restart/detach', async ({page}) => {
    await setup(page);
    await mockCapture(page);
    await page.locator('#capture').click();
    await expect.poll(() => page.evaluate(() => session.getState().capture.status)).toBe('active');
    const result = await page.evaluate(async () => {
        const image = await session.screenshot();
        const bitmap = await createImageBitmap(image.blob);
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0);
        return {...image, blob: {type: image.blob.type, size: image.blob.size}, pixel: [...ctx.getImageData(10,10,1,1).data]};
    });
    expect(result).toMatchObject({width: 320, height: 180, path: 'site/index.html', blob: {type: 'image/png'}, pixel: [255,0,0,255]});
    expect(result.blob.size).toBeGreaterThan(100);
    expect(await page.evaluate(() => captureMock.requests[0].video)).toEqual({frameRate: {ideal: 1}});
    expect(await page.evaluate(() => captureMock.constraints[0])).toEqual({frameRate: {ideal: 1, max: 1}});
    await page.evaluate(() => session.refresh());
    await ready(page);
    expect(await page.evaluate(() => session.getState().capture.status)).toBe('active');
    expect(await page.evaluate(() => captureMock.stopped)).toBe(0);
    expect(await page.evaluate(async () => {
        const pending = session.screenshot().then(() => 'unexpected', (error) => error.message);
        await session.refresh();
        return pending;
    })).toContain('changed');
    await page.evaluate(() => captureMock.end());
    expect(await page.evaluate(() => session.getState().capture.status)).toBe('ended');
    await page.locator('#capture').click();
    await expect.poll(() => page.evaluate(() => session.getState().capture.status)).toBe('active');
    await page.evaluate(() => session.stopCapture());
    expect(await page.evaluate(() => session.getState().capture.status)).toBe('idle');
    await page.locator('#capture').click();
    await expect.poll(() => page.evaluate(() => session.getState().capture.status)).toBe('active');
    await page.evaluate(() => detach());
    expect(await page.evaluate(() => session.getState().capture.status)).toBe('idle');
});
