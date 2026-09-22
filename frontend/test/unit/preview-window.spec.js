import {expect, test} from '@playwright/test';
import {createServer} from 'node:http';

async function setup(page) {
    await page.goto('/test/runtime-harness.html');
    await page.evaluate(async () => {
        const {createPreviewSession} = await import('/src/shared/preview/index.js');
        const {createPreviewWindow} = await import('/src/shared/preview/window.js');
        window.session = createPreviewSession([
            {path: 'index.html', mimeType: 'text/html', content: '<h1>Initial</h1><a href="next.html?q=1#target">Next</a>'},
            {path: 'next.html', mimeType: 'text/html', content: '<h1 id="target">Next page</h1>'},
        ]);
        document.body.innerHTML = '<a target="_blank" rel="noopener noreferrer">Open</a>';
        window.previewWindow = createPreviewWindow(session, {
            onUrlChanged: (url) => { document.querySelector('a').href = url; },
        });
        await session.open('index.html');
    });
}

test('standalone session mirrors latest state, navigates without an attached frame, and survives host disposal', async ({page}) => {
    await setup(page);
    // 会话更新后再打开旧窗口文档，验证订阅时能够补齐最新状态。
    await page.evaluate(async () => {
        window.oldWrapper = URL.createObjectURL(await (await fetch(previewWindow.getUrl())).blob());
        await session.open('next.html');
        document.querySelector('a').href = oldWrapper;
    });
    const opened = page.waitForEvent('popup');
    await page.getByRole('link', {name: 'Open', exact: true}).click();
    const popup = await opened;
    const frame = popup.frameLocator('iframe');
    await expect(frame.locator('h1')).toHaveText('Next page');
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await expect.poll(() => page.evaluate(() => previewWindow.getClientCount())).toBe(1);
    await page.evaluate(() => session.open('index.html'));
    await frame.getByRole('link', {name: 'Next', exact: true}).click();
    await expect(frame.locator('h1')).toHaveText('Next page');
    expect(await page.evaluate(() => session.getState())).toMatchObject({path: 'next.html', suffix: '?q=1#target', attached: false});

    await page.evaluate(() => previewWindow.clear());
    expect(await page.evaluate(() => previewWindow.getUrl())).toBe('');
    await expect(frame.locator('h1')).toHaveText('Next page');
    await page.evaluate(() => session.refresh());
    await page.evaluate(() => session.reset());
    await expect(frame.locator('body')).toBeEmpty();
    await page.evaluate(() => session.open('index.html'));
    await expect(frame.locator('h1')).toHaveText('Initial');

    await page.evaluate(() => session.setFiles([]));
    await expect(frame.locator('body')).toBeEmpty();
    await page.evaluate(() => session.setFiles([{path: 'index.html', mimeType: 'text/html', content: '<h1>Initial</h1>'}]));
    await expect(frame.locator('h1')).toHaveText('Initial');

    const secondOpened = page.waitForEvent('popup');
    await page.getByRole('link', {name: 'Open', exact: true}).click();
    const second = await secondOpened;
    await expect.poll(() => page.evaluate(() => previewWindow.getClientCount())).toBe(2);
    await second.goto('about:blank');
    await expect.poll(() => page.evaluate(() => previewWindow.getClientCount())).toBe(1);
    await second.close();

    await page.evaluate(() => {
        URL.revokeObjectURL(oldWrapper);
        previewWindow.dispose();
        session.dispose();
    });
    await page.close();
    await expect(frame.locator('h1')).toHaveText('Initial');
});

test('standalone wrapper retains initial content without BroadcastChannel', async ({page, context}) => {
    await context.addInitScript(() => { delete window.BroadcastChannel; });
    await setup(page);
    const opened = page.waitForEvent('popup');
    await page.getByRole('link', {name: 'Open', exact: true}).click();
    const popup = await opened;
    await expect(popup.frameLocator('iframe').locator('h1')).toHaveText('Initial');
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await page.evaluate(() => previewWindow.dispose());
    await page.close();
    await expect(popup.frameLocator('iframe').locator('h1')).toHaveText('Initial');
});

test('catch-up waits for the initial iframe load and applies only the newest queued revision', async ({page, context}) => {
    await context.addInitScript(() => {
        if (window !== window.top || !location.href.startsWith('blob:')) return;
        window.previewUpdates = [];
        const NativeChannel = window.BroadcastChannel;
        window.BroadcastChannel = class extends NativeChannel {
            constructor(name) {
                super(name);
                this.addEventListener('message', ({data}) => {
                    if (data.type === 'preview:update') previewUpdates.push(data.path);
                });
            }
        };
    });
    let releaseScript;
    const scriptGate = new Promise((resolve) => { releaseScript = resolve; });
    let requestedScript;
    const scriptRequested = new Promise((resolve) => { requestedScript = resolve; });
    // 通过受控响应暂停首次 srcdoc 加载，不依赖固定延时制造竞态。
    const server = createServer(async (_request, response) => {
        requestedScript();
        await scriptGate;
        response.writeHead(200, {'Content-Type': 'text/javascript'});
        response.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        await setup(page);
        await page.evaluate(async (scriptUrl) => {
            await session.setFiles([
                {path: 'index.html', mimeType: 'text/html', content: `<script src="${scriptUrl}"></script><h1>Initial</h1>`},
                {path: 'next.html', mimeType: 'text/html', content: '<h1>Next page</h1>'},
                {path: 'latest.html', mimeType: 'text/html', content: '<h1>Latest page</h1>'},
            ]);
            window.oldWrapper = URL.createObjectURL(await (await fetch(previewWindow.getUrl())).blob());
            await session.open('next.html');
            document.querySelector('a').href = oldWrapper;
        }, `http://127.0.0.1:${server.address().port}/initial-preview-load.js`);
        const opened = page.waitForEvent('popup');
        await page.getByRole('link', {name: 'Open', exact: true}).click();
        const popup = await opened;
        await scriptRequested;
        await expect.poll(() => popup.evaluate(() => window.previewUpdates)).toContain('next.html');
        await page.evaluate(() => session.open('latest.html'));
        await expect.poll(() => popup.evaluate(() => window.previewUpdates)).toContain('latest.html');
        await expect(popup).toHaveTitle('index.html');
        expect(await popup.locator('iframe').getAttribute('srcdoc')).toContain('<h1>Initial</h1>');
        releaseScript();
        await expect(popup.frameLocator('iframe').locator('h1')).toHaveText('Latest page');
        await expect(popup).toHaveTitle('latest.html');
        await page.evaluate(() => {
            URL.revokeObjectURL(oldWrapper);
            previewWindow.dispose();
            session.dispose();
        });
    } finally {
        releaseScript();
        server.close();
    }
});
