import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLocalStartupCommand, LocalExecutorClient, normalizeLocalCommand, normalizeLocalExecutorSettings, normalizeExecutorToken, buildLocalConnectionDraft, parseLocalConnection} from '../../src/shared/local-executor/client.js';

const connection = {url: 'http://127.0.0.1:32100', token: 'a'.repeat(43)};

test('场景：执行器设置兼容旧白名单，保存自定义凭据和网络配置但不导入会话或任务', () => {
    const defaults = {token: '', whitelist: [], listenAddress: '127.0.0.1', port: 0, autoApprove: false};
    for (const value of [undefined, null, [], '旧数据']) assert.deepEqual(normalizeLocalExecutorSettings(value), defaults);
    assert.deepEqual(normalizeLocalExecutorSettings({whitelist: ['pwd', 'pwd']}), {...defaults, whitelist: ['pwd']});
    assert.deepEqual(normalizeLocalExecutorSettings({
        whitelist: 'pwd\ncat\npwd', listenAddress: ' 192.168.1.25 ', port: 8321, autoApprove: true,
        ...connection, connected: true, shell: 'cmd', bindWorkspace: true, tasks: [{id: '不应导入'}],
    }), {token: connection.token, whitelist: ['pwd', 'cat'], listenAddress: '192.168.1.25', port: 8321, autoApprove: true});
    assert.deepEqual(normalizeLocalExecutorSettings({listenAddress: '0:0:0:0:0:0:0:1', port: 65535}), {...defaults, listenAddress: '::1', port: 65535});
});

test('场景：非法网络配置回退到默认值，免审批仅接受明确的布尔值', () => {
    for (const listenAddress of ['', null, 123, '0.0.0.0', '::', '0:0:0:0:0:0:0:0', '999.1.1.1', 'localhost', '127.0.0.1;id']) {
        assert.equal(normalizeLocalExecutorSettings({listenAddress}).listenAddress, '127.0.0.1');
    }
    for (const port of [-1, 65536, 1.5, '8321', null, Infinity]) assert.equal(normalizeLocalExecutorSettings({port}).port, 0);
    for (const autoApprove of [undefined, null, false, 'true', 'false', 1]) assert.equal(normalizeLocalExecutorSettings({autoApprove}).autoApprove, false);
    assert.equal(normalizeLocalExecutorSettings({port: 0, autoApprove: true}).autoApprove, true);
});

test('场景：允许用户配置本机、局域网和远程入口，但拒绝地址内的凭据或路径', () => {
    assert.deepEqual(parseLocalConnection(JSON.stringify(connection)), connection);
    for (const url of ['https://executor.example', 'http://localhost:32100', 'http://192.168.1.2:32100', 'http://[::1]:32100', 'https://[2001:db8::1]:443']) {
        assert.equal(parseLocalConnection({...connection, url}).url, new URL(url).origin);
    }
    for (const url of ['file:///etc/passwd', 'ftp://executor.example', '//executor.example', 'http://127.0.0.1:32100/other', 'http://user@127.0.0.1:32100', 'http://127.0.0.1:32100/#token', 'http://0.0.0.0:32100', 'http://[::]:32100', 'http://localhost:0']) {
        assert.throws(() => parseLocalConnection({...connection, url}));
    }
    assert.equal(parseLocalConnection({...connection, token: 'a'}).token, 'a');
});

test('场景：不限制命令种类，但校验参数类型、长度和不可变性', () => {
    const args = normalizeLocalCommand({command: 'cat ../other/file | grep value > /tmp/result', reason: 'Inspect another project', commands: ['cat', 'grep'], high_risk: false});
    assert.equal('timeout_seconds' in args, false);
    assert.ok(Object.isFrozen(args));
    for (const patch of [{command: ''}, {command: 'a\0b'}, {command: 123}, {cwd: {}}, {reason: ''}]) {
        assert.throws(() => normalizeLocalCommand({command: 'pwd', reason: 'test', commands: ['pwd'], high_risk: false, ...patch}));
    }
});

test('场景：启动命令正确引用前端部署路径且不修改执行策略', () => {
    const sh = buildLocalStartupCommand({platform: 'unix', assetBase: 'https://tools.example/sub/local-executor/v1/', origin: 'https://tools.example'});
    assert.match(sh, /\/sub\/local-executor\/v1\/bootstrap.sh/);
    assert.doesNotMatch(sh, /sandbox/);
    const ps = buildLocalStartupCommand({platform: 'windows', assetBase: 'https://tools.example/local-executor/v1/', origin: 'https://tools.example'});
    assert.doesNotMatch(ps, /Sandbox/);
    assert.doesNotMatch(ps, /ExecutionPolicy|Set-ExecutionPolicy/);
    assert.throws(() => buildLocalStartupCommand({platform: 'unix', assetBase: 'http://public.example/scripts', origin: 'http://public.example'}));
});

test('场景：自定义 token 校验、明文设置往返与部分连接信息回填', () => {
    const saved = normalizeLocalExecutorSettings({listenAddress: '::1', port: 8321, token: connection.token});
    assert.deepEqual(normalizeLocalExecutorSettings(JSON.parse(JSON.stringify(saved))), saved);
    assert.deepEqual(JSON.parse(buildLocalConnectionDraft(saved)), {url: 'http://[::1]:8321', token: connection.token});
    assert.deepEqual(JSON.parse(buildLocalConnectionDraft({token: connection.token})), {url: '', token: connection.token});
    assert.deepEqual(JSON.parse(buildLocalConnectionDraft({port: 8321})), {url: 'http://127.0.0.1:8321', token: ''});
    assert.equal(buildLocalConnectionDraft({}), '');
    assert.equal(normalizeExecutorToken(''), '');
    for (const token of ['a', 'short', 'a'.repeat(256)]) assert.equal(normalizeExecutorToken(token), token);
    for (const token of [null, 1, 'a'.repeat(32) + '\n', 'a'.repeat(32) + "'", '中'.repeat(32)]) {
        assert.throws(() => normalizeExecutorToken(token));
        assert.equal(normalizeLocalExecutorSettings({token}).token, '');
    }
});

test('场景：所有平台启动命令传入自定义 token，留空保持随机生成', () => {
    const args = {assetBase: 'https://tools.example/local-executor/v1', origin: 'https://tools.example', token: '-a'};
    for (const platform of ['unix', 'windows', 'android']) {
        assert.ok(buildLocalStartupCommand({...args, platform}).includes(args.token));
        assert.throws(() => buildLocalStartupCommand({...args, platform, token: 'bad token'}));
        assert.doesNotMatch(buildLocalStartupCommand({...args, platform, token: ''}), /-Token/);
    }
    assert.ok(buildLocalStartupCommand({...args, platform: 'android'}).endsWith(`'127.0.0.1' 0 '' '${args.token}'`));
    assert.ok(buildLocalStartupCommand({...args, platform: 'windows'}).endsWith(`-Token '${args.token}'`));
    const cmd = buildLocalStartupCommand({...args, platform: 'windows', terminal: 'cmd'});
    assert.equal(Buffer.from(cmd.split(' ').at(-1), 'base64').toString('utf16le'), buildLocalStartupCommand({...args, platform: 'windows'}));
});

test('场景：凭据仅放请求头，禁止重定向并原样传递输出游标', async () => {
    let request;
    const client = new LocalExecutorClient(connection, {fetchImpl: async (url, options) => {
        request = {url, options};
        return {ok: true, json: async () => ({id: 'task-12345', cursor: 12})};
    }});
    await client.read('task-12345', 8);
    assert.equal(request.url, 'http://127.0.0.1:32100/v1/tasks/task-12345?cursor=8&max_chars=5000');
    assert.equal(request.options.headers.Authorization, `Bearer ${connection.token}`);
    assert.equal(request.options.redirect, 'error');
    assert.equal(request.options.credentials, 'omit');
    assert.equal(JSON.stringify(client), '{}');
    assert.throws(() => client.read('../info', 0));
});

test('场景：连接握手拒绝不兼容的协议', async () => {
    const client = new LocalExecutorClient(connection, {fetchImpl: async () => ({ok: true, json: async () => ({protocol_version: 5})})});
    await assert.rejects(client.info(), /Unsupported/);
});

test('场景：Android 使用独立 DEX 启动入口并兼容现有协议', async () => {
    const command = buildLocalStartupCommand({platform: 'android', assetBase: 'https://tools.example/sub/local-executor/v1/', origin: 'https://tools.example', listenAddress: '192.168.1.25', port: 8321});
    assert.match(command, /\/sub\/local-executor\/v1\/bootstrap-android.sh/);
    assert.match(command, /^curl -fsSL /);
    assert.doesNotMatch(command, /command -v|then|else/);
    assert.match(command, /'192\.168\.1\.25' 8321/);
    assert.doesNotMatch(command, /\bsu\b|python|powershell/);
    const info = {protocol_version: 1, runtime: 'android', platform: 'android', shell: 'sh', shells: ['sh'], default_cwd: '/data/local/tmp'};
    const client = new LocalExecutorClient(connection, {fetchImpl: async () => ({ok: true, json: async () => info})});
    assert.deepEqual(await client.info(), info);
});

test('场景：Android 启动省略默认参数，自定义配置仍按正确位置传递', () => {
    const args = {platform: 'android', assetBase: 'https://tools.example/local-executor/v1', origin: 'https://tools.example'};
    assert.equal(buildLocalStartupCommand(args), "curl -fsSL 'https://tools.example/local-executor/v1/bootstrap-android.sh' | sh -s -- 'https://tools.example/local-executor/v1' 'https://tools.example'");
    assert.ok(buildLocalStartupCommand({...args, listenAddress: '192.168.1.25'}).endsWith("'192.168.1.25'"));
    assert.ok(buildLocalStartupCommand({...args, port: 8321}).endsWith("'127.0.0.1' 8321"));
    assert.ok(buildLocalStartupCommand({...args, listenAddress: '0.0.0.0', publicUrl: 'http://192.168.1.25:8321'}).endsWith("'0.0.0.0' 0 'http://192.168.1.25:8321'"));
});

test('场景：CMD 启动入口解码后与 PowerShell 相同，下载脚本使用原始 UTF-8 字节', () => {
    const args = {platform: 'windows', assetBase: "https://tools.example/path's%20test/local-executor/v1", origin: 'https://tools.example'};
    const powershell = buildLocalStartupCommand(args);
    const cmd = buildLocalStartupCommand({...args, terminal: 'cmd'});
    assert.match(cmd, /^powershell.exe -NoLogo -NoProfile -EncodedCommand [A-Za-z0-9+/=]+$/);
    assert.equal(Buffer.from(cmd.split(' ').at(-1), 'base64').toString('utf16le'), powershell);
    assert.match(powershell, /UTF8.GetString\(.+RawContentStream.ToArray\(\)/);
    assert.doesNotMatch(powershell, /\)\.Content/);
});

test('场景：真实 PowerShell 执行网页生成的命令，二进制响应和中文不会变成数字列表', {skip: !process.env.EXECUTOR_TEST_POWERSHELL}, async () => {
    const {spawnSync} = await import('node:child_process');
    const command = buildLocalStartupCommand({platform: 'windows', assetBase: 'https://tools.example/local-executor/v1', origin: 'https://tools.example'});
    const fixture = `
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
function Invoke-WebRequest {
    param([switch]$UseBasicParsing, $Uri)
    $source='param($BaseUrl,$Origin); if ($Origin -ne "https://tools.example") { throw "参数错误" }; "中文启动成功"'
    $bytes=[Text.Encoding]::UTF8.GetBytes($source)
    [pscustomobject]@{Content=$bytes; RawContentStream=[IO.MemoryStream]::new($bytes)}
}
${command}
`;
    const result = spawnSync(process.env.EXECUTOR_TEST_POWERSHELL, ['-NoProfile', '-EncodedCommand', Buffer.from(fixture, 'utf16le').toString('base64')], {encoding: 'utf8', timeout: 30000});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /中文启动成功/);
});

test('场景：等待参数默认十秒，允许立即返回和较长等待，不接受非法类型', () => {
    const command = {command: 'pwd', reason: '检查目录', commands: ['pwd'], high_risk: false};
    assert.equal(normalizeLocalCommand(command).wait_seconds, 10);
    assert.equal(normalizeLocalCommand({...command, wait_seconds: 0}).wait_seconds, 0);
    assert.equal(normalizeLocalCommand({...command, wait_seconds: 86400}).wait_seconds, 86400);
    for (const wait_seconds of [-1, 0.5, '10', null, Infinity, {}, true]) {
        assert.throws(() => normalizeLocalCommand({...command, wait_seconds}), /wait_seconds/);
    }
});

test('场景：本机命令要求与 SSH 一致的主命令列表和风险标记，审批参数不可修改', () => {
    const input = {command: 'cat input | sort', reason: '整理内容', commands: ['cat', 'sort'], high_risk: false};
    const args = normalizeLocalCommand(input);
    input.commands.push('rm');
    assert.deepEqual(args.commands, ['cat', 'sort']);
    assert.ok(Object.isFrozen(args.commands));
    for (const patch of [{commands: []}, {commands: ['cat file']}, {commands: [123]}, {commands: null}, {high_risk: 'false'}, {high_risk: undefined}]) {
        assert.throws(() => normalizeLocalCommand({...input, ...patch}));
    }
});

test('场景：启动命令传递监听 IP、端口和 HTTPS 访问入口，不接受命令注入参数', () => {
    const common = {assetBase: 'https://tools.example/local-executor/v1', origin: 'https://tools.example', listenAddress: '192.168.1.10', port: 8321, publicUrl: 'https://executor.example'};
    const ps = buildLocalStartupCommand({...common, platform: 'windows'});
    assert.match(ps, /-ListenAddress '192\.168\.1\.10' -Port 8321 -PublicUrl 'https:\/\/executor\.example'/);
    const sh = buildLocalStartupCommand({...common, platform: 'unix'});
    assert.match(sh, /'192\.168\.1\.10' 8321 'https:\/\/executor\.example'$/);
    for (const patch of [{listenAddress: '127.0.0.1;id'}, {listenAddress: 'localhost'}, {listenAddress: '999.1.1.1'}, {port: -1}, {port: '80'}, {port: 1.2}, {port: 65536}, {publicUrl: 'https://host/path'}]) {
        assert.throws(() => buildLocalStartupCommand({...common, platform: 'unix', ...patch}));
    }
    assert.throws(() => buildLocalStartupCommand({...common, listenAddress: '0.0.0.0', publicUrl: ''}));
    assert.match(buildLocalStartupCommand({...common, platform: 'unix', listenAddress: '::1'}), /'::1'/);
});
