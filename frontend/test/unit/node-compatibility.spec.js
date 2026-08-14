import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {expect, test} from '@playwright/test';
import {openRuntimeHarness, runNodeWorker} from '../test-helpers.js';

const execFileAsync = promisify(execFile);

test.beforeEach(async ({page}) => openRuntimeHarness(page));

test('同一 CommonJS 数据处理脚本在本地 Node 和浏览器运行时结果一致', async ({page}) => {
    const code = [
        'const path = require("node:path");',
        'const querystring = require("node:querystring");',
        'const {URL} = require("node:url");',
        'const bytes = Buffer.from(input.text);',
        'module.exports = {',
        '  basename: path.basename(input.path, ".txt"),',
        '  joined: path.join("root", "nested", "..", input.path),',
        '  query: querystring.stringify({text: input.text, count: input.count}),',
        '  parsed: querystring.parse("text=hello%20world&count=2"),',
        '  host: new URL(input.url).host,',
        '  hex: bytes.toString("hex"),',
        '  base64: bytes.toString("base64"),',
        '};',
    ].join('\n');
    const input = {text: 'hello world', count: 2, path: 'report.txt', url: 'https://example.test:8443/data'};

    const nativeResult = await runNativeCommonJs(code, {input});
    const browserResult = await runNodeWorker(page, {format: 'commonjs', code, input});
    expect(browserResult.exports).toEqual(nativeResult);
});

test('同一异步 CommonJS 脚本在本地 Node 和浏览器运行时结果一致', async ({page}) => {
    const code = [
        'const util = require("node:util");',
        'const callback = (value, done) => process.nextTick(done, null, value * 2);',
        'module.exports = Promise.all(input.values.map((value) => util.promisify(callback)(value)))',
        '  .then((values) => ({values, total: values.reduce((sum, value) => sum + value, 0)}));',
    ].join('\n');
    const input = {values: [1, 2, 3, 4]};

    const nativeResult = await runNativeCommonJs(code, {input});
    const browserResult = await runNodeWorker(page, {format: 'commonjs', code, input});
    expect(browserResult.exports).toEqual(nativeResult);
});

test('同一文件读写脚本在本地 Node 和浏览器内存文件系统结果一致', async ({page}) => {
    const code = [
        'const fs = require("node:fs");',
        'const inputText = fs.readFileSync("input.txt", "utf8");',
        'const binary = fs.readFileSync("data.bin");',
        'const output = `${inputText.toUpperCase()}:${binary.toString("hex")}`;',
        'fs.writeFileSync("output/result.txt", output);',
        'module.exports = {output, size: fs.statSync("output/result.txt").size};',
    ].join('\n');
    const directory = await mkdtemp(join(tmpdir(), 'node-compat-'));
    try {
        await writeFile(join(directory, 'input.txt'), 'hello');
        await writeFile(join(directory, 'data.bin'), new Uint8Array([1, 2, 255]));
        await mkdir(join(directory, 'output'));
        const nativeResult = await runNativeCommonJs(code, {cwd: directory});
        const nativeOutput = await readFile(join(directory, 'output/result.txt'), 'utf8');

        const browserResult = await runNodeWorker(page, {
            format: 'commonjs',
            cwd: 'workspace',
            code,
            files: [
                {path: 'workspace/input.txt', content: 'hello'},
                {path: 'workspace/data.bin', content: new Uint8Array([1, 2, 255])},
            ],
        }, ['workspace/output/result.txt']);

        expect(browserResult.exports).toEqual(nativeResult);
        expect(browserResult.outputs['workspace/output/result.txt'].text).toBe(nativeOutput);
    } finally {
        await rm(directory, {recursive: true, force: true});
    }
});

test('同一 node:crypto Hash 和 HMAC 脚本在本地 Node 与浏览器运行时结果一致', async ({page}) => {
    const code = [
        'const crypto = require("node:crypto");',
        'module.exports = {',
        '  hash: crypto.createHash("sha512").update(input.text).digest("base64"),',
        '  hmac: crypto.createHmac("sha256", input.key).update(input.text).digest("hex"),',
        '};',
    ].join('\n');
    const input = {text: 'browser crypto', key: 'secret'};

    const nativeResult = await runNativeCommonJs(code, {input});
    const browserResult = await runNodeWorker(page, {format: 'commonjs', code, input});
    expect(browserResult.exports).toEqual(nativeResult);
});

test('受支持的对称加密算法与本地 Node 产生相同密文和认证标签', async ({page}) => {
    const code = [
        'const crypto = require("node:crypto");',
        'const algorithms = [',
        '  ["aes-128-cbc", 16, 16],',
        '  ["aes-192-ctr", 24, 16],',
        '  ["aes-256-cfb", 32, 16],',
        '  ["aes-128-ecb", 16, 0],',
        '  ["aes-256-gcm", 32, 12],',
        '  ["chacha20-poly1305", 32, 12],',
        '];',
        'module.exports = Object.fromEntries(algorithms.map(([algorithm, keyLength, ivLength]) => {',
        '  const key = Buffer.alloc(keyLength, 0x11);',
        '  const iv = ivLength ? Buffer.alloc(ivLength, 0x22) : null;',
        '  const cipher = crypto.createCipheriv(algorithm, key, iv);',
        '  if (algorithm.endsWith("gcm") || algorithm === "chacha20-poly1305") {',
        '    cipher.setAAD(Buffer.from("authenticated"));',
        '  }',
        '  const encrypted = Buffer.concat([cipher.update("algorithm parity"), cipher.final()]);',
        '  const tag = algorithm.endsWith("gcm") || algorithm === "chacha20-poly1305" ? cipher.getAuthTag().toString("hex") : "";',
        '  return [algorithm, {encrypted: encrypted.toString("hex"), tag}];',
        '}));',
    ].join('\n');

    const nativeResult = await runNativeCommonJs(code);
    const browserResult = await runNodeWorker(page, {format: 'commonjs', code});
    expect(browserResult.exports).toEqual(nativeResult);
});

async function runNativeCommonJs(code, {input = null, cwd} = {}) {
    const directory = cwd || await mkdtemp(join(tmpdir(), 'native-script-'));
    const temporaryDirectory = !cwd;
    const scriptPath = join(directory, 'runtime-script.cjs');
    await writeFile(scriptPath, [
        `const input = ${JSON.stringify(input)};`,
        code,
        'Promise.resolve(module.exports).then((value) => process.stdout.write(JSON.stringify(value)));',
    ].join('\n'));
    try {
        const {stdout} = await execFileAsync(process.execPath, [scriptPath], {cwd: directory});
        return JSON.parse(stdout);
    } finally {
        if (temporaryDirectory) await rm(directory, {recursive: true, force: true});
        else await rm(scriptPath, {force: true});
    }
}
