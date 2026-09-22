import {expect, test} from '@playwright/test';

test.use({
    channel: 'chromium',
    viewport: {width: 960, height: 720},
    deviceScaleFactor: 1,
    // 仅自动接受共享选择，显示流、区域裁剪和视频帧仍使用浏览器原生实现。
    launchOptions: async ({launchOptions}, use) => {
        await use({...launchOptions, args: [...(launchOptions.args || []), '--auto-accept-this-tab-capture']});
    },
});

test('native tab capture crops preview PNGs and supports stop/restart', async ({page}, testInfo) => {
    await page.goto('/test/runtime-harness.html');
    await page.evaluate(async () => {
        const {createPreviewSession} = await import('/src/shared/preview/index.js');
        document.body.innerHTML = `
            <style>
                html, body { margin: 0; background: rgb(240,20,180); }
                iframe { position: absolute; left: 160px; top: 140px; width: 480px; height: 320px; border: 0; }
            </style>
            <button id="capture">Start native capture</button><iframe></iframe>`;
        window.session = createPreviewSession([{
            path: 'index.html', mimeType: 'text/html', content: `
                <style>
                    html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
                    body { background: rgb(20,180,60); }
                    #right { position: absolute; left: 50%; top: 0; width: 50%; height: 100%; background: rgb(30,70,220); }
                </style>
                <div id="right"></div>`,
        }]);
        session.attachFrame(document.querySelector('iframe'));
        window.captureError = null;
        document.querySelector('#capture').onclick = () => {
            window.captureError = null;
            session.startCapture().catch((error) => { window.captureError = error.message; });
        };
        await session.open('index.html');
    });
    await expect(page.frameLocator('iframe').locator('#right')).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(240, 20, 180)');

    try {
        for (const restarted of [false, true]) {
            if (restarted) {
                expect(await page.evaluate(() => session.evaluate({code: `
                    document.body.style.background = 'rgb(30,70,220)';
                    document.querySelector('#right').style.background = 'rgb(20,180,60)';
                `}))).toMatchObject({path: 'index.html', value: null});
            }
            await page.locator('#capture').click();
            await expect.poll(() => page.evaluate(() => ({...session.getState().capture, failure: captureError})), {
                timeout: 10_000,
            }).toEqual({status: 'active', error: null, failure: null});

            // 静态标签页在开始采集后可能不再产生新帧。
            await page.waitForTimeout(1500);
            const image = await page.evaluate(async () => {
                const {blob, width, height, path} = await session.screenshot({timeoutMs: 10000});
                const bitmap = await createImageBitmap(blob);
                const canvas = document.createElement('canvas');
                canvas.width = bitmap.width;
                canvas.height = bitmap.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(bitmap, 0, 0);
                bitmap.close();
                const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                // 原生视频的颜色转换可能有损，选用差异明显的颜色进行校验。
                const near = (offset, color) => color.every((value, channel) => Math.abs(pixels[offset + channel] - value) <= 32);
                let outside = 0, green = 0, blue = 0;
                for (let offset = 0; offset < pixels.length; offset += 4) {
                    if (near(offset, [240, 20, 180])) outside++;
                    if (near(offset, [20, 180, 60])) green++;
                    if (near(offset, [30, 70, 220])) blue++;
                }
                const sample = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
                return {
                    width, height, path, type: blob.type, size: blob.size,
                    decoded: {width: canvas.width, height: canvas.height},
                    outside, green, blue, left: sample(120, 160), right: sample(360, 160),
                    png: [...new Uint8Array(await blob.arrayBuffer())],
                };
            });
            await testInfo.attach(restarted ? 'native-restarted.png' : 'native-cropped.png', {
                body: Buffer.from(image.png), contentType: 'image/png',
            });
            expect(image).toMatchObject({
                width: 480, height: 320, path: 'index.html', type: 'image/png',
                decoded: {width: 480, height: 320}, outside: 0,
            });
            expect(image.png.slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
            expect(image.size).toBeGreaterThan(100);
            expect(image.green).toBeGreaterThan(480 * 320 * 0.45);
            expect(image.blue).toBeGreaterThan(480 * 320 * 0.45);
            for (const [actual, expected] of [
                [image.left, restarted ? [30, 70, 220] : [20, 180, 60]],
                [image.right, restarted ? [20, 180, 60] : [30, 70, 220]],
            ]) {
                actual.forEach((value, channel) => expect(Math.abs(value - expected[channel])).toBeLessThanOrEqual(32));
            }
            await page.waitForTimeout(1500);
            expect(await page.evaluate(async () => {
                const shot = await session.screenshot();
                return {width: shot.width, height: shot.height, type: shot.blob.type};
            })).toEqual({width: 480, height: 320, type: 'image/png'});
            await page.evaluate(() => session.stopCapture());
            expect(await page.evaluate(() => session.getState().capture)).toEqual({status: 'idle', error: null});
            expect(await page.evaluate(() => session.screenshot().then(() => 'unexpected screenshot', (error) => error.message)))
                .toBe('Start preview capture first');
        }
    } finally {
        await page.evaluate(() => session.dispose());
    }
});

test('固定预览在切换编辑文件和显式更换目标后保留原生共享，在脚本页关闭预览时结束轨道', async ({page}) => {
    await page.addInitScript(() => {
        if (window !== window.top) return;
        localStorage.setItem('ui-locale', 'en-US');
        const getDisplayMedia = navigator.mediaDevices.getDisplayMedia;
        window.nativePreviewCapture = {calls: 0, stream: null, track: null};
        // 仅记录浏览器实际返回的流和轨道，不替换采集、裁剪或停止逻辑。
        navigator.mediaDevices.getDisplayMedia = async function (...args) {
            window.nativePreviewCapture.calls++;
            const stream = await getDisplayMedia.apply(this, args);
            window.nativePreviewCapture.stream = stream;
            window.nativePreviewCapture.track = stream.getVideoTracks()[0];
            return stream;
        };
    });
    await page.goto('/codeEditor');
    await expect(page.locator('.monaco-host:not(.diff-host) .monaco-editor')).toBeAttached({timeout: 15000});

    const savedScript = 'document.querySelector("h1").dataset.script = "saved";';
    const savedStyle = 'h1 { color: rgb(12, 34, 56); }';
    // 主编辑器初始化后再通过真实文件句柄填充 OPFS，避免初始化清理覆盖测试文件。
    await page.evaluate(async (files) => {
        const root = await navigator.storage.getDirectory();
        for await (const [name] of root.entries()) await root.removeEntry(name, {recursive: true});
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 8;
        const context = canvas.getContext('2d');
        context.fillStyle = 'rgb(240, 20, 180)';
        context.fillRect(0, 0, 8, 8);
        files['image.png'] = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        for (const [name, content] of Object.entries(files)) {
            const handle = await root.getFileHandle(name, {create: true});
            const writable = await handle.createWritable();
            await writable.write(content);
            await writable.close();
        }
    }, {
        'index.html': '<style>html,body{margin:0;min-height:100%;background:rgb(20,180,60)}</style><link rel="stylesheet" href="style.css"><h1>Index page</h1><script src="main.js"></script>',
        'about.html': '<style>html,body{margin:0;min-height:100%;background:rgb(30,70,220)}</style><h1>About page</h1>',
        'main.js': savedScript,
        'style.css': savedStyle,
    });
    await page.getByRole('button', {name: 'Open Browser Folder', exact: true}).click();
    await page.locator('.file-tree').getByTitle('index.html', {exact: true}).click();
    await page.getByRole('button', {name: 'Preview', exact: true}).click();
    const frame = page.frameLocator('.preview-frame');
    await expect(frame.locator('h1')).toHaveText('Index page');
    await expect(frame.locator('h1')).toHaveAttribute('data-script', 'saved');
    await expect(frame.locator('h1')).toHaveCSS('color', 'rgb(12, 34, 56)');
    await page.getByRole('button', {name: 'Share Preview for Screenshots', exact: true}).click();
    const stopSharing = page.getByRole('button', {name: 'Stop Preview Sharing', exact: true});
    await expect(stopSharing).toBeVisible({timeout: 10000});
    await page.evaluate(() => {
        window.originalPreviewCapture = {
            frame: document.querySelector('.preview-frame'),
            stream: window.nativePreviewCapture.stream,
            track: window.nativePreviewCapture.track,
        };
    });

    async function expectRetainedPreview(title, background) {
        await expect(page.locator('.preview-frame')).toHaveCount(1);
        await expect(page.locator('.preview-frame')).toBeVisible();
        await expect(frame.locator('h1')).toHaveText(title);
        await expect(frame.locator('body')).toHaveCSS('background-color', background);
        await expect(stopSharing).toBeVisible();
        expect(await page.evaluate(() => {
            const current = window.nativePreviewCapture;
            const original = window.originalPreviewCapture;
            return {
                calls: current.calls,
                sameFrame: document.querySelector('.preview-frame') === original.frame,
                connected: original.frame.isConnected,
                sameStream: current.stream === original.stream,
                sameTrack: current.track === original.track && original.stream.getVideoTracks()[0] === original.track,
                nativeStream: original.stream instanceof MediaStream,
                nativeTrack: original.track instanceof MediaStreamTrack,
                active: original.stream.active,
                readyState: original.track.readyState,
            };
        })).toEqual({
            calls: 1, sameFrame: true, connected: true, sameStream: true, sameTrack: true,
            nativeStream: true, nativeTrack: true, active: true, readyState: 'live',
        });
    }

    await expectRetainedPreview('Index page', 'rgb(20, 180, 60)');
    for (const path of ['main.js', 'style.css', 'about.html', 'image.png']) {
        await page.locator('.file-tree').getByTitle(path, {exact: true}).click();
        await expect(page.locator(`.tab[title="${path}"]`)).toHaveAttribute('aria-selected', 'true');
        if (path === 'image.png') {
            await expect(page.locator('.image-preview img')).toBeVisible();
            await expect.poll(() => page.locator('.image-preview img').evaluate((image) => image.naturalWidth)).toBe(8);
        }
        await expectRetainedPreview('Index page', 'rgb(20, 180, 60)');
        if (path === 'main.js' || path === 'style.css') {
            // 未保存的关联资源应刷新固定目标，而不是切换目标或重新请求共享。
            await page.getByLabel('Code editor', {exact: true}).getByRole('textbox', {name: 'Editor content', exact: true}).press('Control+A');
            await page.keyboard.insertText(path === 'main.js'
                ? 'document.querySelector("h1").dataset.script = "unsaved";'
                : 'h1 { color: rgb(65, 43, 21); }');
            await expect(frame.locator('h1')).toHaveAttribute('data-script', 'unsaved');
            if (path === 'style.css') await expect(frame.locator('h1')).toHaveCSS('color', 'rgb(65, 43, 21)');
            await expectRetainedPreview('Index page', 'rgb(20, 180, 60)');
        }
    }
    expect(await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        return Promise.all(['main.js', 'style.css'].map(async (name) => (await (await root.getFileHandle(name)).getFile()).text()));
    })).toEqual([savedScript, savedStyle]);

    // 只有显式预览另一文件才更换目标，原 iframe 和原生采集轨道仍需保留。
    await page.locator('.tab[title="about.html"]').click();
    await expectRetainedPreview('Index page', 'rgb(20, 180, 60)');
    await page.getByRole('button', {name: 'Preview', exact: true}).click();
    await expectRetainedPreview('About page', 'rgb(30, 70, 220)');
    for (const path of ['index.html', 'main.js']) {
        await page.locator(`.tab[title="${path}"]`).click();
        await expect(page.locator(`.tab[title="${path}"]`)).toHaveAttribute('aria-selected', 'true');
        await expectRetainedPreview('About page', 'rgb(30, 70, 220)');
    }

    // 关闭操作针对固定预览，即使当前激活的是脚本文件也必须停止原生共享。
    await page.locator('.preview-header').getByRole('button', {name: 'Close', exact: true}).click();
    await expect(page.locator('.preview-frame')).toHaveCount(0);
    await expect(stopSharing).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => ({
        calls: window.nativePreviewCapture.calls,
        connected: window.originalPreviewCapture.frame.isConnected,
        active: window.originalPreviewCapture.stream.active,
        readyState: window.originalPreviewCapture.track.readyState,
    }))).toEqual({calls: 1, connected: false, active: false, readyState: 'ended'});
    await expect(page.locator('.tab[title="main.js"]')).toHaveAttribute('aria-selected', 'true');
});
