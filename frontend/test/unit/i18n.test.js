import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {i18n, setLocale, translateErrorMessage} from '../../src/i18n/index.js';

function flattenKeys(value, prefix = '', result = []) {
    for (const [key, item] of Object.entries(value || {})) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (item && typeof item === 'object' && !Array.isArray(item)) flattenKeys(item, path, result);
        else result.push(path);
    }
    return result.sort();
}

test('场景：中英文翻译键保持一致', () => {
    const chineseKeys = flattenKeys(i18n.global.getLocaleMessage('zh-CN'));
    const englishKeys = flattenKeys(i18n.global.getLocaleMessage('en-US'));
    assert.deepEqual(englishKeys, chineseKeys);
});

test('场景：后端错误枚举均可翻译', async () => {
    const apiErrorPath = fileURLToPath(new URL('../../../backend/src/main/java/cn/gloduck/api/exceptions/ApiError.java', import.meta.url));
    const source = await readFile(apiErrorPath, 'utf8');
    const body = source.match(/enum\s+ApiError\s*\{([\s\S]*?)\}/)?.[1] || '';
    const errors = body.match(/\b[A-Z][A-Z0-9_]+\b/g) || [];

    for (const locale of ['zh-CN', 'en-US']) {
        setLocale(locale);
        for (const error of errors) {
            assert.notEqual(translateErrorMessage(error), i18n.global.t('common.error.requestFailed'), `${locale}: ${error}`);
        }
    }
});

test('场景：结构化请求错误在展示层翻译', () => {
    setLocale('zh-CN');

    const codedError = Object.assign(new Error('fallback message'), {code: 'INVALID_PARAMETER'});
    assert.equal(translateErrorMessage(codedError), i18n.global.t('errors.INVALID_PARAMETER'));

    const httpError = Object.assign(new Error(''), {status: 503});
    assert.equal(
        translateErrorMessage(httpError),
        i18n.global.t('common.error.httpError', {status: 503})
    );
});
