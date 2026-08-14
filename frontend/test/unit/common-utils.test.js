import assert from 'node:assert/strict';
import test from 'node:test';

import {CommonUtils} from '../../src/shared/common-utils.js';

test('场景：时间使用固定数字格式且不依赖语言环境', () => {
    const time = new Date(2026, 7, 14, 9, 5, 7);

    assert.equal(CommonUtils.formatTime(time), '2026-08-14 09:05:07');
    assert.equal(CommonUtils.formatTime('invalid'), '');
    assert.equal(CommonUtils.formatTime(null), '');
});

test('场景：JSON 响应保持后端原始消息', async () => {
    const result = await CommonUtils.checkJsonResponseStatus(new Response(JSON.stringify({
        code: 417,
        msg: 'INVALID_PARAMETER'
    }), {
        status: 200,
        headers: {'Content-Type': 'application/json'}
    }));

    assert.deepEqual(result, {code: 417, msg: 'INVALID_PARAMETER'});
});

test('场景：HTTP JSON 错误保留状态和后端错误码', async () => {
    const body = JSON.stringify({msg: 'INVALID_PARAMETER'});
    const response = new Response(body, {
        status: 400,
        statusText: 'Bad Request',
        headers: {'Content-Type': 'application/json'}
    });

    await assert.rejects(
        CommonUtils.checkJsonResponseStatus(response),
        (error) => {
            assert.equal(error.name, 'HttpResponseError');
            assert.equal(error.message, 'INVALID_PARAMETER');
            assert.equal(error.code, 'INVALID_PARAMETER');
            assert.equal(error.status, 400);
            assert.equal(error.statusText, 'Bad Request');
            assert.equal(error.body, body);
            return true;
        }
    );
});

test('场景：HTTP 文本错误保持原始内容', async () => {
    const response = new Response('upstream unavailable', {status: 502});

    await assert.rejects(
        CommonUtils.checkJsonResponseStatus(response),
        (error) => {
            assert.equal(error.message, 'upstream unavailable');
            assert.equal(error.status, 502);
            assert.equal(error.code, undefined);
            return true;
        }
    );
});
