import {expect, test} from '@playwright/test';

test.use({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true});

test('不支持文件保存选择器时直接使用 Blob 下载并销毁 URL', async ({page}) => {
    await page.addInitScript(() => {
        Object.defineProperty(globalThis, 'showSaveFilePicker', {configurable: true, value: undefined});
        globalThis.__revokedDownloadUrls = [];
        const revokeObjectURL = URL.revokeObjectURL.bind(URL);
        URL.revokeObjectURL = (url) => {
            globalThis.__revokedDownloadUrls.push(url);
            revokeObjectURL(url);
        };
    });
    await openSeededOpfs(page);

    const downloadPromise = page.waitForEvent('download');
    await startSaveAs(page, 'alpha.txt');
    expect((await downloadPromise).suggestedFilename()).toBe('alpha.txt');
    await expect.poll(() => page.evaluate(() => globalThis.__revokedDownloadUrls.length)).toBeGreaterThan(0);
});

test('不支持文件夹选择器时直接下载 ZIP', async ({page}) => {
    await page.addInitScript(() => {
        Object.defineProperty(globalThis, 'showDirectoryPicker', {configurable: true, value: undefined});
    });
    await openSeededOpfs(page);

    const downloadPromise = page.waitForEvent('download');
    await startSaveAs(page, 'docs');
    expect((await downloadPromise).suggestedFilename()).toBe('docs.zip');
});

test('保存选择器存在但调用失败时显示原有错误提示', async ({page}) => {
    await page.addInitScript(() => {
        globalThis.__savePickerCalls = 0;
        Object.defineProperty(globalThis, 'showSaveFilePicker', {
            configurable: true,
            value: async () => {
                globalThis.__savePickerCalls += 1;
                throw new DOMException('Unavailable', 'SecurityError');
            },
        });
    });
    await openSeededOpfs(page);

    await startSaveAs(page, 'alpha.txt');

    const dialog = page.getByRole('dialog', {name: '提示'});
    await expect(dialog).toContainText('另存为失败: Unavailable');
    expect(await page.evaluate(() => globalThis.__savePickerCalls)).toBe(1);
});

test('保存能力判断不根据 userAgent 跳过选择器', async ({page}) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 MicroMessenger/8.0.50',
        });
        globalThis.__savePickerCalls = 0;
        Object.defineProperty(globalThis, 'showSaveFilePicker', {
            configurable: true,
            value: async () => {
                globalThis.__savePickerCalls += 1;
                throw new Error('Picker called');
            },
        });
    });
    await openSeededOpfs(page);

    await startSaveAs(page, 'alpha.txt');

    const dialog = page.getByRole('dialog', {name: '提示'});
    await expect(dialog).toContainText('另存为失败: Picker called');
    expect(await page.evaluate(() => globalThis.__savePickerCalls)).toBe(1);
});

test('文件夹能力判断不根据 userAgent 跳过选择器', async ({page}) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'userAgent', {
            configurable: true,
            get: () => 'Mozilla/5.0 MicroMessenger/8.0.50',
        });
        globalThis.__directoryPickerCalls = 0;
        Object.defineProperty(globalThis, 'showDirectoryPicker', {
            configurable: true,
            value: async () => {
                globalThis.__directoryPickerCalls += 1;
                throw new DOMException('Cancelled', 'AbortError');
            },
        });
    });
    await openSeededOpfs(page);

    await startSaveAs(page, 'docs');

    await expect(page.getByRole('dialog', {name: '下载文件'})).toHaveCount(0);
    expect(await page.evaluate(() => globalThis.__directoryPickerCalls)).toBe(1);
});

test('打开文件夹保持原有的不支持提示逻辑', async ({page}) => {
    await page.addInitScript(() => {
        Object.defineProperty(globalThis, 'showDirectoryPicker', {configurable: true, value: undefined});
    });
    await page.goto('/codeEditor');

    await page.getByRole('button', {name: '打开文件夹'}).first().click();

    const dialog = page.getByRole('dialog', {name: '提示'});
    await expect(dialog).toContainText('当前浏览器不支持 File System Access API');
});

async function openSeededOpfs(page) {
    await page.goto('/codeEditor');
    await page.evaluate(async () => {
        const root = await navigator.storage.getDirectory();
        for await (const [name] of root.entries()) await root.removeEntry(name, {recursive: true});
        await writeFile(root, 'alpha.txt', 'alpha');
        const docs = await root.getDirectoryHandle('docs', {create: true});
        await writeFile(docs, 'nested.txt', 'nested');

        async function writeFile(directory, name, content) {
            const handle = await directory.getFileHandle(name, {create: true});
            const writable = await handle.createWritable();
            await writable.write(content);
            await writable.close();
        }
    });
    await page.getByRole('button', {name: '打开浏览器文件夹'}).click();
    await expect(treeRow(page, 'alpha.txt')).toBeVisible();
}

async function startSaveAs(page, path) {
    await treeRow(page, path).click({button: 'right'});
    await page.getByRole('menu', {name: '文件树菜单'}).getByRole('menuitem', {name: '另存为', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: '另存为'});
    await dialog.getByRole('button', {name: '另存为', exact: true}).click();
    await expect(dialog).toBeHidden();
}

function treeRow(page, path) {
    return page.locator('.file-tree').getByTitle(path, {exact: true});
}
