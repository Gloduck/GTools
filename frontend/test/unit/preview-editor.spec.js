import {expect, test} from '@playwright/test';

async function openWorkspace(page, files) {
    await page.addInitScript(() => {
        if (window === window.top) localStorage.setItem('ui-locale', 'en-US');
    });
    await page.goto('/codeEditor');
    await expect(page.locator('.monaco-host:not(.diff-host) .monaco-editor')).toBeAttached({timeout: 15000});
    await page.evaluate(async (entries) => {
        const root = await navigator.storage.getDirectory();
        for await (const [name] of root.entries()) await root.removeEntry(name, {recursive: true});
        for (const [path, content] of Object.entries(entries)) {
            const parts = path.split('/');
            const name = parts.pop();
            let directory = root;
            for (const part of parts) directory = await directory.getDirectoryHandle(part, {create: true});
            const handle = await directory.getFileHandle(name, {create: true});
            const writable = await handle.createWritable();
            await writable.write(typeof content === 'number' ? new Uint8Array(content) : content);
            await writable.close();
        }
    }, files);
    await page.getByRole('button', {name: 'Open Browser Folder', exact: true}).click();
    await expect(page.locator('.file-tree').getByTitle(Object.keys(files)[0], {exact: true})).toBeVisible();
}

test('固定预览仅在显式操作时切换目标，并同步未保存的脚本修改', async ({page}) => {
    const savedScript = 'document.querySelector("h1").dataset.script = "saved";';
    await openWorkspace(page, {
        'a.html': '<h1>Document A</h1>',
        'b.html': '<link rel="stylesheet" href="b.css"><h1>Document B</h1><script src="app.js"></script><a href="a.html">Back to A</a>',
        'b.css': 'h1 { color: rgb(12, 34, 56); }',
        'app.js': savedScript,
    });
    await page.locator('.file-tree').getByTitle('a.html', {exact: true}).click();
    await page.getByRole('button', {name: 'Preview', exact: true}).click();
    const frame = page.frameLocator('.preview-frame');
    await expect(frame.locator('h1')).toHaveText('Document A');

    await page.evaluate(() => { window.originalPreviewFrame = document.querySelector('.preview-frame'); });
    // 暂停 B 的文件收集，验证收集期间不会被旧的 A 文档状态覆盖目标。
    await page.evaluate(async () => {
        const {FileSession} = await import('/src/shared/file-system/index.js');
        const readText = FileSession.prototype.readText;
        const gate = new Promise((resolve) => { window.releasePreviewRead = resolve; });
        window.previewReadBlocked = false;
        FileSession.prototype.readText = async function (path, ...args) {
            if (path === 'b.css') {
                window.previewReadBlocked = true;
                await gate;
            }
            return readText.call(this, path, ...args);
        };
    });
    await page.locator('.file-tree').getByTitle('b.html', {exact: true}).click();
    await expect(frame.locator('h1')).toHaveText('Document A');
    await page.getByRole('button', {name: 'Preview', exact: true}).click();
    await expect.poll(() => page.evaluate(() => window.previewReadBlocked)).toBe(true);
    await expect(frame.locator('h1')).toHaveText('Document A');
    await page.evaluate(() => window.releasePreviewRead());
    await expect(frame.locator('h1')).toHaveText('Document B');
    await expect(frame.locator('h1')).toHaveAttribute('data-script', 'saved');
    await expect(frame.locator('h1')).toHaveCSS('color', 'rgb(12, 34, 56)');

    await page.locator('.tab[title="a.html"]').click();
    await expect(frame.locator('h1')).toHaveText('Document B');
    await page.locator('.tab[title="b.html"]').click();
    await expect(frame.locator('h1')).toHaveText('Document B');
    const opened = page.waitForEvent('popup');
    await page.getByRole('link', {name: 'Open in New Tab', exact: true}).click();
    const popup = await opened;
    await expect(popup.frameLocator('iframe').locator('h1')).toHaveAttribute('data-script', 'saved');
    await page.locator('.file-tree').getByTitle('app.js', {exact: true}).click();
    await page.getByLabel('Code editor', {exact: true}).getByRole('textbox', {name: 'Editor content', exact: true}).press('Control+A');
    await page.keyboard.insertText('document.querySelector("h1").dataset.script = "unsaved";');
    await expect(frame.locator('h1')).toHaveAttribute('data-script', 'unsaved');
    await expect(popup.frameLocator('iframe').locator('h1')).toHaveAttribute('data-script', 'unsaved');
    expect(await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        return (await (await root.getFileHandle('app.js')).getFile()).text();
    })).toBe(savedScript);
    await page.locator('.tab[title="b.html"]').click();
    await expect(frame.locator('h1')).toHaveAttribute('data-script', 'unsaved');
    await frame.getByRole('link', {name: 'Back to A', exact: true}).click();
    await expect(frame.locator('h1')).toHaveText('Document A');
    expect(await page.evaluate(() => document.querySelector('.preview-frame') === window.originalPreviewFrame)).toBe(true);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await popup.close();

    await page.locator('.tab[title="app.js"]').click();
    await page.locator('.preview-header').getByRole('button', {name: 'Close', exact: true}).click();
    await expect(page.locator('.preview-frame')).toHaveCount(0);
    await page.locator('.tab[title="a.html"]').click();
    await expect(page.locator('.preview-frame')).toHaveCount(0);
    await page.getByRole('button', {name: 'Preview', exact: true}).click();
    await expect(frame.locator('h1')).toHaveText('Document A');
    await page.getByRole('button', {name: 'Preview', exact: true}).click();
    await expect(page.locator('.preview-frame')).toHaveCount(0);
});

for (const [path, content] of [
    ['readme.md', '# Resources\n\n[Source](src/)\n\n[Missing](missing.html)\n\n![Large](large.png)\n\n![Typed](typed.asset)'],
    ['resources.html', '<h1>Resources</h1><a href="src/">Source</a><a href="missing.html">Missing</a><img alt="Large" src="large.png"><img alt="Typed" src="typed.asset">'],
]) {
    test(`${path} skips directory/missing references and oversized images, retaining a Blob MIME type`, async ({page}) => {
        await openWorkspace(page, {
            [path]: content,
            'src/app.js': '// 用于建立目录链接的目标目录',
            'large.png': 9 * 1024 * 1024,
            'typed.asset': '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="9"><rect width="7" height="9" fill="red"/></svg>',
        });
        await page.evaluate(async () => {
            const {FileSession} = await import('/src/shared/file-system/index.js');
            const readBlob = FileSession.prototype.readBlob;
            FileSession.prototype.readBlob = async function (path, ...args) {
                const blob = await readBlob.call(this, path, ...args);
                return path === 'typed.asset' ? new Blob([blob], {type: 'image/svg+xml'}) : blob;
            };
        });
        await page.locator('.file-tree').getByTitle(path, {exact: true}).click();
        await page.getByRole('button', {name: 'Preview', exact: true}).click();
        const frame = page.frameLocator('.preview-frame');
        await expect(frame.locator('h1')).toHaveText('Resources');
        await expect(frame.getByAltText('Typed')).toHaveAttribute('src', /^data:image\/svg\+xml/);
        await expect.poll(() => frame.getByAltText('Typed').evaluate((image) => image.naturalWidth)).toBe(7);
        await expect(frame.getByAltText('Large')).not.toHaveAttribute('src', /^data:/);
        await expect(page.getByRole('dialog')).toHaveCount(0);
    });
}

test('固定预览在桌面和窄屏图片视图中保持可见且不遮挡编辑区域', async ({page}) => {
    await page.setViewportSize({width: 1280, height: 900});
    await openWorkspace(page, {
        'index.html': '<h1>Fixed preview</h1>',
        'image.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="red"/></svg>',
    });
    await page.locator('.file-tree').getByTitle('index.html', {exact: true}).click();
    await page.getByRole('button', {name: 'Preview', exact: true}).click();
    await expect(page.frameLocator('.preview-frame').locator('h1')).toHaveText('Fixed preview');
    await page.locator('.file-tree').getByTitle('image.svg', {exact: true}).click();

    for (const width of [1280, 390]) {
        await page.setViewportSize({width, height: 900});
        // 窄屏沿用资源管理器与编辑区互斥的布局，先收起当前侧栏。
        if (width <= 760) await page.getByRole('button', {name: 'Explorer', exact: true}).click();
        await expect(page.locator('.image-preview img')).toBeVisible();
        await expect(page.frameLocator('.preview-frame').locator('h1')).toHaveText('Fixed preview');
        await expect.poll(() => page.evaluate((narrow) => {
            const image = document.querySelector('.image-preview').getBoundingClientRect();
            const preview = document.querySelector('.preview-pane').getBoundingClientRect();
            return narrow ? image.bottom <= preview.top + 1 : image.right <= preview.left + 1;
        }, width <= 760)).toBe(true);
    }
});

test('仅打开切换和关闭文件不重建预览，脚本内容连续修改仍自动刷新', async ({page}) => {
    await openWorkspace(page, {
        'index.html': '<h1>Stable</h1><input value="initial"><script>window.previewInstance = crypto.randomUUID();</script><script src="main.js"></script>',
        'main.js': 'document.querySelector("h1").dataset.version="saved";',
        'notes.txt': 'Notes',
        'image.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
    });
    await page.locator('.file-tree').getByTitle('index.html', {exact: true}).click();
    await page.getByRole('button', {name: 'Preview', exact: true}).click();
    const frame = page.frameLocator('.preview-frame');
    await expect(frame.locator('h1')).toHaveAttribute('data-version', 'saved');
    await frame.locator('input').fill('保留表单内容');
    const initial = await frame.locator('body').evaluate(() => window.previewInstance);

    for (const path of ['main.js', 'notes.txt', 'image.svg', 'index.html', 'main.js']) {
        await page.locator('.file-tree').getByTitle(path, {exact: true}).click();
        await page.locator(`.tab[title="${path}"]`).click();
        // 等待本次界面切换完成，检查的不是 iframe 节点，而是其中的文档运行状态。
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        expect(await frame.locator('body').evaluate(() => window.previewInstance)).toBe(initial);
        await expect(frame.locator('input')).toHaveValue('保留表单内容');
    }
    await page.locator('.tab[title="notes.txt"] .tab-close').click();
    expect(await frame.locator('body').evaluate(() => window.previewInstance)).toBe(initial);

    for (const version of ['first', 'second']) {
        await page.getByLabel('Code editor', {exact: true}).getByRole('textbox', {name: 'Editor content', exact: true}).press('Control+A');
        await page.keyboard.insertText(`document.querySelector("h1").dataset.version="${version}";`);
        await expect(frame.locator('h1')).toHaveAttribute('data-version', version);
        expect(await frame.locator('body').evaluate(() => window.previewInstance)).not.toBe(initial);
        await frame.locator('input').fill(version);
        const instance = await frame.locator('body').evaluate(() => window.previewInstance);
        await page.locator('.tab[title="index.html"]').click();
        await page.locator('.tab[title="main.js"]').click();
        expect(await frame.locator('body').evaluate(() => window.previewInstance)).toBe(instance);
        await expect(frame.locator('input')).toHaveValue(version);
    }
    await page.getByRole('button', {name: 'Changes', exact: true}).click();
    const change = page.locator('.change-row').filter({has: page.locator('small', {hasText: 'main.js'})});
    await change.click();
    await expect(frame.locator('input')).toHaveValue('second');
    await change.click({button: 'right'});
    await page.getByRole('menuitem', {name: 'Revert Changes', exact: true}).click();
    await page.getByRole('dialog', {name: 'Revert Changes'}).getByRole('button', {name: 'OK', exact: true}).click();
    await expect(frame.locator('h1')).toHaveAttribute('data-version', 'saved');
});
