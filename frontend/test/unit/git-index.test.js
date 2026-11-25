import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {openGitRepository, readIndexEntries} from '../../src/shared/git.js';
import {FileSystem} from '../../src/shared/file-system/file-system.js';
import {MemoryProvider} from '../../src/shared/file-system/providers/memory-provider.js';

test('拆分索引按原位置合并跨多个位图字的新增、替换和删除条目', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'gtools-index-'));
    t.after(() => rm(dir, {recursive: true, force: true}));
    const git = (...args) => execFileSync('git', ['-C', dir, '-c', 'splitIndex.maxPercentChange=100', ...args], {encoding: 'utf8'});
    const disk = {readBlob: async path => new Blob([await readFile(join(dir, path))])};
    const names = Array.from({length: 196}, (_, i) => '文件-' + String(i).padStart(3, '0'));
    async function assertMatchesNative() {
        const expected = git('ls-files', '--stage', '-z').split('\0').filter(Boolean).sort();
        const entries = await readIndexEntries(disk);
        assert.deepEqual(entries.map(row => row.mode.toString(8) + ' ' + row.oid + ' ' + row.stage + '\t' + row.path).sort(), expected);
        return entries;
    }
    git('init', '-q', '-b', 'main');
    await Promise.all(names.map(name => writeFile(join(dir, name), name)));
    git('add', '.');
    for (const version of ['2', '3', '4']) {
        git('update-index', '--index-version=' + version);
        await assertMatchesNative();
    }
    git('update-index', '--split-index');
    git('rm', '--cached', '-q', '--', ...names.slice(64, 129));
    await writeFile(join(dir, names[10]), 'updated');
    await writeFile(join(dir, names[192]), 'changed');
    await writeFile(join(dir, '追加'), 'new');
    git('add', '--', names[10], names[192], '追加');
    git('update-index', '--assume-unchanged', names[2]);
    git('update-index', '--skip-worktree', names[3]);
    const entries = await assertMatchesNative();
    assert.deepEqual(entries.filter(row => row.skip).map(row => row.path).sort(), [names[2], names[3]]);
});

async function emptyRepository() {
    const disk = new FileSystem({provider: new MemoryProvider()});
    await disk.writeText('.git/HEAD', 'ref: refs/heads/main\n', {createParents: true});
    await disk.writeText('.git/config', '[core]\n\trepositoryformatversion = 0\n');
    const repo = await openGitRepository(disk);
    return {disk, repo};
}

const author = {name: 'Test', email: 'test@example.invalid'};

test('初始提交、撤销暂存与换行转换使用磁盘内容和原始文件大小', async () => {
    const {repo, disk} = await emptyRepository();
    await disk.writeText('a.txt', 'one\r\ntwo\r\n');
    let state = await repo.status();
    await assert.rejects(repo.stage('a.txt', state), {gitReason: 'chooseEol'});
    await assert.rejects(disk.stat('.git/index'), {code: 'FILE_NOT_FOUND'});
    await repo.stage('a.txt', state, {eol: 'lf'});
    state = await repo.status();
    assert.deepEqual(state.changes, []);
    assert.deepEqual(state.unavailable, []);
    assert.equal(state.index.get('a.txt').size, 10);
    assert.equal(await (await repo.readBlob(state.staged[0].after.oid)).text(), 'one\ntwo\n');
    await repo.unstage('a.txt', state);
    state = await repo.status();
    assert.deepEqual(state.staged, []);
    assert.equal(await disk.readText('a.txt'), 'one\r\ntwo\r\n');
    await disk.writeText('.gitattributes', '*.txt text eol=crlf\n');
    await repo.stage('a.txt', state);
    const oid = await repo.commitStaged(await repo.status(), 'first', author);
    state = await repo.status();
    assert.equal(state.head.oid, oid);
    assert.deepEqual(state.staged, []);
    assert.deepEqual((await repo.listCommits())[0].commit.parent, []);
    await disk.writeText('a.txt', 'next\r\n');
    await repo.stage('a.txt', await repo.status());
    state = await repo.status();
    await repo.unstage('a.txt', state);
    assert.equal(await disk.readText('a.txt'), 'next\r\n');
    assert.deepEqual((await repo.status()).staged, []);
});

test('索引或分支变化、已有锁、路径消失及写入失败都不会发布过期提交', async () => {
    const {repo, disk} = await emptyRepository();
    await disk.writeText('a', 'A');
    await disk.writeText('b', 'B');
    const old = await repo.status();
    await repo.stage('a', old);
    const staged = await repo.status();
    await assert.rejects(repo.stage('b', old), {gitReason: 'stateChanged'});
    await disk.writeText('.git/index.lock', 'native git');
    await assert.rejects(repo.commitStaged(staged, 'busy', author), {gitReason: 'repositoryBusy'});
    assert.equal(await disk.readText('.git/index.lock'), 'native git');
    await disk.remove('.git/index.lock');
    await disk.writeText('.git/HEAD', 'ref: refs/heads/other\n');
    await assert.rejects(repo.commitStaged(staged, 'stale', author), {gitReason: 'stateChanged'});
    await disk.writeText('.git/HEAD', 'ref: refs/heads/main\n');
    await disk.remove('b');
    await assert.rejects(repo.stage('b', staged), {code: 'FILE_NOT_FOUND'});
    const first = await repo.commitStaged(staged, 'first', author);
    await disk.writeText('a', 'second version');
    await repo.stage('a', await repo.status());
    const second = await repo.status();
    const write = disk.writeBlob.bind(disk);
    disk.writeBlob = (path, data, options) => {
        if (path === '.git/refs/heads/main') throw new Error('disk full');
        return write(path, data, options);
    };
    await assert.rejects(repo.commitStaged(second, 'second', author), /disk full/);
    assert.equal((await repo.status()).head.oid, first);
    for (const path of ['index.lock', 'HEAD.lock', 'refs/heads/main.lock']) {
        await assert.rejects(disk.stat('.git/' + path), {code: 'FILE_NOT_FOUND'});
    }
    disk.writeBlob = write;
    await repo.commitStaged(second, 'second', author);
    assert.deepEqual((await repo.listCommits())[0].commit.parent, [first]);
});

test('单文件刷新只重读目标，并保留暂存后又编辑、不可读取及其他文件的状态', async () => {
    const {disk, repo} = await emptyRepository();
    const path = 'src/file.txt';
    await disk.writeText(path, 'first', {createParents: true});
    await repo.stage(path, await repo.status());
    await disk.writeText('other.txt', 'other');
    await repo.stage('other.txt', await repo.status());
    await repo.commitStaged(await repo.status(), 'initial', author);
    await disk.writeText(path, 'staged');
    await disk.remove('other.txt');
    const before = await repo.status();
    await repo.stage(path, before);
    await disk.writeText(path, 'unstaged');
    const reads = [];
    const read = disk.readBlob.bind(disk);
    disk.readBlob = (p, options) => {
        if ([path, 'other.txt'].includes(p)) reads.push(p);
        return read(p, options);
    };
    const updated = await repo.refreshPath(path, before);
    assert.deepEqual(reads, [path]);
    assert.deepEqual(updated, await repo.status());
    assert.deepEqual(updated.changes, [{path, change: 'modified'}]);
    assert.equal(updated.unavailable[0].path, 'other.txt');
    await repo.unstage(path, updated);
    assert.deepEqual(await repo.refreshPath(path, updated), await repo.status());

    const fresh = 'src/fresh.txt';
    await disk.writeText(fresh, 'new');
    const untracked = await repo.status();
    await repo.stage(fresh, untracked);
    const added = await repo.refreshPath(fresh, untracked);
    assert.deepEqual(added, await repo.status());
    await repo.unstage(fresh, added);
    assert.deepEqual(await repo.refreshPath(fresh, added), await repo.status());
});

test('写入后索引或分支被外部更改，以及忽略规则变化时回退完整扫描', async () => {
    const {disk, repo} = await emptyRepository();
    await disk.writeText('one', '1');
    await repo.stage('one', await repo.status());
    await repo.commitStaged(await repo.status(), 'first', author);
    await disk.writeText('one', '2');
    const before = await repo.status();
    const oldIndex = await disk.readBlob('.git/index');
    await repo.stage('one', before);
    await disk.writeText('.git/HEAD', 'ref: refs/heads/other\n');
    assert.equal(await repo.refreshPath('one', before), null);
    await disk.writeText('.git/HEAD', 'ref: refs/heads/main\n');
    await disk.writeBlob('.git/index', oldIndex);
    assert.equal(await repo.refreshPath('one', before), null);
    await disk.writeText('.gitignore', '*.tmp\n');
    const state = await repo.status();
    await repo.stage('.gitignore', state);
    assert.equal(await repo.refreshPath('.gitignore', state), null);
});

test('批量暂存遇到后续路径读取失败时整个索引维持原样，批量撤销保留磁盘', async () => {
    const {disk, repo} = await emptyRepository();
    await disk.writeText('kept', 'already staged');
    await repo.stage('kept', await repo.status());
    for (const name of ['a', 'b']) await disk.writeText(name, name);
    const before = await repo.status();
    const oldIndex = await (await disk.readBlob('.git/index')).arrayBuffer();
    const read = disk.readBlob.bind(disk);
    disk.readBlob = (path, options) => {
        if (path === 'b') throw new Error('permission denied');
        return read(path, options);
    };
    await assert.rejects(repo.stagePaths(['a', 'b'], before), /permission denied/);
    assert.deepEqual(await (await read('.git/index')).arrayBuffer(), oldIndex);
    await assert.rejects(disk.stat('.git/index.lock'), {code: 'FILE_NOT_FOUND'});
    disk.readBlob = read;
    await repo.stagePaths(['a', 'b'], before);
    await repo.unstagePaths(['a', 'b'], await repo.status());
    assert.deepEqual((await repo.status()).staged.map(item => item.path), ['kept']);
    for (const name of ['a', 'b']) assert.equal(await disk.readText(name), name);
});

test('丢弃更改遵从检出换行并保留索引，过期磁盘版本和写入拒绝时保留外部内容', async () => {
    const {disk, repo} = await emptyRepository();
    await disk.writeText('.gitattributes', '*.cmd text eol=crlf\n');
    await disk.writeText('build.cmd', 'HEAD\r\n');
    await repo.stagePaths(['.gitattributes', 'build.cmd'], await repo.status());
    await repo.commitStaged(await repo.status(), 'initial', author);
    await disk.writeText('build.cmd', 'index\r\n');
    await repo.stage('build.cmd', await repo.status());
    await disk.writeText('build.cmd', 'disk\r\n');
    const before = await repo.status();
    const oldVersion = (await disk.stat('build.cmd')).version;
    await disk.writeText('build.cmd', 'external\r\n');
    await assert.rejects(repo.discardPath('build.cmd', before, {expectedVersion: oldVersion}));
    const expectedVersion = (await disk.stat('build.cmd')).version;
    const write = disk.writeBlob.bind(disk);
    disk.writeBlob = (path, value, options) => {
        if (path === 'build.cmd') throw new Error('permission denied');
        return write(path, value, options);
    };
    await assert.rejects(repo.discardPath('build.cmd', before, {expectedVersion}), /permission denied/);
    disk.writeBlob = write;
    assert.equal(await disk.readText('build.cmd'), 'external\r\n');
    await repo.discardPath('build.cmd', before, {expectedVersion});
    assert.equal(await disk.readText('build.cmd'), 'index\r\n');
    const after = await repo.status();
    assert.equal(after.signature, before.signature);
    assert.equal(after.head.oid, before.head.oid);
    assert.equal(after.changes.some(row => row.path === 'build.cmd'), false);

    await disk.writeText('.gitattributes', '*.cmd text eol=lf\n');
    await disk.writeText('build.cmd', 'new disk content');
    const lfState = await repo.status();
    await repo.discardPath('build.cmd', lfState, {expectedVersion: (await disk.stat('build.cmd')).version});
    assert.equal(await disk.readText('build.cmd'), 'index\n');
    assert.equal((await repo.status()).signature, before.signature);
});

test('确认后变成已跟踪或被忽略的文件不可按未跟踪文件删除', async () => {
    const {disk, repo} = await emptyRepository();
    await disk.writeText('new', 'keep this file');
    const state = await repo.status();
    const expectedVersion = (await disk.stat('new')).version;
    await disk.writeText('.gitignore', 'new\n');
    await assert.rejects(repo.deleteUntrackedPath('new', state, {expectedVersion}));
    await disk.remove('.gitignore');
    await repo.stage('new', state);
    await assert.rejects(repo.deleteUntrackedPath('new', state, {expectedVersion}));
    assert.equal(await disk.readText('new'), 'keep this file');
    assert.equal((await repo.status()).index.has('new'), true);

    const nested = 'sub/new.txt';
    await disk.writeText(nested, 'belongs to nested repo', {createParents: true});
    // Providers can enumerate a literal backslash as part of a filename on Linux.
    const list = disk.list.bind(disk);
    disk.list = async (path, options) => {
        const entries = await list(path, options);
        return path ? entries : [...entries, {name: 'sub\\new.txt', path: nested, kind: 'file'}];
    };
    const beforeNested = await repo.status();
    assert.deepEqual(beforeNested.unavailable.find(row => row.path === 'sub\\new.txt'), {path: 'sub\\new.txt', change: 'unsupportedPath'});
    assert.equal(beforeNested.changes.filter(row => row.path === nested).length, 1);
    disk.list = list;
    const nestedVersion = (await disk.stat(nested)).version;
    await disk.writeText('sub/.git', 'gitdir: ../other.git');
    await assert.rejects(repo.deleteUntrackedPath(nested, beforeNested, {expectedVersion: nestedVersion}), {gitReason: 'nestedRepo'});
    assert.equal(await disk.readText(nested), 'belongs to nested repo');
});

test('还原二进制保留原始字节，确认后新增内容过滤器时拒绝覆盖', async () => {
    const {disk, repo} = await emptyRepository();
    const path = 'asset.bin';
    const original = Uint8Array.of(0, 255, 13, 10, 254, 128);
    await disk.writeText('.gitattributes', '*.bin -text\n');
    await disk.writeBlob(path, original);
    await repo.stage(path, await repo.status());
    await disk.writeText(path, 'modified');
    const state = await repo.status();
    const expectedVersion = (await disk.stat(path)).version;
    await disk.writeText('.gitattributes', '*.bin filter=custom\n');
    await assert.rejects(repo.discardPath(path, state, {expectedVersion}));
    assert.equal(await disk.readText(path), 'modified');
    await disk.writeText('.gitattributes', '*.bin -text\n');
    await repo.discardPath(path, state, {expectedVersion});
    assert.deepEqual(new Uint8Array(await (await disk.readBlob(path)).arrayBuffer()), original);
});

test('批量暂存逐路径使用选定的换行策略，未完成选择前不发布索引', async () => {
    const {disk, repo} = await emptyRepository();
    await disk.writeText('keep.txt', 'one\r\ntwo\r\n');
    await disk.writeText('clean.txt', 'three\r\nfour\r\n');
    const paths = ['keep.txt', 'clean.txt'];
    const state = await repo.status();
    const eolByPath = new Map([['keep.txt', 'disk']]);
    await assert.rejects(repo.stagePaths(paths, state, {eolByPath}), {gitReason: 'chooseEol'});
    await assert.rejects(disk.stat('.git/index'), {code: 'FILE_NOT_FOUND'});
    eolByPath.set('clean.txt', 'lf');
    await repo.stagePaths(paths, state, {eolByPath});
    const {index} = await repo.status();
    assert.equal(await (await repo.readBlob(index.get('keep.txt').oid)).text(), 'one\r\ntwo\r\n');
    assert.equal(await (await repo.readBlob(index.get('clean.txt').oid)).text(), 'three\nfour\n');
});
