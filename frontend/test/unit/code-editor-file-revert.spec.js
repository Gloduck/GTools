import {expect, test} from '@playwright/test';

const createdPath = 'game/sakura-town/index.html';
const siblingPath = 'game/sakura-town/notes.txt';

test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        if (window.top !== window) return;
        localStorage.setItem('browser-code-editor-settings', JSON.stringify({
            ai: {apiKey: 'test-key', agentModels: 'test-model', baseUrl: 'https://api.openai.com/v1'},
        }));
    });
    let requests = 0;
    await page.route('https://api.openai.com/v1/responses', async (route) => {
        const response = requests++ === 0
            ? {
                output: [
                    {path: createdPath, content: '<h1>Sakura town</h1>'},
                    {path: siblingPath, content: 'Unsaved sibling'},
                ].map((args, index) => ({
                    type: 'function_call', id: `function-${index}`, call_id: `call-${index}`,
                    name: 'write_file', arguments: JSON.stringify(args),
                })),
            }
            : {output_text: 'Files created.', output: []};
        await route.fulfill({
            status: 200,
            headers: {'content-type': 'text/event-stream'},
            body: `data: ${JSON.stringify({type: 'response.completed', response})}\n\ndata: [DONE]\n\n`,
        });
    });
    await page.goto('/codeEditor');
    await page.evaluate(async (path) => {
        const root = await navigator.storage.getDirectory();
        for await (const [name] of root.entries()) await root.removeEntry(name, {recursive: true});
        const file = await root.getFileHandle('home.html', {create: true});
        const writable = await file.createWritable();
        await writable.write(`<h1>Home</h1><a href="${path}">Visit town</a>`);
        await writable.close();
    }, createdPath);
    await page.getByRole('button', {name: '打开浏览器文件夹'}).click();
    await expect(treeRow(page, 'home.html')).toBeVisible();
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    await page.locator('.ai-chat-form textarea').fill('Create the town and notes files.');
    await page.getByRole('button', {name: '发送', exact: true}).click();
    await expect(page.locator('.ai-message-assistant')).toContainText('Files created.');
});

for (const mode of ['none', 'inline', 'standalone', 'standalone-closed', 'navigation', 'unrelated']) {
    test(`reverting AI-created nested files clears stale references (${mode})`, async ({page, context}) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
            if (message.type() === 'error' && message.text().includes('File not found')) errors.push(message.text());
        });
        await page.getByRole('button', {name: '资源管理器', exact: true}).click();
        await treeRow(page, ['navigation', 'unrelated'].includes(mode) ? 'home.html' : createdPath).click();
        let standalone;
        if (mode !== 'none') {
            await page.getByRole('button', {name: '预览', exact: true}).click();
            if (mode === 'navigation') {
                await page.frameLocator('.preview-frame').getByRole('link', {name: 'Visit town'}).click();
            }
            await expect(page.frameLocator('.preview-frame').getByRole('heading', {name: mode === 'unrelated' ? 'Home' : 'Sakura town'})).toBeVisible();
            if (mode.startsWith('standalone')) {
                const opened = context.waitForEvent('page');
                await page.getByRole('link', {name: '在新页签中打开'}).click();
                standalone = await opened;
                await expect(standalone.frameLocator('iframe').getByRole('heading', {name: 'Sakura town'})).toBeVisible();
                if (mode === 'standalone-closed') {
                    await page.locator(`.tab[title="${createdPath}"] .tab-close`).click();
                    await expect(standalone.frameLocator('iframe').getByRole('heading', {name: 'Sakura town'})).toBeVisible();
                }
            }
        }

        await revertChange(page, createdPath);
        if (mode === 'navigation') await page.getByLabel('代码编辑器', {exact: true}).getByRole('textbox', {name: 'Editor content', exact: true}).press('Space');
        if (standalone) await expect(standalone.frameLocator('iframe').locator('body')).toBeEmpty();
        await expect(page.locator('.preview-pane')).toHaveCount(mode === 'unrelated' ? 1 : 0);
        await expect(page.locator(`.tab[title="${createdPath}"]`)).toHaveCount(0);
        await page.getByRole('button', {name: '资源管理器', exact: true}).click();
        await expect(treeRow(page, createdPath)).toHaveCount(0);
        await expect(treeRow(page, siblingPath)).toBeVisible();
        await treeRow(page, siblingPath).click();
        await expect(page.locator(`.tab[title="${siblingPath}"]`)).toBeVisible();

        await revertChange(page, siblingPath);
        await page.getByRole('button', {name: '资源管理器', exact: true}).click();
        await expect(treeRow(page, 'game')).toHaveCount(0);
        if (mode === 'unrelated') {
            await treeRow(page, 'home.html').click();
            await expect(page.frameLocator('.preview-frame').getByRole('heading', {name: 'Home'})).toBeVisible();
        }
        expect(await page.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            const names = [];
            for await (const [name] of root.entries()) names.push(name);
            return names;
        })).toEqual(['home.html']);
        await expect(page.getByRole('dialog')).toHaveCount(0);
        expect(errors).toEqual([]);
        await standalone?.close();
    });
}

test('reverting a closed persisted file keeps its standalone preview and restores saved content', async ({page, context}) => {
    await page.getByRole('button', {name: '资源管理器', exact: true}).click();
    await treeRow(page, 'home.html').click();
    await page.getByRole('button', {name: '预览', exact: true}).click();
    await expect(page.frameLocator('.preview-frame').getByRole('heading', {name: 'Home'})).toBeVisible();
    const opened = context.waitForEvent('page');
    await page.getByRole('link', {name: '在新页签中打开'}).click();
    const standalone = await opened;
    await expect(standalone.frameLocator('iframe').getByRole('heading', {name: 'Home'})).toBeVisible();

    await page.getByLabel('代码编辑器', {exact: true}).getByRole('textbox', {name: 'Editor content', exact: true}).press('Control+A');
    await page.keyboard.insertText('<h1>Changed</h1>');
    await expect(standalone.frameLocator('iframe').getByRole('heading', {name: 'Changed'})).toBeVisible();
    await page.locator('.tab[title="home.html"] .tab-close').click();
    await expect(standalone.frameLocator('iframe').getByRole('heading', {name: 'Changed'})).toBeVisible();

    await revertChange(page, 'home.html');
    await expect(standalone.frameLocator('iframe').getByRole('heading', {name: 'Home'})).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await standalone.close();
});

function treeRow(page, path) {
    return page.locator('.file-tree').getByTitle(path, {exact: true});
}

async function revertChange(page, path) {
    await page.getByRole('button', {name: '变更', exact: true}).click();
    const row = page.locator('.change-row').filter({has: page.locator('small', {hasText: path})});
    await row.click({button: 'right'});
    await page.getByRole('menuitem', {name: '回滚更改', exact: true}).click();
    const dialog = page.getByRole('dialog', {name: '回滚更改'});
    await dialog.getByRole('button', {name: '确定', exact: true}).click();
    await expect(row).toHaveCount(0);
}
