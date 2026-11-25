import {expect, test} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function repositoryFixture({stagedDeletion = false, repositoryAuthor = {}, autoCrlf = true} = {}) {
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
        if (stagedDeletion) git('rm', '--cached', 'missing.txt');
        if (autoCrlf) git('config', 'core.autocrlf', 'true');
        if (repositoryAuthor.name) git('config', 'user.name', repositoryAuthor.name);
        if (repositoryAuthor.email) git('config', 'user.email', repositoryAuthor.email);
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

async function withNativeGit(page, inspect) {
    // Read the browser's actual objects, index and refs back with the native Git binary.
    const metadata = await page.evaluate(async () => {
        const files = {};
        async function visit(dir, prefix) {
            for await (const [name, item] of dir) {
                const path = prefix + '/' + name;
                if (item.kind === 'directory') await visit(item, path);
                else files[path] = btoa(String.fromCharCode(...new Uint8Array(await (await item.getFile()).arrayBuffer())));
            }
        }
        await visit(await (await navigator.storage.getDirectory()).getDirectoryHandle('.git'), '.git');
        return files;
    });
    const dir = await mkdtemp(join(tmpdir(), 'gtools-browser-commit-'));
    try {
        // A fully packed repository can have no loose refs, but native Git needs the directory.
        await mkdir(join(dir, '.git/refs'), {recursive: true});
        for (const [path, data] of Object.entries(metadata)) {
            await mkdir(join(dir, path, '..'), {recursive: true});
            await writeFile(join(dir, path), Buffer.from(data, 'base64'));
        }
        const git = (...args) => execFileSync('git', ['-C', dir, ...args], {encoding: 'utf8'});
        return await inspect(git, metadata);
    } finally {
        await rm(dir, {recursive: true, force: true});
    }
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
    await expect(page.getByText('Git 写入不可用。此索引格式或扩展目前仅支持查看。')).toBeVisible();
    await expect(working.getByRole('button', {name: /^暂存 /})).toHaveCount(0);
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

test('按文件暂存与取消暂存，提交真实索引并保留受限文件的已暂存版本', async ({page}) => {
    await page.goto('/codeEditor');
    const settings = activityBar(page).getByRole('button', {name: '设置', exact: true});
    const authorName = page.getByRole('textbox', {name: '作者姓名', exact: true});
    const authorEmail = page.getByRole('textbox', {name: '作者邮箱', exact: true});
    await settings.click();
    await authorName.fill('Browser Tester');
    await authorEmail.fill('browser@example.invalid');
    await authorEmail.blur();
    await page.reload();
    await settings.click();
    await expect(authorName).toHaveValue('Browser Tester');
    await expect(authorEmail).toHaveValue('browser@example.invalid');
    await activityBar(page).getByRole('button', {name: '资源管理器', exact: true}).click();
    await seedRepository(page, await repositoryFixture({
        stagedDeletion: true, repositoryAuthor: {name: 'Repo Author', email: 'repo@example.invalid'},
    }));
    await page.getByRole('button', {name: '打开浏览器文件夹'}).click();
    await page.evaluate(() => {
        const original = FileSystemDirectoryHandle.prototype.getFileHandle;
        FileSystemDirectoryHandle.prototype.getFileHandle = function (name, options) {
            if (name === 'settings.ini') throw new DOMException('blocked', 'NotAllowedError');
            return original.call(this, name, options);
        };
    });
    await activityBar(page).getByRole('button', {name: 'Git', exact: true}).click();
    const staged = page.getByRole('region', {name: '已暂存的更改', exact: true});
    const working = page.getByRole('region', {name: '未暂存的更改', exact: true});
    const branches = page.getByRole('region', {name: '分支', exact: true});
    await expect(staged.getByTitle('missing.txt', {exact: true})).toContainText('D');
    await staged.getByTitle('settings.ini', {exact: true}).click();
    await expect(page.getByRole('tabpanel').locator('.modified .view-lines')).toContainText('indexVersion');
    await working.getByRole('button', {name: '暂存 scratch.txt', exact: true}).click();
    await expect(staged.getByTitle('scratch.txt', {exact: true})).toContainText('A');
    await staged.getByRole('button', {name: '取消暂存 scratch.txt', exact: true}).click();
    await expect(working.getByTitle('scratch.txt', {exact: true})).toContainText('U');
    await working.getByRole('button', {name: '暂存 scratch.txt', exact: true}).click();
    await expect(staged.getByTitle('scratch.txt', {exact: true})).toBeVisible();
    await seedRepository(page, {'scratch.txt': Buffer.from('later disk edit').toString('base64')});
    await page.getByRole('button', {name: '刷新 Git 状态'}).click();
    await expect(working.getByTitle('scratch.txt', {exact: true})).toContainText('M');
    await branches.getByTitle('refs/heads/feature/first', {exact: true}).click();
    await page.getByRole('textbox', {name: '提交说明'}).fill('Browser staged commit');
    await expect(authorName).toHaveCount(0);
    await expect(authorEmail).toHaveCount(0);
    await page.getByRole('button', {name: '提交到 main', exact: true}).click();
    await expect(staged.getByText('没有已暂存的更改')).toBeVisible();
    await expect(working.getByTitle('scratch.txt', {exact: true})).toContainText('M');
    await expect(branches.getByRole('button', {name: /Browser staged commit/})).toHaveCount(0);
    await branches.getByTitle('refs/heads/main', {exact: true}).click();
    await expect(branches.getByRole('button', {name: /Browser staged commit/})).toBeVisible();

    await withNativeGit(page, (git, metadata) => {
        git('fsck', '--full');
        expect(git('show', '-s', '--format=%s%n%an <%ae>', 'HEAD').trim()).toBe('Browser staged commit\nBrowser Tester <browser@example.invalid>');
        expect(git('show', 'HEAD:settings.ini')).toBe('indexVersion');
        expect(git('show', 'HEAD:scratch.txt')).toBe('untracked text');
        expect(git('show', '-s', '--format=%s', 'HEAD^').trim()).toBe('Second version');
        expect(git('show', '-s', '--format=%s', 'feature/first').trim()).toBe('First version');
        expect(git('ls-tree', 'HEAD', '--', 'missing.txt')).toBe('');
        expect(git('diff', '--cached', '--name-only')).toBe('');
        expect(Object.keys(metadata).filter(path => path.endsWith('.lock'))).toEqual([]);
    });
});

test('提交缺少邮箱时转到设置，补全后沿用当前仓库的姓名和提交草稿', async ({page}) => {
    await page.goto('/codeEditor');
    await seedRepository(page, await repositoryFixture({repositoryAuthor: {name: 'Repo Author'}}));
    await page.getByRole('button', {name: '打开浏览器文件夹'}).click();
    const git = activityBar(page).getByRole('button', {name: 'Git', exact: true});
    await git.click();
    const message = page.getByRole('textbox', {name: '提交说明'});
    const submit = page.getByRole('button', {name: '提交到 main', exact: true});
    await message.fill('Use repository identity');
    await submit.click();
    const email = page.getByRole('textbox', {name: '作者邮箱', exact: true});
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await email.fill('bad<address>');
    await git.click();
    await submit.click();
    await expect(email).toBeFocused();
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await email.fill('settings@example.invalid');
    await git.click();
    await expect(message).toHaveValue('Use repository identity');
    await submit.click();
    const commit = page.getByRole('button', {name: /Use repository identity/});
    await expect(commit).toContainText('Repo Author');
});

test('慢读取时显示文件、阶段和耗时，后台刷新可被下一次暂存操作打断', async ({page}) => {
    await page.goto('/codeEditor');
    await seedRepository(page);
    await page.getByRole('button', {name: '打开浏览器文件夹'}).click();
    await activityBar(page).getByRole('button', {name: 'Git', exact: true}).click();
    const panel = page.getByRole('region', {name: 'Git', exact: true});
    const working = panel.getByRole('region', {name: '未暂存的更改', exact: true});
    const staged = panel.getByRole('region', {name: '已暂存的更改', exact: true});
    const stage = working.getByRole('button', {name: '暂存 scratch.txt', exact: true});
    const progress = panel.locator('.git-progress');
    await expect(stage).toBeEnabled();
    const header = panel.locator('.panel-header');
    const idleHeight = (await header.boundingBox()).height;
    // Hold a real read at each of two distinct points without relying on disk speed.
    await page.evaluate(() => {
        window.gitReadGates = {'scratch.txt': {}, 'guide.md': {}};
        const getFile = FileSystemFileHandle.prototype.getFile;
        FileSystemFileHandle.prototype.getFile = async function () {
            const gate = window.gitReadGates[this.name];
            if (gate && !gate.release) await new Promise(resolve => { gate.release = resolve; });
            return getFile.call(this);
        };
    });
    await stage.click();
    await expect(progress).toContainText('正在暂存 scratch.txt');
    await expect(progress).toContainText('读取磁盘文件');
    await expect(stage).toBeDisabled();
    await expect(stage).toHaveAttribute('aria-busy', 'true');
    await expect(progress.locator('small')).toHaveText(/\d+ 秒/);
    expect((await header.boundingBox()).height).toBe(idleHeight);
    await page.evaluate(() => {
        window.gitReadGates['scratch.txt'].release();
        window.gitReadGates['scratch.txt'] = {};
    });
    await expect(progress).toContainText('已暂存 scratch.txt');
    await expect(progress).toContainText('更新此文件的变更状态');
    await page.waitForFunction(() => Boolean(window.gitReadGates['scratch.txt'].release));
    await page.evaluate(() => window.gitReadGates['scratch.txt'].release());

    const unstage = staged.getByRole('button', {name: '取消暂存 scratch.txt', exact: true});
    await expect(unstage).toBeEnabled();
    await expect(page.locator('#status-right')).toHaveText(/Git 操作 \d+\.\d+ 秒 · 刷新列表 \d+\.\d+ 秒/);
    await page.waitForFunction(() => Boolean(window.gitReadGates['guide.md'].release));
    await expect(progress).toContainText('正在后台检查工作区');
    await expect(progress).toContainText(/已检查 \d+\/\d+ 个已跟踪路径/);
    await expect(unstage).toBeEnabled();
    await seedRepository(page, {'new.txt': Buffer.from('changed by another program').toString('base64')});
    await unstage.click();
    await expect(stage).toBeEnabled();
    await page.evaluate(() => window.gitReadGates['guide.md'].release());
    await expect(working.getByTitle('new.txt', {exact: true})).toContainText('M');
    await expect(staged.getByTitle('scratch.txt', {exact: true})).toHaveCount(0);
    await expect(progress).toHaveCount(0);
});

test('Git 变更多选、范围选择和右键目标控制批量暂存与取消暂存', async ({page}) => {
    // The scenario reads the live repository back with native Git after both index writes.
    test.setTimeout(60_000);
    await page.goto('/codeEditor');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const names = ['alpha.txt', 'beta.txt', 'charlie.txt'];
    const files = await repositoryFixture({autoCrlf: false});
    const externalName = 'scratch%20file.txt';
    const scratchContent = files['scratch.txt'];
    delete files['scratch.txt'];
    files['scratch file.txt'] = Buffer.from('different file with a space').toString('base64');
    for (const name of names) files[name] = Buffer.from(name + '\r\n').toString('base64');
    await seedRepository(page, files);
    await page.getByRole('button', {name: '打开浏览器文件夹'}).click();
    await activityBar(page).getByRole('button', {name: 'Git', exact: true}).click();
    const working = page.getByRole('region', {name: '未暂存的更改', exact: true});
    const staged = page.getByRole('region', {name: '已暂存的更改', exact: true});
    const row = (section, name) => section.getByTitle(name, {exact: true});
    const selected = section => section.locator('.git-file-row[aria-pressed="true"]');
    const menu = page.getByRole('menu', {name: 'Git 变更操作'});
    await expect(row(working, names[0])).toBeVisible();
    // External additions can enter Git status before the Explorer tree has seen them.
    await seedRepository(page, {[externalName]: scratchContent});
    await page.getByRole('button', {name: '刷新 Git 状态'}).click();
    await expect(row(working, externalName)).toBeVisible();

    const checkbox = working.getByRole('checkbox', {name: '选择 alpha.txt', exact: true});
    await checkbox.check();
    await expect(row(working, names[0])).toHaveAttribute('aria-pressed', 'true');
    await row(working, names[2]).click({modifiers: ['Shift']});
    const beta = working.getByRole('checkbox', {name: '选择 beta.txt', exact: true});
    await beta.click({modifiers: ['Shift']});
    await expect(selected(working)).toHaveCount(2);
    await expect(checkbox).toBeChecked();
    await expect(beta).toBeChecked();
    await expect(working.getByRole('checkbox', {name: '选择 charlie.txt', exact: true})).not.toBeChecked();
    await row(working, names[0]).click();
    await page.keyboard.press('Control+a');
    await expect(selected(working)).toHaveCount(6);
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await row(working, names[0]).click();
    await row(working, names[2]).click({modifiers: ['Control']});
    await expect(selected(working)).toHaveCount(2);
    await row(working, names[0]).click({modifiers: ['Meta']});
    await expect(selected(working)).toHaveCount(1);
    await expect(row(working, names[2])).toHaveAttribute('aria-pressed', 'true');
    await row(working, externalName).click({button: 'right'});
    await expect(selected(working)).toHaveCount(1);
    await expect(row(working, externalName)).toHaveAttribute('aria-pressed', 'true');
    await expect(menu.getByRole('menuitem', {name: '查看更改'})).toBeVisible();
    await menu.getByRole('menuitem', {name: '打开工作区文件', exact: true}).click();
    await expect(page.locator('.tab[title="scratch%20file.txt"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.monaco-host.visible .view-lines')).toContainText('untracked');

    await row(working, names[0]).click();
    await row(working, names[2]).click({modifiers: ['Shift']});
    await row(working, names[1]).click({button: 'right'});
    await expect(selected(working)).toHaveCount(3);
    await expect(menu.getByRole('menuitem', {name: '查看更改'})).toHaveCount(0);
    await expect(menu.getByRole('menuitem', {name: '打开工作区文件'})).toHaveCount(0);
    await menu.getByRole('menuitem', {name: '复制相对路径', exact: true}).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(names.join('\n'));
    await row(working, names[1]).click({button: 'right'});
    await menu.getByRole('menuitem', {name: '暂存所选文件', exact: true}).click();
    const eol = page.getByRole('dialog', {name: '暂存 alpha.txt', exact: true});
    await eol.getByRole('combobox').selectOption('lf');
    await eol.getByRole('checkbox', {name: '将此选择用于本批其余需要确认的文件'}).check();
    await eol.getByRole('button', {name: '确定', exact: true}).click();
    for (const name of names) await expect(row(staged, name)).toContainText('A');
    await expect(row(working, externalName)).toBeVisible();
    await withNativeGit(page, git => {
        for (const name of names) expect(git('show', ':' + name)).toBe(name + '\n');
        expect(git('show', ':settings.ini')).toBe('indexVersion');
        expect(git('ls-files', '--', externalName)).toBe('');
    });

    await row(staged, names[0]).click();
    await row(staged, names[1]).click({modifiers: ['Control']});
    await row(staged, names[1]).click({button: 'right'});
    await menu.getByRole('menuitem', {name: '取消暂存所选文件', exact: true}).click();
    for (const name of names.slice(0, 2)) await expect(row(working, name)).toContainText('U');
    await expect(row(staged, names[2])).toContainText('A');
    for (const name of names) expect(await readWorkingFile(page, name)).toBe(name + '\r\n');
    await withNativeGit(page, git => {
        expect(git('ls-files', '--', ...names)).toBe('charlie.txt\n');
        expect(git('show', ':settings.ini')).toBe('indexVersion');
    });
});

async function readWorkingFile(page, name) {
    return page.evaluate(async name => {
        const directory = await navigator.storage.getDirectory();
        try {
            const handle = await directory.getFileHandle(name);
            return (await handle.getFile()).text();
        } catch (error) {
            if (error.name === 'NotFoundError') return null;
            throw error;
        }
    }, name);
}

test('Git 丢弃更改一次确认混选的还原与永久删除，并同步普通和差异标签', async ({page}) => {
    await page.goto('/codeEditor');
    const files = await repositoryFixture();
    files['extra.txt'] = Buffer.from('extra file').toString('base64');
    await seedRepository(page, files);
    await page.getByRole('button', {name: '打开浏览器文件夹'}).click();
    const explorer = page.getByRole('navigation', {name: '文件'});
    await explorer.getByTitle('scratch.txt', {exact: true}).click();
    await explorer.getByTitle('settings.ini', {exact: true}).click();
    const workspaceTab = page.locator('.tab[title="settings.ini"]');
    const scratchTab = page.locator('.tab[title="scratch.txt"]');
    await expect(workspaceTab).toBeVisible();
    await expect(scratchTab).toBeVisible();
    await activityBar(page).getByRole('button', {name: 'Git', exact: true}).click();
    const working = page.getByRole('region', {name: '未暂存的更改', exact: true});
    const settings = working.getByTitle('settings.ini', {exact: true});
    const scratch = working.getByTitle('scratch.txt', {exact: true});
    const discard = page.getByRole('menu', {name: 'Git 变更操作'}).getByRole('menuitem', {name: '丢弃更改', exact: true});
    const dialog = page.getByRole('dialog', {name: '丢弃更改', exact: true});
    const cancel = dialog.getByRole('button', {name: '取消', exact: true});
    await settings.click();
    await expect(page.getByRole('tabpanel').locator('.modified .view-lines')).toContainText('diskVersion');
    await settings.click({button: 'right'});
    await discard.click();
    await expect(dialog).toContainText(/暂存区[\s\S]*settings\.ini/);
    await expect(dialog).not.toContainText('scratch.txt');
    await cancel.click();

    await scratch.click();
    const scratchDiff = page.locator('.git-tab[title^="scratch.txt ·"]');
    await expect(scratchDiff).toBeVisible();
    await scratch.click({button: 'right'});
    await discard.click();
    await expect(dialog).toContainText(/永久删除[\s\S]*scratch\.txt/);
    await expect(dialog).not.toContainText('settings.ini');
    await cancel.click();

    await settings.click({modifiers: ['Control']});
    await scratch.click({button: 'right'});
    await discard.click();
    await expect(dialog).toContainText(/暂存区[^\n]*\s+settings\.ini/);
    await expect(dialog).toContainText(/永久删除[^\n]*\s+scratch\.txt/);
    await cancel.click();
    expect(await readWorkingFile(page, 'settings.ini')).toBe('diskVersion');
    expect(await readWorkingFile(page, 'scratch.txt')).toBe('untracked text');
    await scratch.click({button: 'right'});
    await discard.click();
    await dialog.getByRole('button', {name: '丢弃更改', exact: true}).click();
    await expect(scratch).toHaveCount(0);
    await expect(settings).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
    expect(await readWorkingFile(page, 'settings.ini')).toBe('indexVersion');
    expect(await readWorkingFile(page, 'scratch.txt')).toBeNull();
    expect(await readWorkingFile(page, 'extra.txt')).toBe('extra file');
    await expect(scratchTab).toHaveCount(0);
    await expect(scratchDiff).toHaveCount(0);
    await workspaceTab.click();
    await expect(page.locator('.monaco-host.visible .view-lines')).toContainText('indexVersion');
    await page.locator('.git-tab[title^="settings.ini ·"]').click();
    await expect(page.getByRole('tabpanel').locator('.modified .view-lines')).toContainText('indexVersion');
    await withNativeGit(page, git => {
        expect(git('show', ':settings.ini')).toBe('indexVersion');
        expect(git('show', 'HEAD:settings.ini')).toBe('secondVersion');
        expect(git('ls-files', '--', 'scratch.txt')).toBe('');
    });
});

test('Git 磁盘操作保留未保存的草稿和确认期间外部修改的文件', async ({page}) => {
    await page.goto('/codeEditor');
    const files = await repositoryFixture();
    files['extra.txt'] = Buffer.from('keep before confirmation').toString('base64');
    files['new.txt'] = Buffer.from('uncommitted edit').toString('base64');
    await seedRepository(page, files);
    await page.getByRole('button', {name: '打开浏览器文件夹'}).click();
    await page.getByRole('navigation', {name: '文件'}).getByTitle('settings.ini', {exact: true}).click();
    await expect(page.locator('.monaco-host.visible .view-lines')).toContainText('diskVersion');
    await page.evaluate(() => window.monaco.editor.getModels().find(model => model.getValue() === 'diskVersion').setValue('unsaved draft'));
    await activityBar(page).getByRole('button', {name: 'Git', exact: true}).click();
    const working = page.getByRole('region', {name: '未暂存的更改', exact: true});
    const menu = page.getByRole('menu', {name: 'Git 变更操作'});
    await working.getByTitle('extra.txt', {exact: true}).click();
    await working.getByTitle('settings.ini', {exact: true}).click({modifiers: ['Control']});
    await working.getByTitle('settings.ini', {exact: true}).click({button: 'right'});
    await menu.getByRole('menuitem', {name: '丢弃更改', exact: true}).click();
    await expect(page.getByRole('region', {name: 'Git', exact: true}).getByRole('alert')).toContainText('settings.ini');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await readWorkingFile(page, 'settings.ini')).toBe('diskVersion');
    expect(await readWorkingFile(page, 'extra.txt')).toBe('keep before confirmation');
    expect(await page.evaluate(() => window.monaco.editor.getModels().some(model => model.getValue() === 'unsaved draft'))).toBe(true);

    await working.getByTitle('new.txt', {exact: true}).click();
    await working.getByTitle('scratch.txt', {exact: true}).click({modifiers: ['Control']});
    await working.getByTitle('scratch.txt', {exact: true}).click({button: 'right'});
    const discard = '丢弃更改';
    await menu.getByRole('menuitem', {name: discard}).click();
    const dialog = page.getByRole('dialog', {name: discard});
    await expect(dialog).toContainText('scratch.txt');
    const external = 'written by another program while confirming';
    await seedRepository(page, {'scratch.txt': Buffer.from(external).toString('base64')});
    await dialog.getByRole('button', {name: discard, exact: true}).click();
    const alert = page.getByRole('region', {name: 'Git', exact: true}).getByRole('alert');
    await expect(alert).toContainText('1/2');
    await expect(alert).toContainText('new.txt');
    await expect(alert).toContainText('scratch.txt');
    expect(await readWorkingFile(page, 'new.txt')).toBe('Only in the second commit');
    expect(await readWorkingFile(page, 'scratch.txt')).toBe(external);
});

test('同一磁盘文件用另一种大小写打开时，还原不会覆盖未保存的草稿', async ({page}) => {
    await page.goto('/codeEditor');
    const files = await repositoryFixture();
    files['SETTINGS.INI'] = Buffer.from('name shown by the file tree').toString('base64');
    await seedRepository(page, files);
    await page.evaluate(() => {
        const getFileHandle = FileSystemDirectoryHandle.prototype.getFileHandle;
        FileSystemDirectoryHandle.prototype.getFileHandle = function (name, options) {
            return getFileHandle.call(this, name === 'SETTINGS.INI' ? 'settings.ini' : name, options);
        };
    });
    await page.getByRole('button', {name: '打开浏览器文件夹'}).click();
    await page.getByRole('navigation', {name: '文件'}).getByTitle('SETTINGS.INI', {exact: true}).click();
    await expect(page.locator('.tab[title="SETTINGS.INI"]')).toBeVisible();
    await expect(page.locator('.monaco-host.visible .view-lines')).toContainText('diskVersion');
    await page.evaluate(() => window.monaco.editor.getModels().find(model => model.getValue() === 'diskVersion').setValue('alias draft'));
    await activityBar(page).getByRole('button', {name: 'Git', exact: true}).click();
    const git = page.getByRole('region', {name: 'Git', exact: true});
    await git.getByRole('region', {name: '未暂存的更改', exact: true}).getByTitle('settings.ini', {exact: true}).click({button: 'right'});
    await page.getByRole('menuitem', {name: '丢弃更改', exact: true}).click();
    await expect(git.getByRole('alert')).toContainText(/settings\.ini/i);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await readWorkingFile(page, 'settings.ini')).toBe('diskVersion');
    expect(await page.evaluate(() => window.monaco.editor.getModels().some(model => model.getValue() === 'alias draft'))).toBe(true);
});
