import test from 'node:test';
import assert from 'node:assert/strict';
import {areMainCommandsWhitelisted, getCommandApprovalReason, normalizeCommandWhitelist, normalizeMainCommands} from '../../src/shared/command-whitelist.js';
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

test('场景：执行器和 SSH 共用审批判断，关闭免审批后恢复风险、白名单和未保存文件确认', () => {
    for (const whitelist of ['pwd\ncat', ['pwd', 'cat']]) {
        const allowed = {whitelist, mainCommands: ['pwd', 'cat']};
        assert.equal(getCommandApprovalReason(allowed), null);
        assert.equal(getCommandApprovalReason({...allowed, highRisk: true}), 'high-risk');
        assert.equal(getCommandApprovalReason({...allowed, mainCommands: ['pwd', 'rm']}), 'not-whitelisted');
        assert.equal(getCommandApprovalReason({...allowed, hasUnsavedFiles: true}), 'unsaved-files');
        const needsApproval = {...allowed, mainCommands: ['rm'], highRisk: true, hasUnsavedFiles: true};
        assert.equal(getCommandApprovalReason({...needsApproval, autoApprove: true}), null);
        assert.equal(getCommandApprovalReason({...needsApproval, autoApprove: false}), 'high-risk');
    }
});

test('场景：免审批必须明确开启，字符串和数字不能被当作授权', () => {
    for (const autoApprove of [undefined, null, false, 'false', 'true', 1]) {
        assert.equal(getCommandApprovalReason({autoApprove, whitelist: [], mainCommands: ['printf']}), 'not-whitelisted');
    }
});
