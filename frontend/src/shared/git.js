import {Buffer} from 'buffer';
import {commit, currentBranch, getConfig, hashBlob, isIgnored, listRefs, log, readBlob, resolveRef, TREE, updateIndex, walk} from 'isomorphic-git';
import picomatch from 'picomatch/posix.js';
import {FileNotDirectoryError} from './file-system/file-system-errors.js';
import {getParentFilePath, normalizeFilePath} from './file-utils.js';

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
                mode: entry.kind === 'directory' ? 0o040000 : 0o100644, size: entry.size,
                mtimeMs: Number(String(entry.version).split(':')[0]) || 0, ctimeMs: 0, dev: 0, ino: 0, uid: 0, gid: 0};
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
    const unsupported = async () => { throw new Error('Unsupported Git filesystem operation'); };
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

async function listUntracked(options, disk, tracked, changes, unavailable, {signal, onlyPath, ignoreCase, onProgress}) {
    const fs = options.fs.promises;
    const ignoreOptions = {...options, fs: {promises: {...fs, readFile: memoizeRead(fs.readFile), stat: memoizeRead(fs.stat)}}};
    const pending = [''];
    const target = ignoreCase ? onlyPath?.toLowerCase() : onlyPath;
    let directories = 0;
    onProgress?.({phase: 'scanUntracked', done: directories});
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
        } finally {
            if (!signal?.aborted) onProgress?.({phase: 'scanUntracked', done: ++directories});
        }
        if (directory && entries.some(entry => entry.name === '.git')) {
            unavailable.push({path: directory, change: 'nestedRepo'});
            continue;
        }
        for (const entry of entries) {
            signal?.throwIfAborted();
            const literalPath = directory ? directory + '/' + entry.name : entry.name;
            // 某些平台把反斜杠当作文件名的一部分；绝不能操作规范化后碰巧同名的另一个文件。
            if (literalPath !== entry.path) {
                unavailable.push({path: literalPath, change: 'unsupportedPath'});
                continue;
            }
            if (entry.name.toLowerCase() === '.git' || tracked(entry.path)) continue;
            if (target) {
                const path = ignoreCase ? entry.path.toLowerCase() : entry.path;
                if (path !== target && !target.startsWith(path + '/')) continue;
                if (path === target && entry.kind === 'directory') return false;
            }
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
    return true;
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

function needsContentFilter(attrs, bytes) {
    return attrs.filter || attrs['working-tree-encoding'] ||
        (attrs.ident && Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes('$Id:'));
}

function textStats(bytes) {
    let lf = 0, crlf = 0, printable = 0, nonprinting = 0;
    let binary = false;
    for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i];
        if (byte === 13 && bytes[i + 1] === 10) {
            crlf++;
            i++;
        } else if (byte === 10) lf++;
        else if (byte === 13 || byte === 0) binary = true;
        else if (byte === 127 || (byte < 32 && ![8, 9, 12, 27].includes(byte))) nonprinting++;
        else printable++;
    }
    return {lf, crlf, binary: binary || (printable >> 7) < nonprinting - Number(bytes.at(-1) === 26)};
}

function cleanLineEndings(bytes, attrs, autoCrlf) {
    if (attrs.text === false || !bytes.includes(13)) return {bytes};
    const forced = attrs.text === true || (attrs.text !== 'auto' && ['lf', 'crlf'].includes(attrs.eol));
    const auto = attrs.text === 'auto' || ['true', 'yes', 'on', '1', 'input'].includes(String(autoCrlf).toLowerCase());
    const unknown = !forced && !auto && autoCrlf == null;
    if (!forced && !auto && !unknown) return {bytes};
    const {lf, crlf, binary} = textStats(bytes);
    if (!crlf || (!forced && binary)) return {bytes};
    let length = 0;
    const clean = new Uint8Array(bytes.length - crlf);
    for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i];
        if (byte === 13 && bytes[i + 1] === 10) continue;
        clean[length++] = byte;
    }
    return {bytes: clean, forced, unknown, lines: lf + crlf};
}

async function compareWorktreeBlob(bytes, before, attributes, autoCrlf) {
    if ((await hashBlob({object: bytes})).oid === before.oid) return null;
    const attrs = await attributes(before.path);
    if (needsContentFilter(attrs, bytes)) return 'contentFilter';
    const clean = cleanLineEndings(bytes, attrs, autoCrlf);
    if (clean.bytes === bytes || (await hashBlob({object: clean.bytes})).oid !== before.oid) return 'modified';
    if (clean.unknown && !(before.size > clean.bytes.length && before.size <= clean.bytes.length + clean.lines)) return 'unknownEol';
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
    let writeIssue = version === 4 || !checksum.some(byte => byte !== 0) ? 'indexReadOnly' : '';
    while (offset < end) {
        if (offset + 8 > end) invalidIndex('extension header');
        const signature = data.toString('ascii', offset, offset + 4);
        const length = data.readUInt32BE(offset + 4);
        offset += 8;
        if (length > end - offset) invalidIndex('extension size');
        if (signature === 'link') link = data.subarray(offset, offset + length);
        else if (signature !== 'sdir' && !/^[A-Z]/.test(signature)) throw new Error('Unsupported Git index extension: ' + signature);
        // The index writer rebuilds entries and discards extensions. Only these
        // optional performance caches can be safely discarded and rebuilt by Git.
        if (!['TREE', 'UNTR', 'EOIE', 'IEOT'].includes(signature)) writeIssue = 'indexReadOnly';
        offset += length;
    }
    return {entries, link, writeIssue, signature: checksum.toString('hex')};
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
    return expandIndex(disk, await readIndexFile(disk, '.git/index', signal), signal);
}

async function expandIndex(disk, {entries, link}, signal) {
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

async function repositoryHead(options, disk, signal) {
    const value = (await (await disk.readBlob('.git/HEAD', {signal})).text()).trim();
    if (/^[\da-f]{40}$/.test(value)) return {ref: 'HEAD', oid: value};
    if (!value.startsWith('ref: ')) throw new Error('Invalid Git HEAD');
    const ref = value.slice(5);
    try {
        return {ref, oid: await resolveRef({...options, ref})};
    } catch (error) {
        if (ref.startsWith('refs/heads/') && error.code === 'NotFoundError' && error.data.what === ref) return {ref, oid: null};
        throw error;
    }
}

async function worktreeIndex(options, disk, signal, head) {
    let file;
    try {
        file = await readIndexFile(disk, '.git/index', signal);
    } catch (error) {
        if (error.code === 'FILE_NOT_FOUND' && !(head ?? await repositoryHead(options, disk, signal)).oid) {
            return {index: new Map(), signature: null, writeIssue: ''};
        }
        throw error;
    }
    const index = new Map();
    let writeIssue = file.writeIssue;
    for (const entry of await expandIndex(disk, file, signal)) {
        const path = entry.mode === 0o040000 && entry.skip ? entry.path.replace(/\/$/, '') : entry.path;
        if (!path || path.split('/').some(part => !part || ['.', '..', '.git'].includes(part.toLowerCase()))) {
            throw new Error('Invalid pathname in Git index');
        }
        if (entry.stage) writeIssue = 'unmerged';
        if (![0o100644, 0o100755, 0o120000, 0o160000].includes(entry.mode) || normalizeFilePath(path) !== path) writeIssue ||= 'indexReadOnly';
        index.set(path, entry);
    }
    return {index, signature: file.signature, writeIssue};
}

async function listUnstaged(options, disk, readObject, index, {signal, onlyPath, onProgress} = {}) {
    const [autoCrlf, caseSetting] = await Promise.all([
        getConfig({...options, path: 'core.autocrlf'}), getConfig({...options, path: 'core.ignorecase'})]);
    const changes = [];
    const unavailable = [];
    const ignoreCase = ['true', 'yes', 'on', '1'].includes(String(caseSetting).toLowerCase());
    const attributes = worktreeAttributes(disk, index, readObject, ignoreCase, signal);
    const paths = onlyPath ? (index.has(onlyPath) ? [[onlyPath, index.get(onlyPath)]] : []) : [...index];
    // Read a bounded number of working files at once. Enumeration can omit a tracked
    // file on Windows, so always probe the indexed path directly.
    onProgress?.({phase: 'scanTracked', done: 0, total: paths.length});
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
        onProgress?.({phase: 'scanTracked', done: Math.min(start + 4, paths.length), total: paths.length});
    }
    if (!onlyPath || !index.has(onlyPath)) {
        const folded = ignoreCase ? new Set([...index.keys()].map(path => path.toLowerCase())) : null;
        const complete = await listUntracked(options, disk, path => folded ? folded.has(path.toLowerCase()) : index.has(path),
            changes, unavailable, {signal, onlyPath, ignoreCase, onProgress});
        if (!complete) return null;
    }
    const byPath = (a, b) => a.path.localeCompare(b.path);
    return {changes: changes.sort(byPath), unavailable: unavailable.sort(byPath)};
}

function indexObject(entry) {
    if (!entry || entry.intentToAdd) return;
    return {oid: entry.oid, mode: entry.mode, type: entry.mode === 0o160000 ? 'commit' : 'blob'};
}

function stagedChange(path, before, entry) {
    if (entry?.stage || entry?.mode === 0o040000) return null;
    const after = entry?.intentToAdd ? null : entry;
    if (before?.oid === after?.oid && before?.mode === after?.mode) return null;
    return {path, before, after: after && {...after, ...indexObject(after)}, change: !before ? 'added' : !after ? 'deleted' : 'modified'};
}

async function listStaged(options, head, index, signal) {
    const previous = new Map();
    if (head.oid) {
        await walk({...options, trees: [TREE({ref: head.oid})], map: async (path, [entry]) => {
            signal?.throwIfAborted();
            if (index.get(path)?.mode === 0o040000) return null; // sparse directory
            if (await entry.type() !== 'tree') previous.set(path, await describe(entry));
        }});
    }
    const changes = [];
    for (const path of new Set([...previous.keys(), ...index.keys()])) {
        const change = stagedChange(path, previous.get(path), index.get(path));
        if (change) changes.push(change);
    }
    return changes.sort((a, b) => a.path.localeCompare(b.path));
}

function gitWriteError(reason) {
    return Object.assign(new Error(reason), {gitReason: reason});
}

async function optionalStat(disk, path) {
    try {
        return await disk.stat(path);
    } catch (error) {
        if (error.code === 'FILE_NOT_FOUND') return null;
        throw error;
    }
}

async function writeRestriction(options, disk, state) {
    if (state.writeIssue) return state.writeIssue;
    const ref = state.head.ref;
    if (ref !== 'HEAD') {
        if (!ref.startsWith('refs/heads/') || normalizeFilePath(ref) !== ref || ref.includes('..') || ref.includes('@{') ||
            /[\x00-\x20\x7f~^:?*\[\\]/.test(ref) || ref.endsWith('.') ||
            ref.split('/').some(part => part.startsWith('.') || part.endsWith('.lock'))) return 'repoReadOnly';
        const path = '.git/' + ref;
        if (await optionalStat(disk, path) && !/^[\da-f]{40}$/.test((await disk.readText(path)).trim())) return 'repoReadOnly';
    }
    const entries = await disk.list('.git', {withMetadata: false});
    if (entries.some(({name}) => name === 'commondir')) return 'repoReadOnly';
    if (entries.some(({name}) => ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-apply', 'rebase-merge', 'sequencer'].includes(name))) return 'operationInProgress';
    const [format, storage] = await Promise.all(['extensions.objectformat', 'extensions.refstorage']
        .map(path => getConfig({...options, path})));
    return (format && format !== 'sha1') || (storage && storage !== 'files') ? 'repoReadOnly' : '';
}

async function readGitState(options, disk, signal) {
    const head = await repositoryHead(options, disk, signal);
    const state = {...await worktreeIndex(options, disk, signal, head), head};
    try {
        state.writeIssue = await writeRestriction(options, disk, state);
    } catch (error) {
        if (error.code !== 'FILE_PERMISSION_DENIED') throw error;
        state.writeIssue = 'metadataReadOnly';
    }
    return state;
}

async function ensureGitDirectory(disk, path) {
    if (await optionalStat(disk, path)) return;
    // Request creation only for missing directories. Browsers can grant access
    // to an existing .git while disallowing creation of .git itself.
    if (path === '.git') throw gitWriteError('stateChanged');
    await ensureGitDirectory(disk, getParentFilePath(path));
    await disk.createDirectory(path);
}

async function writeGitFile(disk, path, data, expectedVersion) {
    try {
        return await disk.writeBlob(path, data, {expectedVersion});
    } catch (error) {
        // getFileHandle(create:true) may have created an empty file before the
        // writable stream failed. An empty loose object or ref would shadow Git data.
        if (expectedVersion === null && error.code !== 'FILE_CONFLICT') {
            const entry = await optionalStat(disk, path);
            if (entry?.kind === 'file' && entry.size === 0) await disk.remove(path, {kind: 'file', expectedVersion: entry.version});
        }
        throw error;
    }
}

async function withGitLocks(disk, targets, action) {
    const owner = crypto.randomUUID();
    const locks = [];
    let published = false;
    let result;
    try {
        for (const target of targets) {
            const path = target + '.lock';
            await ensureGitDirectory(disk, getParentFilePath(path));
            if (await optionalStat(disk, path)) throw gitWriteError('repositoryBusy');
            locks.push(await writeGitFile(disk, path, owner, null));
        }
        result = await action(async () => {
            for (const {path} of locks) {
                if (await disk.readText(path) !== owner) throw gitWriteError('repositoryBusy');
            }
        });
        published = true;
        return result;
    } finally {
        const remaining = [];
        for (const {path, version} of locks.reverse()) {
            try {
                if (await disk.readText(path) === owner) await disk.remove(path, {kind: 'file', expectedVersion: version});
            } catch (error) {
                if (error.code !== 'FILE_NOT_FOUND') remaining.push(path);
            }
        }
        if (remaining.length && published) {
            throw Object.assign(gitWriteError('lockCleanup'), {path: remaining.join(', '), published, result});
        }
    }
}

// Let the library serialize Git objects and index entries. Only immutable loose
// objects reach disk here; the caller publishes one index or ref after revalidation.
function mutationFileSystem(options, disk, pendingIndex) {
    const writeFile = async (path, bytes) => {
        const name = gitPath(path);
        if (name === '.git/index' && pendingIndex) {
            pendingIndex.bytes = bytes;
            return;
        }
        if (!/^\.git\/objects\/[\da-f]{2}\/[\da-f]{38}$/.test(name)) throw gitWriteError('repoReadOnly');
        await ensureGitDirectory(disk, getParentFilePath(name));
        if (!await optionalStat(disk, name)) await writeGitFile(disk, name, bytes, null);
    };
    const fs = options.fs.promises;
    return {promises: {...fs, writeFile,
        // 多选时，后续路径必须读取前一路径已经生成、还没有发布的索引。
        readFile: async (path, opts) => pendingIndex?.bytes && gitPath(path) === '.git/index' ? pendingIndex.bytes : fs.readFile(path, opts),
        // writeFile already creates the parent. Preserve its error if the library retries.
        mkdir: async path => {
            if (!/^\.git\/objects\/[\da-f]{2}$/.test(gitPath(path))) throw gitWriteError('repoReadOnly');
        }}};
}

function assertNoPathConflict(index, path) {
    if (normalizeFilePath(path) !== path || path.split('/').some(name => name.toLowerCase() === '.git') ||
        [...index.keys()].some(other => other.startsWith(path + '/') || path.startsWith(other + '/'))) {
        throw gitWriteError('pathConflict');
    }
}

async function stageBytes(options, disk, readObject, index, path, bytes, eol) {
    const before = index.get(path);
    if (!before) await verifyUntrackedPath(options, disk, path);
    const [autoCrlf, caseSetting] = await Promise.all([
        getConfig({...options, path: 'core.autocrlf'}), getConfig({...options, path: 'core.ignorecase'})]);
    const attributes = worktreeAttributes(disk, index, readObject, /^(true|yes|on|1)$/i.test(caseSetting));
    const attrs = await attributes(path);
    if (needsContentFilter(attrs, bytes)) throw gitWriteError('contentFilter');
    const clean = cleanLineEndings(bytes, attrs, autoCrlf);
    if (clean.bytes === bytes) return bytes;
    // Native Git's automatic text handling preserves CRLF already present in the index.
    if (!clean.forced && before && !before.intentToAdd) {
        const prior = Buffer.from(await (await readObject(before.oid, path)).arrayBuffer());
        if (prior.includes('\r\n')) return bytes;
        if (clean.unknown && before.size > prior.length && before.size <= prior.length + prior.reduce((n, byte) => n + (byte === 10), 0)) return clean.bytes;
    }
    if (clean.unknown && !['lf', 'disk'].includes(eol)) throw gitWriteError('chooseEol');
    return clean.unknown && eol === 'disk' ? bytes : clean.bytes;
}

async function verifyUntrackedPath(options, disk, path) {
    if (await isIgnored({...options, filepath: path})) throw gitWriteError('stateChanged');
    await checkNestedRepository(disk, path);
}

async function checkNestedRepository(disk, path) {
    for (let parent = getParentFilePath(path); parent; parent = getParentFilePath(parent)) {
        if (await optionalStat(disk, parent + '/.git')) throw gitWriteError('nestedRepo');
    }
}

async function checkoutBlob(options, disk, readObject, index, path) {
    const entry = index.get(path);
    const [blob, caseSetting, autoSetting, coreEol] = await Promise.all([
        readObject(entry.oid, path), ...['core.ignorecase', 'core.autocrlf', 'core.eol'].map(path => getConfig({...options, path})),
    ]);
    // 按路径执行 git restore 时使用当前工作区的属性，磁盘缺少属性文件时才读取索引。
    const attrs = await worktreeAttributes(disk, index, readObject, /^(true|on|yes|1)$/i.test(caseSetting))(path);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (needsContentFilter(attrs, bytes) || (attrs.ident && Buffer.from(bytes.buffer).includes('$Id$'))) throw gitWriteError('contentFilter');
    if (attrs.text === false || attrs.eol === 'lf' || !bytes.includes(10)) return blob;
    const stats = textStats(bytes);
    const forced = attrs.text === true || (attrs.text !== 'auto' && attrs.eol === 'crlf');
    if (!stats.lf || (!forced && (stats.binary || stats.crlf))) return blob;

    const autoCrlf = String(autoSetting).toLowerCase();
    let eol = attrs.eol;
    if (eol !== 'crlf') {
        if (/^(true|on|yes|1)$/.test(autoCrlf)) eol = 'crlf';
        else if (autoCrlf === 'input' || (!attrs.text && autoSetting != null)) eol = 'lf';
        else if (attrs.text && ['lf', 'crlf'].includes(coreEol)) eol = coreEol;
        // 网页读不到本机的全局 Git 配置。优先用索引记录的工作区字节数判断原有行尾。
        else if (entry.size === bytes.length) eol = 'lf';
        else if (entry.size === bytes.length + stats.lf) eol = 'crlf';
        else {
            const current = textStats(new Uint8Array(await (await disk.readBlob(path)).arrayBuffer()));
            if (!current.binary && current.lf && !current.crlf) eol = 'lf';
            else if (!current.binary && current.crlf && !current.lf) eol = 'crlf';
            else throw gitWriteError('checkoutEol');
        }
    }
    if (eol !== 'crlf') return blob;
    disk.policy.assertMemoryWrite(path, bytes.length + stats.lf);
    const expanded = new Uint8Array(bytes.length + stats.lf);
    let offset = 0;
    for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 10 && bytes[i - 1] !== 13) expanded[offset++] = 13;
        expanded[offset++] = bytes[i];
    }
    return new Blob([expanded]);
}

export async function openGitRepository(disk) {
    const entry = await disk.stat('.git');
    if (entry.kind !== 'directory') throw new FileNotDirectoryError('.git');
    // Upstream also references Buffer as a browser global when reading pack files.
    globalThis.Buffer ??= Buffer;
    const options = {fs: gitFileSystem(disk), dir: '/', gitdir: '/.git', cache: {}};
    let lastIndexEdit;
    async function readObject(oid, path = oid) {
        const {blob} = await readBlob({...options, oid});
        disk.policy.assertMemoryRead(path, blob.byteLength);
        return new Blob([blob]);
    }
    async function status({signal, onProgress} = {}) {
        onProgress?.({phase: 'checkGit'});
        const state = await readGitState(options, disk, signal);
        const [worktree, staged] = await Promise.all([
            listUnstaged(options, disk, readObject, state.index, {signal, onProgress}).then(result => {
                onProgress?.({phase: 'finishScan'});
                return result;
            }),
            listStaged(options, state.head, state.index, signal),
        ]);
        return {...state, ...worktree, staged};
    }
    // A single-path refresh is valid only for the exact index we published from
    // the displayed snapshot. External index/HEAD changes require a full status.
    async function refreshPath(path, previous, {signal} = {}) {
        const edit = lastIndexEdit;
        if (!edit || edit.path !== path || edit.from !== previous?.signature || /(^|\/)\.git(attributes|ignore)$/i.test(path)) return null;
        const state = await readGitState(options, disk, signal);
        if (state.writeIssue || state.signature !== edit.to || state.head.oid !== previous.head.oid || state.head.ref !== previous.head.ref) return null;
        const partial = await listUnstaged(options, disk, readObject, state.index, {onlyPath: path, signal});
        if (!partial || [...partial.changes, ...partial.unavailable].some(file => file.path !== path)) return null;

        const priorChange = previous.staged.find(row => row.path === path);
        const before = priorChange ? priorChange.before : indexObject(previous.index.get(path));
        const staged = stagedChange(path, before, state.index.get(path));
        function replace(rows, updated) {
            return rows.filter(row => row.path !== path).concat(updated).sort((a, b) => a.path.localeCompare(b.path));
        }
        return {...state, staged: replace(previous.staged, staged ? [staged] : []),
            changes: replace(previous.changes, partial.changes), unavailable: replace(previous.unavailable, partial.unavailable)};
    }
    async function withValidatedGitState(state, committing, onProgress, action) {
        if (state.writeIssue) throw gitWriteError(state.writeIssue);
        await disk.checkAccess('.git', {writable: true, request: true});
        async function validate() {
            const fresh = await readGitState(options, disk);
            if (fresh.writeIssue) throw gitWriteError(fresh.writeIssue);
            if (fresh.signature !== state.signature || fresh.head.ref !== state.head.ref || fresh.head.oid !== state.head.oid) {
                throw gitWriteError('stateChanged');
            }
            return fresh;
        }
        async function edit() {
            onProgress?.({phase: 'checkGit'});
            const target = committing ? '.git/' + (await validate()).head.ref : '.git/index';
            const locks = committing ? new Set(['.git/index', '.git/HEAD', target]) : ['.git/index'];
            return withGitLocks(disk, locks, async verifyOwnership => {
                const fresh = await validate();
                return action(fresh.index, target, async () => {
                    await validate();
                    await verifyOwnership();
                });
            });
        }
        // Git lock files coordinate with native clients; Web Locks serialize browser tabs.
        return globalThis.navigator?.locks ? navigator.locks.request('gtools-git-write', edit) : edit();
    }
    async function mutate(state, committing, prepare, {path, onProgress}) {
        return withValidatedGitState(state, committing, onProgress, async (index, target, verify) => {
            const version = (await optionalStat(disk, target))?.version ?? null;
            const pendingIndex = committing ? null : {bytes: null};
            const fs = mutationFileSystem(options, disk, pendingIndex);
            const result = await prepare({...options, fs, cache: {}}, index);
            onProgress?.({phase: committing ? 'writeRef' : 'writeIndex'});
            await verify();
            const data = committing ? result + '\n' : pendingIndex.bytes;
            if (!data) throw gitWriteError('stateChanged');
            await writeGitFile(disk, target, data, version);
            lastIndexEdit = path ? {path, from: state.signature, to: Buffer.from(data.subarray(-INDEX_HASH_BYTES)).toString('hex')} : null;
            return result;
        });
    }
    async function stageIndexPath(write, index, path, eol, progress) {
        assertNoPathConflict(index, path);
        progress('readFile');
        const raw = new Uint8Array(await (await disk.readBlob(path)).arrayBuffer());
        progress('prepareFile');
        const bytes = await stageBytes(options, disk, readObject, index, path, raw, eol);
        const fs = write.fs.promises;
        const mode = index.get(path)?.mode ?? 0o100644;
        // 索引的文件大小来自磁盘，Git 对象则使用按属性处理后的字节。
        const stat = {mode, size: raw.length, ctimeMs: 0, mtimeMs: 0, dev: 0, ino: 0, uid: 0, gid: 0,
            isDirectory: () => false, isSymbolicLink: () => false};
        const oid = await updateIndex({...write, filepath: path, add: true, fs: {promises: {...fs,
            lstat: p => p === '/' + path ? stat : fs.lstat(p),
            readFile: (p, opts) => p === '/' + path ? bytes : fs.readFile(p, opts)}}});
        index.set(path, {path, oid, size: raw.length, mode});
        return oid;
    }
    async function unstageIndexPath(write, index, path, before, progress) {
        progress('prepareIndex');
        if (!before) {
            await updateIndex({...write, filepath: path, remove: true, force: true});
            index.delete(path);
            return;
        }
        assertNoPathConflict(index, path);
        const oid = await updateIndex({...write, filepath: path, oid: before.oid, mode: before.mode, add: true});
        index.set(path, before);
        return oid;
    }
    async function editIndex(paths, state, staging, {onProgress, eolByPath} = {}) {
        const selected = [...new Set(paths)];
        const rows = new Map((staging ? state.changes : state.staged).map(row => [row.path, row]));
        if (!selected.length || selected.some(path => !rows.has(path))) throw gitWriteError('stateChanged');
        // 文件和目录互相替换时，先移出新增路径，再放回 HEAD 中原有的路径。
        if (!staging) selected.sort((a, b) => Number(Boolean(rows.get(a).before)) - Number(Boolean(rows.get(b).before)));
        return mutate(state, false, async (write, index) => {
            let result;
            for (const [i, path] of selected.entries()) {
                const progress = phase => onProgress?.({phase, path, done: i, total: selected.length});
                try {
                    result = staging
                        ? await stageIndexPath(write, index, path, eolByPath?.get(path), progress)
                        : await unstageIndexPath(write, index, path, rows.get(path).before, progress);
                } catch (error) {
                    error.path ??= path;
                    throw error;
                }
            }
            return result;
        }, {path: selected.length === 1 ? selected[0] : undefined, onProgress});
    }
    async function changeDiskFile(path, state, removing, {expectedVersion, beforeWrite, onProgress} = {}) {
        const change = state.changes.find(row => row.path === path);
        if (expectedVersion == null || change?.change !== (removing ? 'untracked' : 'modified')) throw gitWriteError('stateChanged');
        return withValidatedGitState(state, false, onProgress, async (index, _, verify) => {
            assertNoPathConflict(index, path);
            const entry = index.get(path);
            const observed = await disk.stat(path);
            if (observed.kind !== 'file' || observed.version !== expectedVersion) throw gitWriteError('stateChanged');
            let blob;
            if (removing) {
                const ignoreCase = /^(true|on|yes|1)$/i.test(await getConfig({...options, path: 'core.ignorecase'}));
                if (entry || (ignoreCase && [...index.keys()].some(name => name.toLowerCase() === path.toLowerCase()))) throw gitWriteError('stateChanged');
            } else {
                if (!entry || entry.skip || entry.stage || entry.intentToAdd || ![0o100644, 0o100755].includes(entry.mode)) throw gitWriteError('stateChanged');
                onProgress?.({phase: 'readFile', path});
                blob = await checkoutBlob(options, disk, readObject, index, path);
            }
            await verify();
            if (removing) await verifyUntrackedPath(options, disk, path);
            else await checkNestedRepository(disk, path);
            beforeWrite?.(path);
            return removing ? disk.remove(path, {kind: 'file', expectedVersion}) : disk.writeBlob(path, blob, {expectedVersion});
        });
    }
    return {
        status, refreshPath,
        async author() {
            const [name, email] = await Promise.all(['user.name', 'user.email'].map(path => getConfig({...options, path})));
            return {name: name || '', email: email || ''};
        },
        stage(path, state, {eol, onProgress} = {}) {
            return editIndex([path], state, true, {eolByPath: new Map([[path, eol]]), onProgress});
        },
        unstage: (path, state, options) => editIndex([path], state, false, options),
        stagePaths: (paths, state, options) => editIndex(paths, state, true, options),
        unstagePaths: (paths, state, options) => editIndex(paths, state, false, options),
        discardPath: (path, state, options) => changeDiskFile(path, state, false, options),
        deleteUntrackedPath: (path, state, options) => changeDiskFile(path, state, true, options),
        async commitStaged(state, message, author, {onProgress} = {}) {
            if (!state.staged.length || !message.trim()) throw gitWriteError('nothingToCommit');
            const authorField = ['name', 'email'].find(field => {
                const value = author?.[field];
                return typeof value !== 'string' || !value.trim() || /[<>\r\n\0]/.test(value);
            });
            if (authorField) throw Object.assign(gitWriteError('invalidAuthor'), {authorField});
            if (/^(true|on|yes|1)$/i.test(await getConfig({...options, path: 'commit.gpgsign'}))) throw gitWriteError('signingRequired');
            return mutate(state, true, write => {
                onProgress?.({phase: 'prepareCommit'});
                return commit({...write, author, committer: author, message: message.trim(), noUpdateBranch: true, disallowEmpty: true});
            }, {onProgress});
        },
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
        async listUnstaged({signal} = {}) {
            const {index} = await worktreeIndex(options, disk, signal);
            return {index, ...await listUnstaged(options, disk, readObject, index, {signal})};
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
