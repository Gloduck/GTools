import test from 'node:test';
import assert from 'node:assert/strict';
import {areMainCommandsWhitelisted, normalizeCommandWhitelist, normalizeMainCommands} from '../../src/shared/command-whitelist.js';
import {COMMAND_WHITELIST_TEMPLATES} from '../../src/shared/command-presets.js';

test('场景：本机文本和 SSH 数组采用相同的去重、分隔和匹配规则', () => {
    const text = ' pwd\r\nls,cat\nls\n';
    const stored = ['pwd', 'ls', 'cat'];
    assert.deepEqual(normalizeCommandWhitelist(text), stored);
    assert.deepEqual(normalizeMainCommands([' pwd ', 'ls', 'ls']), ['pwd', 'ls']);
    for (const whitelist of [text, stored]) {
        assert.equal(areMainCommandsWhitelisted(whitelist, ['pwd', 'cat']), true);
        assert.equal(areMainCommandsWhitelisted(whitelist, ['cat', 'rm']), false);
        assert.equal(areMainCommandsWhitelisted(whitelist, []), false);
        assert.equal(areMainCommandsWhitelisted(whitelist, ['']), false);
    }
});

test('场景：不把通配符、路径、别名或大小写推断为白名单授权', () => {
    for (const command of ['CAT', '/bin/cat', 'cat file', 'cat;rm', 'gc']) {
        assert.equal(areMainCommandsWhitelisted(['cat'], [command]), false);
    }
    assert.equal(areMainCommandsWhitelisted(['*'], ['rm']), false);
    assert.equal(areMainCommandsWhitelisted([''], ['']), false);
});

test('场景：扩充的排查模板保持完整，超过一百项也不会静默截断', () => {
    const sh = normalizeCommandWhitelist(COMMAND_WHITELIST_TEMPLATES.sh);
    assert.ok(sh.length > 100);
    for (const [shell, commands] of Object.entries({
        sh: ['journalctl', 'lsof', 'vmstat', 'dig', 'findmnt', 'system_profiler', 'log'],
        powershell: ['Get-WinEvent', 'Get-CimInstance', 'Get-NetTCPConnection', 'Test-NetConnection', 'Get-Volume'],
        cmd: ['systeminfo', 'driverquery', 'netstat', 'pathping', 'wevtutil'],
    })) {
        assert.equal(areMainCommandsWhitelisted(COMMAND_WHITELIST_TEMPLATES[shell], commands), true);
    }
});
