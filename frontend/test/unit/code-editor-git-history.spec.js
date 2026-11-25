import {expect, test} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function repositoryFixture() {
    const dir = await mkdtemp(join(tmpdir(), 'gtools-history-'));
    const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=Example', '-c', 'user.email=example@test.invalid',
        '-c', 'commit.gpgSign=false', ...args], {stdio: 'pipe'});
    try {
        git('init', '-b', 'main');
        await writeFile(join(dir, 'settings.ini'), 'firstVersion');
        await mkdir(join(dir, 'docs'));
        await writeFile(join(dir, 'docs', 'guide.md'), 'Guide in both commits');
        await writeFile(join(dir, 'old.txt'), 'Only in the first commit');
        await writeFile(join(dir, '.gitignore'), 'ignored/\n*.tmp\n');
        await writeFile(join(dir, 'eol.txt'), 'a\nb\n');
        await writeFile(join(dir, 'missing.txt'), 'missing on disk');
        git('add', '.');
        git('commit', '-m', 'First version');
        git('branch', 'feature/first');
        git('update-ref', 'refs/remotes/origin/first', 'HEAD');
        await writeFile(join(dir, 'settings.ini'), 'secondVersion');
        git('rm', 'old.txt');
        await writeFile(join(dir, 'new.txt'), 'Only in the second commit');
        git('add', '.');
        git('commit', '-m', 'Second version');
        await writeFile(join(dir, 'settings.ini'), 'indexVersion');
        await writeFile(join(dir, 'staged-only.txt'), 'already staged');
        git('add', 'settings.ini', 'staged-only.txt');
        git('config', 'core.autocrlf', 'true');
        git('gc');
        const files = {};
        for (const name of ['.git/HEAD', '.git/index', '.git/config', '.git/packed-refs', ...(await readdir(join(dir, '.git/objects/pack')))
            .map(file => '.git/objects/pack/' + file)]) {
            files[name] = (await readFile(join(dir, name))).toString('base64');
        }
        for (const name of ['.gitignore', 'docs/guide.md', 'new.txt', 'staged-only.txt']) {
            files[name] = (await readFile(join(dir, name))).toString('base64');
        }
        for (const [name, data] of Object.entries({'settings.ini':'diskVersion', 'eol.txt':'a\r\nb\r\n', 'scratch.txt':'untracked text',
            'ignored/cache.txt':'ignored', 'notes.tmp':'ignored'})) {
            files[name] = Buffer.from(data).toString('base64');
        }
        return files;
    } finally {
        await rm(dir, {recursive: true, force: true});
    }
}

async function seedRepository(page, files) {
    files ??= await repositoryFixture();
    await page.evaluate(async files => {
        Object.defineProperty(navigator.storage, 'persisted', {value: async () => true, configurable: true});
        const root = await navigator.storage.getDirectory();
        for (const [path, data] of Object.entries(files)) {
            const parts = path.split('/');
            const name = parts.pop();
            let parent = root;
            for (const part of parts) parent = await parent.getDirectoryHandle(part, {create: true});
            const file = await parent.getFileHandle(name, {create: true});
            const out = await file.createWritable();
            await out.write(Uint8Array.from(atob(data), c => c.charCodeAt(0)));
            await out.close();
        }
    }, files);
}

function activityBar(page) {
    return page.getByRole('complementary', {name: '主导航'});
}

async function fileAction(panel, file, action) {
    const row = panel.getByTitle(file, {exact: true}).locator('..');
    await row.hover();
    await row.getByRole('button', {name: '文件比较选项'}).click();
    await panel.page().getByRole('menuitem', {name: action, exact: true}).click();
}

test('从 Git 活动栏浏览提交和文件，在独立只读标签对比，保留工作区草稿', async ({page}) => {
    await page.goto('/codeEditor');
    await seedRepository(page);
    await page.getByRole('button', {name: '打开浏览器文件夹'}).click();
    await expect(page.locator('.monaco-host .monaco-editor').first()).toBeAttached();
    await page.getByRole('navigation', {name: '文件'}).getByRole('button', {name: /settings\.ini/}).click();
    const workspaceTab = page.locator('.tab[title="settings.ini"]');
    await expect(workspaceTab).toBeVisible();
    await page.evaluate(() => window.monaco.editor.getModels().find(model => model.getValue() === 'diskVersion').setValue('diskVersionDraft'));
    await page.evaluate(() => {
        window.historyWrites = [];
        for (const [proto, method] of [[FileSystemFileHandle.prototype, 'createWritable'],
            [FileSystemDirectoryHandle.prototype, 'getFileHandle'], [FileSystemDirectoryHandle.prototype, 'getDirectoryHandle'],
            [FileSystemDirectoryHandle.prototype, 'removeEntry']]) {
            const original = proto[method];
            proto[method] = function (...args) {
                if (args[1]?.create || ['createWritable', 'removeEntry'].includes(method)) window.historyWrites.push(method);
                if (method === 'getFileHandle' && window.denyIni && args[0] === 'settings.ini') throw new DOMException('Name is not allowed', 'NotAllowedError');
                return original.apply(this, args);
            };
        }
    });

    const nav = activityBar(page);
    await nav.getByRole('button', {name: 'Git', exact: true}).click();
    const panel = page.getByRole('region', {name: '分支', exact: true});
    const older = panel.getByRole('button', {name: /First version/});
    const latest = panel.getByRole('button', {name: /Second version/});
    await expect(latest).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByRole('dialog')).toHaveCount(0);
    await expect(workspaceTab).toHaveAttribute('aria-selected', 'true');
    const file = panel.getByTitle('settings.ini', {exact: true});
    await expect(file).toContainText('M');
    await expect(panel.getByTitle('old.txt', {exact: true})).toContainText('D');
    await expect(panel.getByTitle('new.txt', {exact: true})).toContainText('A');
    await file.click();

    const viewer = page.getByRole('tabpanel');
    const text = viewer.locator('.view-lines');
    const gitTabs = page.locator('.git-tab');
    await expect(text.filter({hasText: 'firstVersion'}).first()).toBeVisible();
    await expect(text.filter({hasText: 'secondVersion'}).first()).toBeVisible();
    await expect(gitTabs).toHaveCount(1);
    await expect(gitTabs.first()).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => window.monaco.editor.getEditors()
        .filter(editor => editor.getDomNode()?.closest('.git-editor-host'))
        .map(editor => editor.getOption(window.monaco.editor.EditorOption.readOnly)))).toEqual([true, true]);
    await expect(page.locator('#save-file')).toBeDisabled();
    await page.keyboard.press('Control+s');
    await file.click();
    await expect(gitTabs).toHaveCount(1);
    await workspaceTab.click();
    await expect(page.locator('.monaco-host.visible .view-lines')).toContainText('diskVersionDraft');
    await expect(page.locator('#save-file')).toBeEnabled();
    await gitTabs.first().click();

    await panel.getByRole('button', {name: '全部文件', exact: true}).click();
    await panel.getByTitle('docs/guide.md', {exact: true}).click();
    await expect(text.first()).toContainText('Guide');
    await expect(viewer.locator('.monaco-diff-editor')).toHaveCount(0);
    await expect(gitTabs).toHaveCount(2);
    await gitTabs.last().getByTitle('关闭').click();
    await expect(gitTabs.first()).toHaveAttribute('aria-selected', 'true');
    await expect(text.filter({hasText: 'secondVersion'}).first()).toBeVisible();
    await fileAction(panel, 'settings.ini', '与未保存草稿比较');
    await expect(text.filter({hasText: 'diskVersionDraft'}).first()).toBeVisible();
    await fileAction(panel, 'settings.ini', '与磁盘文件比较');
    await expect(text.filter({hasText: 'diskVersion'}).first()).toBeVisible();
    await file.click();
    await expect(viewer.locator('.monaco-diff-editor')).toHaveCount(0);
    await page.evaluate(() => { window.denyIni = true; });
    await fileAction(panel, 'settings.ini', '与磁盘文件比较');
    await expect(viewer.getByRole('status')).toContainText('无法比较');
    await expect(text.filter({hasText: 'secondVersion'}).first()).toBeVisible();
    await expect(file).not.toHaveText(/已删除/);

    await older.hover();
    await older.locator('..').getByRole('button', {name: /与选中的提交/}).click();
    await expect(older).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByText(/比较基准/)).toBeVisible();
    await file.click();
    await expect(viewer.locator('.original .view-lines')).toContainText('secondVersion');
    await expect(viewer.locator('.modified .view-lines')).toContainText('firstVersion');
    await panel.getByRole('button', {name: '恢复与父提交比较'}).click();
    await expect(file).toContainText('A');
    await older.click();
    await expect(older).toHaveAttribute('aria-expanded', 'false');
    await nav.getByRole('button', {name: '变更', exact: true}).click();
    await expect(viewer.locator('.modified .view-lines')).toContainText('firstVersion');
    await nav.getByRole('button', {name: 'Git', exact: true}).click();
    await latest.click();
    await expect(file).toContainText('M');
    expect(await page.evaluate(() => window.historyWrites)).toEqual([]);
});

test('上区比较暂存区和磁盘，下区浏览本地和远程分支而不切换工作区', async ({page}) => {
    await page.goto('/codeEditor');
    await seedRepository(page);
    await page.getByRole('button', {name: '打开浏览器文件夹'}).click();
    await activityBar(page).getByRole('button', {name: 'Git', exact: true}).click();
    const working = page.getByRole('region', {name: '未暂存的更改', exact: true});
    const branches = page.getByRole('region', {name: '分支', exact: true});
    await expect(working.getByTitle('settings.ini', {exact: true})).toContainText('M');
    await expect(working.getByTitle('scratch.txt', {exact: true})).toContainText('U');
    await expect(working.locator('.git-file-row')).toHaveCount(2);
    await working.getByText(/无法确认的路径/).click();
    await expect(working.getByText('missing.txt', {exact: true})).toBeVisible();
    await expect(working.getByText('磁盘未找到', {exact: true})).toBeVisible();
    await working.getByTitle('settings.ini', {exact: true}).click();
    const viewer = page.getByRole('tabpanel');
    await expect(viewer.locator('.original .view-lines')).toContainText('indexVersion');
    await expect(viewer.locator('.modified .view-lines')).toContainText('diskVersion');
    await working.getByTitle('scratch.txt', {exact: true}).click();
    await expect(viewer.locator('.view-lines').first()).toContainText('untracked');
    await expect(viewer.locator('.monaco-diff-editor')).toHaveCount(0);
    for (const ref of ['refs/heads/feature/first', 'refs/remotes/origin/first']) {
        await branches.getByTitle(ref, {exact: true}).click();
        await expect(branches.getByRole('button', {name: /First version/})).toHaveAttribute('aria-expanded', 'true');
        await expect(branches.getByRole('button', {name: /Second version/})).toHaveCount(0);
        await expect(branches.getByTitle('refs/heads/main', {exact: true})).toContainText('当前');
        await expect(working.getByTitle('settings.ini', {exact: true})).toBeVisible();
    }
    await page.evaluate(async () => {
        const original = FileSystemDirectoryHandle.prototype.getFileHandle;
        FileSystemDirectoryHandle.prototype.getFileHandle = function(name, options) {
            if (name === 'settings.ini') throw new DOMException('Name is not allowed', 'NotAllowedError');
            return original.call(this, name, options);
        };
    });
    await page.getByRole('button', {name: '刷新 Git 状态'}).click();
    await expect(working.locator('.git-file-row')).toHaveCount(1);
    await working.locator('summary').click();
    await expect(working.locator('.git-unavailable-row').filter({hasText:'settings.ini'})).toContainText('无法读取');
    await expect(working).not.toContainText('已删除');
});

async function statusSnapshots() {
    const dir = await mkdtemp(join(tmpdir(), 'gtools-status-'));
    // core.autocrlf is supplied outside .git/config, as with Git for Windows.
    const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'core.autocrlf=true',
        '-c', 'splitIndex.maxPercentChange=100', '-c', 'user.name=Example', '-c', 'user.email=example@test.invalid',
        '-c', 'commit.gpgSign=false', ...args], {encoding: 'utf8', stdio: 'pipe'});
    async function snapshot() {
        const files = {};
        async function visit(prefix) {
            for (const item of await readdir(join(dir, prefix), {withFileTypes: true})) {
                const path = prefix ? prefix + '/' + item.name : item.name;
                if (['.git/hooks', '.git/logs'].includes(path)) continue;
                if (item.isDirectory()) await visit(path);
                else files[path] = (await readFile(join(dir, path))).toString('base64');
            }
        }
        const expected = git('status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0')
            .filter(row => row[1] === 'M' || row.startsWith('??'))
            .map(row => (row.startsWith('??') ? 'U' : 'M') + ' ' + row.slice(3)).sort();
        await visit('');
        return {files, expected};
    }
    try {
        git('init', '-b', 'main');
        await mkdir(join(dir, 'nested'));
        for (const [name, content] of Object.entries({
            '.gitattributes': '*.cmd text eol=crlf\n*.raw -text\n',
            'nested/.gitattributes': '*.cmd -text\n',
            'windows.txt': 'one\r\ntwo\r\n', 'clean.cmd': 'a\r\nb\r\n', 'nested/override.cmd': 'a\nb\n',
            'format.raw': 'first\nsecond\n', 'bom.txt': 'text\n', 'spaces.txt': 'hello\n',
            'staged.txt': 'original\n', 'unstage.txt': 'leave on disk\n', 'staged-only.txt': 'one\n',
            '路径甲.txt': 'same\n', '路径乙.txt': 'also clean\n',
        })) await writeFile(join(dir, name), content);
        git('add', '.');
        git('commit', '-m', 'Initial');
        git('update-index', '--index-version=4');
        git('update-index', '--split-index');
        const clean = await snapshot();
        await writeFile(join(dir, 'staged.txt'), 'index version\n');
        await writeFile(join(dir, 'staged-only.txt'), 'two\n');
        await writeFile(join(dir, 'new-staged.txt'), 'new index version\n');
        git('add', 'staged.txt', 'staged-only.txt', 'new-staged.txt');
        git('rm', '--cached', 'unstage.txt');
        for (const [name, content] of Object.entries({
            'clean.cmd': 'a\r\nb\r\n', 'nested/override.cmd': 'a\r\nb\r\n',
            'format.raw': 'first\r\nsecond\r\n', 'bom.txt': '\ufefftext\n', 'spaces.txt': 'hello  \n',
            'staged.txt': 'disk version\n', 'new.txt': 'untracked\n',
        })) await writeFile(join(dir, name), content);
        return {clean, dirty: await snapshot()};
    } finally {
        await rm(dir, {recursive: true, force: true});
    }
}

test('原生 Git 与侧栏的状态逐项一致，并显示只有换行、BOM 或空白的差异', async ({page}) => {
    const {clean, dirty} = await statusSnapshots();
    expect(clean.expected).toEqual([]);
    expect(dirty.expected).toEqual(['M bom.txt', 'M format.raw', 'M nested/override.cmd', 'M spaces.txt',
        'M staged.txt', 'U new.txt', 'U unstage.txt']);
    await page.goto('/codeEditor');
    await seedRepository(page, clean.files);
    await page.getByRole('button', {name: '打开浏览器文件夹'}).click();
    await activityBar(page).getByRole('button', {name: 'Git', exact: true}).click();
    const working = page.getByRole('region', {name: '未暂存的更改', exact: true});
    await expect(working.getByText('没有未暂存的更改')).toBeVisible();
    await seedRepository(page, dirty.files);
    const refresh = page.getByRole('button', {name: '刷新 Git 状态'});
    await refresh.click();
    const rows = working.locator('.git-file-row');
    await expect(rows).toHaveCount(dirty.expected.length);
    expect(await rows.evaluateAll(items => items.map(item => item.querySelector('.git-file-change').textContent
        + ' ' + item.title).sort())).toEqual(dirty.expected);
    const viewer = page.getByRole('tabpanel');
    await working.getByTitle('staged.txt', {exact: true}).click();
    await expect(viewer.locator('.original .view-lines')).toContainText(/index.*version/);
    await expect(viewer.locator('.modified .view-lines')).toContainText(/disk.*version/);
    await working.getByTitle('format.raw', {exact: true}).click();
    await expect(viewer.getByRole('status')).toHaveText('换行符不同（LF → CRLF）');
    await working.getByTitle('bom.txt', {exact: true}).click();
    await expect(viewer.getByRole('status')).toHaveText('文件编码不同（UTF-8 → UTF-8 BOM）');
    await working.getByTitle('spaces.txt', {exact: true}).click();
    await expect.poll(() => page.evaluate(() => window.monaco.editor.getDiffEditors()
        .find(editor => editor.getContainerDomNode().closest('.git-editor-host'))?.getLineChanges()?.length)).toBe(1);
    // With no repository rule or cached CRLF checkout, the browser cannot
    // distinguish a real EOL edit from a global Git normalization setting.
    await seedRepository(page, {'路径甲.txt': Buffer.from('same\r\n').toString('base64')});
    await refresh.click();
    await working.locator('summary').click();
    await expect(working.locator('.git-unavailable-row').filter({hasText: '路径甲.txt'})).toContainText('仅换行符不同');
    await expect(rows).toHaveCount(dirty.expected.length);
    await page.evaluate(async () => (await (await navigator.storage.getDirectory()).getDirectoryHandle('.git')).removeEntry('index'));
    await refresh.click();
    await expect(working.getByRole('alert')).toContainText('.git/index');
    await expect(rows).toHaveCount(0);
    await seedRepository(page, {'.git/HEAD': Buffer.from('ref: refs/heads/unborn\n').toString('base64')});
    await refresh.click();
    await expect(working.getByTitle('windows.txt', {exact: true})).toContainText('U');
    await expect(working.getByRole('alert')).toHaveCount(0);
});

test('未打开文件夹也能进入 Git 查看不可用提示，手机可在侧栏和只读标签间切换', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    await page.goto('/codeEditor');
    const git = activityBar(page).getByRole('button', {name: 'Git', exact: true});
    await git.click();
    const panel = page.getByRole('region', {name: 'Git', exact: true});
    await expect(git).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByRole('status')).toHaveText('尚未打开文件夹，Git 暂不可用。');
    await expect(panel.getByRole('button', {name: '刷新 Git 状态'})).toBeDisabled();
    await expect(page.getByRole('button', {name: /打开仓库/})).toHaveCount(0);
    // With the sidebar collapsed, use the editor's existing folder picker while Git is selected.
    await git.click();
    await page.evaluate(() => { window.showDirectoryPicker = () => navigator.storage.getDirectory(); });
    await page.getByRole('button', {name: '打开文件夹', exact: true}).click();
    await git.click();
    await expect(panel.getByRole('alert')).toContainText('.git');
    await seedRepository(page);
    await page.getByRole('button', {name: '刷新 Git 状态'}).click();
    const branches = page.getByRole('region', {name: '分支', exact: true});
    await branches.getByTitle('new.txt', {exact: true}).click();
    const tab = page.getByRole('tab', {name: /new.txt/});
    await expect(tab).toBeVisible();
    await expect(page.getByRole('tabpanel').locator('.view-lines').filter({hasText: /Only.*second/}).first()).toBeVisible();
    await git.click();
    await expect(branches.getByTitle('new.txt', {exact: true})).toBeVisible();
    await git.click();
    await tab.getByTitle('关闭').click();
    await expect(tab).toHaveCount(0);
    await expect(page.locator('.empty-state')).toBeVisible();
});
