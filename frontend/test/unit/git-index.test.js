import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {readIndexEntries} from '../../src/shared/git.js';

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
