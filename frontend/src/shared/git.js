import {Buffer} from 'buffer';
import {currentBranch, getConfig, hashBlob, isIgnored, listRefs, log, readBlob, resolveRef, TREE, walk} from 'isomorphic-git';
import picomatch from 'picomatch/posix.js';
import {FileNotDirectoryError} from './file-system/file-system-errors.js';
import {normalizeFilePath} from './file-utils.js';

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

const quotedPathEscapes = {a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92};

function unquotePattern(quoted) {
    const chunks = [];
    for (const [token] of quoted.slice(1, -1).matchAll(/[^\\]+|\\(?:[0-3][0-7]{2}|.)/gs)) {
        if (!token.startsWith('\\')) chunks.push(Buffer.from(token));
        else {
            const byte = token.length === 4 ? parseInt(token.slice(1), 8) : quotedPathEscapes[token[1]];
            if (byte === undefined) return '';
            chunks.push(Buffer.from([byte]));
        }
    }
    return Buffer.concat(chunks).toString('utf8');
}

function parseAttributeRules(source, ignoreCase) {
    const rules = [];
    for (const raw of source.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('!')) continue;
        const fields = /^("(?:[^"\\]|\\.)*"|[^ \t]+)[ \t]+(.+)$/.exec(line);
        if (!fields) continue;
        let pattern = fields[1];
        if (pattern.startsWith('"')) pattern = unquotePattern(pattern);
        if (!pattern || pattern.startsWith('!')) continue;
        const attributes = fields[2].split(/[ \t]+/);
        if (pattern.startsWith('[attr]')) {
            rules.push({macro: pattern.slice(6), attributes});
        } else {
            const basename = !pattern.includes('/');
            const matches = picomatch(pattern.replace(/^\//, ''), {windows: false, dot: true, nocase: ignoreCase,
                nonegate: true, noext: true, nobrace: true, regex: false, literalBrackets: false});
            rules.push({basename, matches, attributes});
        }
    }
    return rules;
}

function applyAttributes(tokens, values, macros, expanding = new Set()) {
    for (const token of tokens) {
        const [, modifier, name, setting] = /^([-!]?)([^=]+)(?:=(.*))?$/.exec(token) || [];
        if (!name) continue;
        const value = modifier === '-' ? false : modifier === '!' ? undefined : setting ?? true;
        values[name] = value;
        if (value === true && macros.has(name) && !expanding.has(name)) {
            expanding.add(name);
            applyAttributes(macros.get(name), values, macros, expanding);
            expanding.delete(name);
        }
    }
}

function worktreeAttributes(disk, index, readBlob, ignoreCase, signal) {
    const cache = new Map();
    async function readRules(path) {
        let blob;
        try {
            blob = await disk.readBlob(path, {signal});
        } catch (error) {
            if (error.code !== 'FILE_NOT_FOUND') throw error;
            const entry = index.get(path);
            if (!entry || ![0o100644, 0o100755].includes(entry.mode)) return [];
            blob = await readBlob(entry.oid, path);
        }
        return parseAttributeRules(await blob.text(), ignoreCase);
    }
    function rules(path) {
        if (!cache.has(path)) cache.set(path, readRules(path));
        return cache.get(path);
    }
    return async path => {
        const parts = path.split('/');
        const files = ['.gitattributes'];
        for (let i = 1; i < parts.length; i++) files.push(parts.slice(0, i).join('/') + '/.gitattributes');
        files.push('.git/info/attributes');
        const sources = await Promise.all(files.map(rules));
        const macros = new Map([['binary', ['-text']]]);
        for (const set of [sources[0], sources.at(-1)]) {
            for (const rule of set) if (rule.macro) macros.set(rule.macro, rule.attributes);
        }
        const values = Object.create(null);
        for (const [i, set] of sources.entries()) {
            const relative = i === sources.length - 1 ? path : parts.slice(i).join('/');
            for (const rule of set) {
                if (!rule.macro && rule.matches(rule.basename ? parts.at(-1) : relative)) {
                    applyAttributes(rule.attributes, values, macros);
                }
            }
        }
        return values;
    };
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

const INDEX_HASH_BYTES = 20;
const indexPathDecoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});

function invalidIndex(detail) {
    throw new Error('Invalid Git index: ' + detail);
}

// The stage walker does not apply the mandatory 'link' extension of split indexes.
// Read the on-disk entries, including their cached working-file sizes, in index order.
async function readIndexFile(disk, path, signal, expectedHash) {
    const file = await disk.readBlob(path, {signal});
    const data = Buffer.from(await file.arrayBuffer());
    const end = data.length - INDEX_HASH_BYTES;
    if (end < 12 || data.toString('ascii', 0, 4) !== 'DIRC') invalidIndex(path);
    const version = data.readUInt32BE(4);
    if (![2, 3, 4].includes(version)) throw new Error('Unsupported Git index version: ' + version);
    const checksum = data.subarray(end);
    if (expectedHash || checksum.some(byte => byte !== 0)) {
        const hash = Buffer.from(await crypto.subtle.digest('SHA-1', data.subarray(0, end)));
        if (!hash.equals(checksum) || (expectedHash && hash.toString('hex') !== expectedHash)) invalidIndex(path + ' checksum');
    }

    const entries = [];
    const count = data.readUInt32BE(8);
    let offset = 12;
    let previous = Buffer.alloc(0);
    for (let i = 0; i < count; i++) {
        const start = offset;
        if (start + 62 > end) invalidIndex('truncated entry');
        const mode = data.readUInt32BE(start + 24);
        const size = data.readUInt32BE(start + 36);
        const oid = data.toString('hex', start + 40, start + 60);
        const flags = data.readUInt16BE(start + 60);
        const extended = Boolean(flags & 0x4000);
        offset = start + (extended ? 64 : 62);
        if (offset >= end || (extended && version === 2)) invalidIndex('entry flags');
        const extra = extended ? data.readUInt16BE(start + 62) : 0;
        if (extra & ~0x6000) invalidIndex('unknown entry flags');
        let prefix = 0;
        if (version === 4) {
            let byte = data[offset++];
            let strip = byte & 127;
            while (byte & 128) {
                if (offset >= end || strip >= previous.length) invalidIndex('compressed pathname');
                byte = data[offset++];
                strip = (strip + 1) * 128 + (byte & 127);
            }
            if (strip > previous.length) invalidIndex('compressed pathname');
            prefix = previous.length - strip;
        }
        const nul = data.indexOf(0, offset);
        if (nul < 0 || nul >= end) invalidIndex('unterminated pathname');
        const suffix = data.subarray(offset, nul);
        previous = prefix ? Buffer.concat([previous.subarray(0, prefix), suffix]) : suffix;
        const name = indexPathDecoder.decode(previous);
        entries.push({path: name, oid, mode, size, stage: (flags >> 12) & 3,
            skip: Boolean((flags & 0x8000) || (extra & 0x4000)), intentToAdd: Boolean(extra & 0x2000)});
        offset = version === 4 ? nul + 1 : start + Math.ceil((nul + 1 - start) / 8) * 8;
        if (offset > end) invalidIndex('entry padding');
    }

    let link;
    while (offset < end) {
        if (offset + 8 > end) invalidIndex('extension header');
        const signature = data.toString('ascii', offset, offset + 4);
        const length = data.readUInt32BE(offset + 4);
        offset += 8;
        if (length > end - offset) invalidIndex('extension size');
        if (signature === 'link') link = data.subarray(offset, offset + length);
        else if (signature !== 'sdir' && !/^[A-Z]/.test(signature)) throw new Error('Unsupported Git index extension: ' + signature);
        offset += length;
    }
    return {entries, link};
}

// Each EWAH marker counts a run of all-zero/all-one 64-bit words, then literal words.
function readBitmap(link, offset, entryCount) {
    if (offset + 8 > link.length) invalidIndex('split index bitmap header');
    const bits = link.readUInt32BE(offset);
    const words = link.readUInt32BE(offset + 4);
    offset += 8;
    const end = offset + words * 8;
    if (bits > entryCount || end + 4 > link.length) invalidIndex('split index bitmap size');
    const positions = [];
    let position = 0;
    while (offset < end) {
        const marker = link.readBigUInt64BE(offset);
        offset += 8;
        const run = Number((marker >> 1n) & 0xffffffffn) * 64;
        const literals = Number(marker >> 33n);
        if (position + run > Math.ceil(bits / 64) * 64 || offset + literals * 8 > end) invalidIndex('split index bitmap run');
        if (marker & 1n) {
            for (let i = position; i < Math.min(position + run, bits); i++) positions.push(i);
        }
        position += run;
        for (let i = 0; i < literals; i++) {
            let word = link.readBigUInt64BE(offset);
            offset += 8;
            for (let bit = position; word; bit++, word >>= 1n) {
                if (bit >= bits) invalidIndex('split index bitmap position');
                if (word & 1n) positions.push(bit);
            }
            position += 64;
        }
    }
    return {positions, next: end + 4}; // trailing current-running-length-word pointer
}

export async function readIndexEntries(disk, signal) {
    const {entries, link} = await readIndexFile(disk, '.git/index', signal);
    if (!link) return entries;
    if (link.length < INDEX_HASH_BYTES) invalidIndex('split index link');
    const hash = link.toString('hex', 0, INDEX_HASH_BYTES);
    const shared = /^0+$/.test(hash) ? [] : (await readIndexFile(disk, '.git/sharedindex.' + hash, signal, hash)).entries;
    if (link.length === INDEX_HASH_BYTES) return shared.concat(entries);
    const deleted = readBitmap(link, INDEX_HASH_BYTES, shared.length);
    const replaced = readBitmap(link, deleted.next, shared.length);
    if (replaced.next !== link.length || replaced.positions.length > entries.length) invalidIndex('split index entries');
    for (const [i, position] of replaced.positions.entries()) {
        shared[position] = {...entries[i], path: shared[position].path};
    }
    for (const position of deleted.positions) shared[position] = null;
    return shared.filter(Boolean).concat(entries.slice(replaced.positions.length));
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
