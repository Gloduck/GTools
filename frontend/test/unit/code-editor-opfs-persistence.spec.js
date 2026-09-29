import {expect, test} from '@playwright/test';

const scenarios = [
    {name: 'already persistent', persisted: true, granted: true, expectedCalls: ['persisted']},
    {name: 'request granted', persisted: false, granted: true, expectedCalls: ['persisted', 'persist']},
    {name: 'persisted API unavailable', persistedMissing: true, granted: true, expectedCalls: ['persist']},
    {name: 'persist API unavailable', persistMissing: true, expectedCalls: ['persisted'], warning: '当前浏览器不支持申请持久存储'},
    {name: 'both APIs unavailable', persistedMissing: true, persistMissing: true, expectedCalls: [], warning: '当前浏览器不支持申请持久存储'},
    {name: 'request denied', granted: false, expectedCalls: ['persisted', 'persist'], warning: '浏览器未批准持久存储申请'},
    {name: 'status check failed', persistedThrows: true, expectedCalls: ['persisted'], warning: '无法确认或申请持久存储保护'},
    {name: 'request failed', persistThrows: true, expectedCalls: ['persisted', 'persist'], warning: '无法确认或申请持久存储保护'},
];

for (const scenario of scenarios) {
    test(`OPFS persistence: ${scenario.name}`, async ({page}) => {
        await page.addInitScript((options) => {
            globalThis.__persistenceCalls = [];
            Object.defineProperties(navigator.storage, {
                persisted: {
                    configurable: true,
                    value: options.persistedMissing ? undefined : async () => {
                        globalThis.__persistenceCalls.push('persisted');
                        if (options.persistedThrows) throw new Error('Storage check failed');
                        return Boolean(options.persisted);
                    },
                },
                persist: {
                    configurable: true,
                    value: options.persistMissing ? undefined : async () => {
                        globalThis.__persistenceCalls.push('persist');
                        if (options.persistThrows) throw new Error('Storage request failed');
                        return Boolean(options.granted);
                    },
                },
            });
        }, scenario);
        await page.goto('/codeEditor');
        await expect(page.locator('.monaco-host .monaco-editor').first()).toBeAttached();
        await page.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            const file = await root.getFileHandle('persistence.txt', {create: true});
            const writable = await file.createWritable();
            await writable.write('saved content');
            await writable.close();
        });

        await page.getByRole('button', {name: '打开浏览器文件夹'}).click();

        const row = page.locator('.file-tree').getByTitle('persistence.txt', {exact: true});
        await expect(row).toBeVisible();
        expect(await page.evaluate(() => globalThis.__persistenceCalls)).toEqual(scenario.expectedCalls);
        const dialog = page.getByRole('dialog', {name: '提示'});
        if (scenario.warning) {
            await expect(dialog).toContainText(scenario.warning);
            await expect(dialog).toContainText('文件可能被浏览器自动清理');
            await expect(dialog).toContainText('请定期另存到本地或备份到远端');
            await expect(page.getByText('浏览器私有存储（已启用持久存储）', {exact: true})).toHaveCount(0);
            await dialog.getByRole('button', {name: '确定', exact: true}).click();
        } else {
            await expect(page.getByText('浏览器私有存储（已启用持久存储）', {exact: true})).toBeVisible();
            await expect(dialog).toHaveCount(0);
        }
        await row.click();
        await expect(page.locator('.tab[title="persistence.txt"]')).toBeVisible();
        expect(await page.evaluate(async () => {
            const root = await navigator.storage.getDirectory();
            return (await (await root.getFileHandle('persistence.txt')).getFile()).text();
        })).toBe('saved content');
    });
}
