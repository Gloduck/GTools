import {Buffer} from 'buffer';
import {currentBranch, getConfig, hashBlob, isIgnored, listRefs, log, readBlob, resolveRef, TREE, walk} from 'isomorphic-git';
import {FileNotDirectoryError} from './file-system/file-system-errors.js';
import {normalizeFilePath} from './file-utils.js';
import {worktreeAttributes} from './git-attributes.js';
import {readIndexEntries} from './git-index.js';

// Git metadata and working-tree ignore files are the only paths this adapter reads.
function gitPath(path) {
    const normalized = normalizeFilePath(path);
    if (normalized !== '.git' && !normalized.startsWith('.git/') && normalized.split('/').at(-1) !== '.gitignore') {
        throw new Error('Expected Git metadata or a .gitignore file');
    }
    return normalized;
}

function nodeError(error) {
    const code = {FILE_NOT_FOUND: 'ENOENT', FILE_IS_DIRECTORY: 'EISDIR', FILE_NOT_DIRECTORY: 'ENOTDIR'}[error.code];
    return code ? Object.assign(new Error(error.message, {cause: error}), {code}) : error;
}

function gitFileSystem(disk) {
    async function stat(path) {
        try {
            const entry = await disk.stat(gitPath(path));
            return {isDirectory: () => entry.kind === 'directory', isFile: () => entry.kind === 'file',
                size: entry.size, mtimeMs: Number(String(entry.version).split(':')[0]) || 0};
        } catch (error) {
            throw nodeError(error);
        }
    }
    async function readFile(path, options) {
        try {
            const file = await disk.readBlob(gitPath(path));
            return options === 'utf8' || options?.encoding === 'utf8' ? file.text() : new Uint8Array(await file.arrayBuffer());
        } catch (error) {
            throw nodeError(error);
        }
    }
    async function readdir(path) {
        try {
            return (await disk.list(gitPath(path), {withMetadata: false})).map(entry => entry.name);
        } catch (error) {
            throw nodeError(error);
        }
    }
    // isomorphic-git binds the complete Node fs interface on construction.
    const unsupported = async () => { throw new Error('Unsupported operation on the read-only Git filesystem'); };
    return {promises: {readFile, readdir, stat, lstat: stat, writeFile: unsupported, mkdir: unsupported,
        unlink: unsupported, rmdir: unsupported, symlink: unsupported, readlink: unsupported}};
}

async function describe(entry) {
    if (!entry) return null;
    return {oid: await entry.oid(), type: await entry.type(), mode: await entry.mode()};
}

// A scan calls isIgnored for many siblings. Reuse ignore files, including missing ones,
// only for this scan so edits to .gitignore take effect on the next refresh.
function memoizeRead(method) {
    const cache = new Map();
    return (path, options) => {
        const key = JSON.stringify([path, options]);
        if (!cache.has(key)) cache.set(key, method(path, options));
        return cache.get(key);
    };
}

async function listUntracked(options, disk, tracked, changes, unavailable, signal) {
    const fs = options.fs.promises;
    const ignoreOptions = {...options, fs: {promises: {...fs, readFile: memoizeRead(fs.readFile), stat: memoizeRead(fs.stat)}}};
    const pending = [''];
    while (pending.length) {
        signal?.throwIfAborted();
        const directory = pending.pop();
        let entries;
        try {
            entries = await disk.list(directory, {withMetadata: false, signal});
        } catch (error) {
            signal?.throwIfAborted();
            unavailable.push({path: directory || '.', change: 'unreadable', reason: error.message});
            continue;
        }
        if (directory && entries.some(entry => entry.name === '.git')) {
            unavailable.push({path: directory, change: 'nestedRepo'});
            continue;
        }
        for (const entry of entries) {
            signal?.throwIfAborted();
            if (entry.name.toLowerCase() === '.git' || tracked(entry.path)) continue;
            const isDirectory = entry.kind === 'directory';
            try {
                if (await isIgnored({...ignoreOptions, filepath: entry.path + (isDirectory ? '/' : '')})) continue;
            } catch (error) {
                unavailable.push({path: entry.path, change: 'unreadable', reason: error.message});
                continue;
            }
            if (isDirectory) pending.push(entry.path);
            else changes.push({path: entry.path, change: 'untracked'});
        }
    }
}

async function compareWorktreeBlob(bytes, before, attributes, autoCrlf) {
    if ((await hashBlob({object: bytes})).oid === before.oid) return null;
    const attrs = await attributes(before.path);
    if (attrs.filter || (attrs.ident && Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes('$Id:')) ||
        attrs['working-tree-encoding']) return 'contentFilter';
    if (attrs.text === false || !bytes.includes(13)) return 'modified';
    const forcedText = attrs.text === true || (attrs.text !== 'auto' && ['lf', 'crlf'].includes(attrs.eol));
    // System/global config is outside the workspace. The index records the last
    // working-file size Git accepted. Require a canonical blob match as well.
    const autoText = attrs.text === 'auto' || ['true', 'yes', 'on', '1', 'input'].includes(String(autoCrlf).toLowerCase());
    const unknownPolicy = !forcedText && !autoText && autoCrlf == null;
    if (!forcedText && !autoText && !unknownPolicy) return 'modified';
    let length = 0;
    let lines = 0;
    let printable = 0;
    let nonprinting = 0;
    for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i];
        if (byte === 13 && bytes[i + 1] === 10) continue;
        if (byte === 10) lines++;
        if (!forcedText) {
            if (byte === 0 || byte === 13) return 'modified';
            if (byte === 127 || (byte < 32 && ![8, 9, 10, 12, 27].includes(byte))) nonprinting++;
            else if (byte !== 10) printable++;
        }
        bytes[length++] = byte;
    }
    if (!forcedText && (printable >> 7) < nonprinting - Number(bytes[length - 1] === 26)) return 'modified';
    if (length === bytes.length || (await hashBlob({object: bytes.subarray(0, length)})).oid !== before.oid) return 'modified';
    if (unknownPolicy && !(before.size > length && before.size <= length + lines)) return 'unknownEol';
    return null;
}

async function worktreeIndex(options, disk, signal) {
    let entries;
    try {
        entries = await readIndexEntries(disk, signal);
    } catch (error) {
        if (error.code !== 'FILE_NOT_FOUND' || error.path !== '.git/index') throw error;
        // A new repository legitimately has no index before the first git add.
        const head = (await (await disk.readBlob('.git/HEAD', {signal})).text()).trim();
        try {
            await resolveRef({...options, ref: 'HEAD'});
        } catch (refError) {
            if (refError.code === 'NotFoundError' && head.startsWith('ref: refs/heads/') &&
                refError.data.what === head.slice(5)) return new Map();
            throw refError;
        }
        throw error;
    }
    const index = new Map();
    for (const entry of entries) {
        const path = entry.mode === 0o040000 && entry.skip ? entry.path.replace(/\/$/, '') : entry.path;
        if (!path || path.split('/').some(part => !part || ['.', '..', '.git'].includes(part.toLowerCase()))) {
            throw new Error('Invalid pathname in Git index');
        }
        index.set(path, entry);
    }
    return index;
}

async function listUnstaged(options, disk, readObject, signal) {
    const [index, autoCrlf, caseSetting] = await Promise.all([worktreeIndex(options, disk, signal),
        getConfig({...options, path: 'core.autocrlf'}), getConfig({...options, path: 'core.ignorecase'})]);
    const changes = [];
    const unavailable = [];
    const ignoreCase = ['true', 'yes', 'on', '1'].includes(String(caseSetting).toLowerCase());
    const attributes = worktreeAttributes(disk, index, readObject, ignoreCase, signal);
    const paths = [...index];
    // Read a bounded number of working files at once. Enumeration can omit a tracked
    // file on Windows, so always probe the indexed path directly.
    for (let start = 0; start < paths.length; start += 4) {
        signal?.throwIfAborted();
        await Promise.all(paths.slice(start, start + 4).map(async ([path, before]) => {
            try {
                if (before.skip) return;
                if (before.stage) {
                    unavailable.push({path, change: 'unmerged'});
                    return;
                }
                if (normalizeFilePath(path) !== path || ![0o100644, 0o100755].includes(before.mode)) {
                    unavailable.push({path, change: 'notRegular'});
                    return;
                }
                const blob = await disk.readBlob(path, {signal});
                const change = before.intentToAdd ? 'added' : await compareWorktreeBlob(new Uint8Array(await blob.arrayBuffer()), before, attributes, autoCrlf);
                if (change === 'contentFilter' || change === 'unknownEol') unavailable.push({path, change});
                else if (change) changes.push({path, change});
            } catch (error) {
                signal?.throwIfAborted();
                unavailable.push({path, change: error.code === 'FILE_NOT_FOUND' ? 'missing' : 'unreadable', reason: error.message});
            }
        }));
    }
    const folded = ignoreCase ? new Set([...index.keys()].map(path => path.toLowerCase())) : null;
    await listUntracked(options, disk, path => folded ? folded.has(path.toLowerCase()) : index.has(path), changes, unavailable, signal);
    const byPath = (a, b) => a.path.localeCompare(b.path);
    return {index, changes: changes.sort(byPath), unavailable: unavailable.sort(byPath)};
}

export async function openGitRepository(disk) {
    const entry = await disk.stat('.git');
    if (entry.kind !== 'directory') throw new FileNotDirectoryError('.git');
    // Upstream also references Buffer as a browser global when reading pack files.
    globalThis.Buffer ??= Buffer;
    const options = {fs: gitFileSystem(disk), dir: '/', gitdir: '/.git', cache: {}};
    async function readObject(oid, path = oid) {
        const {blob} = await readBlob({...options, oid});
        disk.policy.assertMemoryRead(path, blob.byteLength);
        return new Blob([blob]);
    }
    return {
        async listBranches() {
            const [head, locals, remotes] = await Promise.all([
                currentBranch({...options, fullname: true}),
                listRefs({...options, filepath: 'refs/heads'}),
                listRefs({...options, filepath: 'refs/remotes'}),
            ]);
            const branches = locals.map(name => ({name, ref: 'refs/heads/' + name}));
            if (head && !branches.some(branch => branch.ref === head)) {
                branches.push({ref: head, name: head.replace(/^refs\/heads\//, '')});
            }
            const current = head || 'HEAD';
            if (!head) branches.push({ref: 'HEAD', name: 'HEAD'});
            branches.sort((a, b) => Number(b.ref === current) - Number(a.ref === current) || a.name.localeCompare(b.name));
            branches.push(...remotes.filter(name => !name.endsWith('/HEAD')).map(name => ({name, ref: 'refs/remotes/' + name, remote: true})));
            return {current, branches};
        },
        listUnstaged({signal} = {}) {
            return listUnstaged(options, disk, readObject, signal);
        },
        listCommits({ref = 'HEAD', depth} = {}) {
            return log({...options, ref, depth});
        },
        async listFiles({ref = 'HEAD', baseRef} = {}) {
            // Both sides are Git trees. An absent entry here is authoritative.
            const trees = baseRef ? [TREE({ref: baseRef}), TREE({ref})] : [TREE({ref})];
            const rows = await walk({...options, trees, map: async (path, entries) => {
                const [a, b] = await Promise.all((baseRef ? entries : [null, entries[0]]).map(describe));
                if (a && b && a.oid === b.oid && a.mode === b.mode) return null;
                const before = a?.type === 'tree' ? null : a;
                const after = b?.type === 'tree' ? null : b;
                if (before || after) return {path, before, after};
            }});
            return rows || [];
        },
        readBlob: readObject,
    };
}
