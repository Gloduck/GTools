import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const DISABLED_VALUES = new Set(['0', 'false', 'no', 'off']);

function parseTestArguments(values = process.argv.slice(2)) {
    const result = {};
    for (let index = 0; index < values.length; index += 1) {
        const value = String(values[index] || '');
        if (!value.startsWith('--')) continue;
        const separator = value.indexOf('=');
        if (separator !== -1) {
            result[value.slice(2, separator)] = value.slice(separator + 1).trim();
            continue;
        }
        const next = values[index + 1];
        if (next !== undefined && !String(next).startsWith('--')) {
            result[value.slice(2)] = String(next).trim();
            index += 1;
        } else {
            result[value.slice(2)] = 'true';
        }
    }
    return result;
}

function parseSerializedTestArguments(value) {
    try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function loadTestArguments(values = process.argv.slice(2), {cwd = process.cwd()} = {}) {
    const commandLine = parseTestArguments(values);
    const filePath = commandLine['test-parameters-file'] || commandLine['test-params-file'];
    if (!filePath) return commandLine;
    const fromFile = parseTestParametersFile(readFileSync(resolve(cwd, filePath), 'utf8'));
    return {...fromFile, ...commandLine};
}

function parseTestParametersFile(source) {
    const text = String(source || '').trim();
    if (!text) return {};
    if (text.startsWith('{')) {
        const value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Test parameters JSON must be an object');
        return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, String(item ?? '').trim()]));
    }
    const result = {};
    for (const line of text.split(/\r?\n/)) {
        const value = line.trim().replace(/^export\s+/, '');
        if (!value || value.startsWith('#')) continue;
        const separator = value.indexOf('=');
        if (separator === -1) throw new SyntaxError(`Invalid test parameter line: ${line}`);
        const name = value.slice(0, separator).trim();
        if (!name) throw new SyntaxError(`Invalid test parameter line: ${line}`);
        result[name] = unquote(value.slice(separator + 1).trim());
    }
    return result;
}

function getTestArgument(testArguments, name, {environment = '', defaultValue = ''} = {}) {
    if (Object.prototype.hasOwnProperty.call(testArguments, name)) return String(testArguments[name] ?? '').trim();
    if (environment && Object.prototype.hasOwnProperty.call(testArguments, environment)) {
        return String(testArguments[environment] ?? '').trim();
    }
    if (environment && process.env[environment] !== undefined) return String(process.env[environment]).trim();
    return defaultValue;
}

function isTestArgumentEnabled(testArguments, name, {environment = '', defaultValue = false} = {}) {
    const value = getTestArgument(testArguments, name, {environment});
    return value === '' ? defaultValue : !DISABLED_VALUES.has(value.toLowerCase());
}

function getBrowserTestArgument(name, fallback = '') {
    const testArguments = parseSerializedTestArguments(process.env.GTOOLS_TEST_ARGUMENTS);
    return getTestArgument(testArguments, String(name), {defaultValue: fallback});
}

async function openRuntimeHarness(page) {
    await page.goto('/test/runtime-harness.html');
    await page.locator('html[data-runtime-ready="true"]').waitFor();
}

async function runNodeWorker(page, options, outputPaths = []) {
    return page.evaluate(async ({options: workerOptions, outputPaths: paths}) => {
        const worker = new globalThis.runtimeHarness.NodeWorker(workerOptions);
        const result = await worker.run();
        const outputs = {};
        for (const path of paths) {
            const blob = await worker.fileSystem.readBlob(path);
            outputs[path] = {
                type: blob.type,
                size: blob.size,
                text: await blob.text(),
                bytes: Array.from(new Uint8Array(await blob.arrayBuffer())),
            };
        }
        return {
            exports: serializeRuntimeValue(result.exports),
            exitCode: result.exitCode,
            outputs,
        };

        function serializeRuntimeValue(value, seen = new WeakSet()) {
            if (value === undefined) return {type: 'undefined'};
            if (typeof value === 'bigint') return {type: 'bigint', value: String(value)};
            if (typeof value === 'function') return {type: 'function', name: value.name || ''};
            if (value === null || typeof value !== 'object') return value;
            if (ArrayBuffer.isView(value)) return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
            if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
            if (seen.has(value)) return {type: 'circular'};
            seen.add(value);
            const result = Array.isArray(value)
                ? value.map((item) => serializeRuntimeValue(item, seen))
                : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeRuntimeValue(item, seen)]));
            seen.delete(value);
            return result;
        }
    }, {options, outputPaths});
}

function unquote(value) {
    const quote = value[0];
    return value.length >= 2 && (quote === '"' || quote === "'") && value.at(-1) === quote
        ? value.slice(1, -1)
        : value;
}

export {
    getBrowserTestArgument,
    getTestArgument,
    isTestArgumentEnabled,
    loadTestArguments,
    openRuntimeHarness,
    parseSerializedTestArguments,
    parseTestArguments,
    parseTestParametersFile,
    runNodeWorker,
};
