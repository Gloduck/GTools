import {Buffer} from 'buffer';
import picomatch from 'picomatch/posix.js';

const escapes = {a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92};

function unquotePattern(quoted) {
    const chunks = [];
    for (const [token] of quoted.slice(1, -1).matchAll(/[^\\]+|\\(?:[0-3][0-7]{2}|.)/gs)) {
        if (!token.startsWith('\\')) chunks.push(Buffer.from(token));
        else {
            const byte = token.length === 4 ? parseInt(token.slice(1), 8) : escapes[token[1]];
            if (byte === undefined) return '';
            chunks.push(Buffer.from([byte]));
        }
    }
    return Buffer.concat(chunks).toString('utf8');
}

function parseRules(source, ignoreCase) {
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

export function worktreeAttributes(disk, index, readBlob, ignoreCase, signal) {
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
        return parseRules(await blob.text(), ignoreCase);
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
