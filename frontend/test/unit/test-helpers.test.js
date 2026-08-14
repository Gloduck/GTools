import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
    getTestArgument,
    isTestArgumentEnabled,
    loadTestArguments,
    parseSerializedTestArguments,
    parseTestArguments,
    parseTestParametersFile,
} from '../test-helpers.js';

test('场景：测试参数支持等号、独立值和布尔开关', () => {
    assert.deepEqual(parseTestArguments([
        'ignored',
        '--first=one',
        '--second', 'two',
        '--enabled',
    ]), {
        first: 'one',
        second: 'two',
        enabled: 'true',
    });
});

test('场景：测试参数优先于环境变量并支持默认值', () => {
    const original = process.env.FRONTEND_TEST_ARGUMENT;
    process.env.FRONTEND_TEST_ARGUMENT = 'environment';
    try {
        const values = {name: 'argument'};
        assert.equal(getTestArgument(values, 'name', {environment: 'FRONTEND_TEST_ARGUMENT'}), 'argument');
        assert.equal(getTestArgument({}, 'name', {environment: 'FRONTEND_TEST_ARGUMENT'}), 'environment');
        assert.equal(getTestArgument({}, 'missing', {defaultValue: 'fallback'}), 'fallback');
    } finally {
        if (original === undefined) delete process.env.FRONTEND_TEST_ARGUMENT;
        else process.env.FRONTEND_TEST_ARGUMENT = original;
    }
});

test('场景：测试开关统一识别常见禁用值', () => {
    for (const value of ['0', 'false', 'no', 'off']) {
        assert.equal(isTestArgumentEnabled({feature: value}, 'feature'), false);
    }
    for (const value of ['1', 'true', 'yes', 'on']) {
        assert.equal(isTestArgumentEnabled({feature: value}, 'feature'), true);
    }
    assert.equal(isTestArgumentEnabled({}, 'feature', {defaultValue: true}), true);
});

test('场景：序列化测试参数拒绝数组和无效 JSON', () => {
    assert.deepEqual(parseSerializedTestArguments('{"name":"value"}'), {name: 'value'});
    assert.deepEqual(parseSerializedTestArguments('[]'), {});
    assert.deepEqual(parseSerializedTestArguments('{invalid'), {});
});

test('场景：测试参数文件支持 JSON 和 KEY=VALUE 格式', () => {
    assert.deepEqual(parseTestParametersFile('{"github-token":"token","enabled":true}'), {
        'github-token': 'token',
        enabled: 'true',
    });
    assert.deepEqual(parseTestParametersFile([
        '# comment',
        'github-token=token',
        'export github-repo="owner/repo"',
        "github-branch='main'",
    ].join('\n')), {
        'github-token': 'token',
        'github-repo': 'owner/repo',
        'github-branch': 'main',
    });
});

test('场景：命令行参数覆盖指定文件中的测试参数', () => {
    const directory = mkdtempSync(join(tmpdir(), 'frontend-test-arguments-'));
    try {
        writeFileSync(join(directory, 'parameters.env'), [
            'github-token=file-token',
            'GITHUB_TEST_REPO=owner/repo',
        ].join('\n'));
        const values = loadTestArguments([
            '--test-parameters-file=parameters.env',
            '--github-token=argument-token',
        ], {cwd: directory});
        assert.equal(getTestArgument(values, 'github-token'), 'argument-token');
        assert.equal(getTestArgument(values, 'github-repo', {environment: 'GITHUB_TEST_REPO'}), 'owner/repo');
    } finally {
        rmSync(directory, {recursive: true, force: true});
    }
});
