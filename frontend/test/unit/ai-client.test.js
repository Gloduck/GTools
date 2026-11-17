import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiClient, getResponseText} from '../../src/shared/ai/client.js';
import {reviewAiCommand} from '../../src/shared/ai-command-review.js';

const message = (text) => ({type: 'message', id: 'msg-1', role: 'assistant', content: [{type: 'output_text', text}]});
const json = (body) => new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}});
const createClient = (fetch) => createAiClient({protocol: 'openai', connection: {baseUrl: 'https://example.test/v1', apiKey: 'test-key'}, fetch});
const request = {model: 'test-model', input: [{role: 'user', content: [{type: 'text', text: '解释结果'}]}]};

test('未知协议明确拒绝，不能静默选择 OpenAI', () => {
    assert.throws(() => createAiClient({protocol: 'unknown', connection: {}}), /unknown|unsupported|不支持/i);
});

test('中立输入转换为 OpenAI 文本和图片，结果转换为文字、拒绝和工具调用', async () => {
    let sent;
    const client = createClient(async (url, options) => {
        sent = {url, body: JSON.parse(options.body)};
        return json({status: 'completed', output: [
            {...message('说明'), content: [{type: 'output_text', text: '说明'}, {type: 'refusal', refusal: '不能执行'}]},
            {type: 'function_call', call_id: 'call-1', name: 'read_file', arguments: '{"path":"a.txt"}'},
        ], usage: {input_tokens: 12, output_tokens: 4, total_tokens: 16, input_tokens_details: {cached_tokens: 3}}});
    });
    const result = await client.respond({...request, input: [{role: 'user', content: [
        {type: 'text', text: '描述图片'}, {type: 'image', url: 'data:image/png;base64,YQ==', detail: 'low'},
    ]}]});
    assert.equal(sent.url, 'https://example.test/v1/responses');
    assert.deepEqual(sent.body.input[0].content, [
        {type: 'input_text', text: '描述图片'}, {type: 'input_image', image_url: 'data:image/png;base64,YQ==', detail: 'low'},
    ]);
    assert.equal(getResponseText(result), '说明\n不能执行');
    assert.deepEqual(result.output.find((item) => item.type === 'tool_call'), {type: 'tool_call', id: 'call-1', name: 'read_file', arguments: {path: 'a.txt'}});
    assert.deepEqual(result.usage, {inputTokens: 12, outputTokens: 4, totalTokens: 16, cachedInputTokens: 3});
});

test('续轮通过 opaque continuation 保留推理和所有调用，并传入每个完整工具结果', async () => {
    const bodies = [];
    const reasoning = {type: 'reasoning', id: 'reason-1', encrypted_content: 'opaque-reasoning', summary: []};
    const calls = ['a', 'b'].map((id) => ({type: 'function_call', id: `item-${id}`, call_id: id, name: 'read_file', arguments: JSON.stringify({path: `${id}.txt`})}));
    const client = createClient(async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        return json({status: 'completed', output: bodies.length === 1 ? [reasoning, ...calls] : [message('已完成')]});
    });
    const first = await client.respond(request);
    const results = [{type: 'tool_result', callId: 'a', output: {ok: true, content: '全文甲'}}, {type: 'tool_result', callId: 'b', output: {ok: false, error: '读取失败'}}];
    const second = await client.respond({model: request.model, continuation: first.continuation, input: results});
    assert.equal(getResponseText(second), '已完成');
    const input = bodies[1].input;
    assert.deepEqual(input[0], bodies[0].input[0]);
    assert.deepEqual(input.find((item) => item.type === 'reasoning'), reasoning);
    for (const call of calls) assert.deepEqual(input.filter((item) => item.call_id === call.call_id && item.type === 'function_call'), [call]);
    assert.deepEqual(input.filter((item) => item.type === 'function_call_output').map((item) => ({callId: item.call_id, output: JSON.parse(item.output)})), results.map(({callId, output}) => ({callId, output})));
});

test('流式快照在完成前可见，任意 UTF-8 分片、拒绝和 done 不重复', async () => {
    let controller;
    const events = [];
    const stream = new ReadableStream({start(value) { controller = value; }});
    const client = createClient(async () => new Response(stream, {headers: {'content-type': 'text/event-stream'}}));
    const pending = client.respond({...request, onEvent: (event) => events.push(event)});
    const emit = (value) => {
        // 单字节切分覆盖中文与 emoji 编码以及 CRLF 边界。
        const bytes = new TextEncoder().encode(`event: ${value.type}\r\ndata: ${JSON.stringify(value)}\r\n\r\n`);
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    };
    emit({type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg-1', delta: '你好🌍'});
    emit({type: 'response.refusal.delta', output_index: 0, content_index: 1, item_id: 'msg-1', delta: '拒绝'});
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(getResponseText(events.filter((event) => event.type === 'output').at(-1)), '你好🌍\n拒绝');
    const output = [{...message('你好🌍'), content: [{type: 'output_text', text: '你好🌍'}, {type: 'refusal', refusal: '拒绝'}]}];
    emit({type: 'response.output_text.done', output_index: 0, content_index: 0, item_id: 'msg-1', text: '你好🌍'});
    emit({type: 'response.completed', response: {status: 'completed', output}});
    controller.close();
    const result = await pending;
    assert.equal(getResponseText(result), '你好🌍\n拒绝');
    assert.equal(events[0].type, 'reset');
});

test('只有 completed 事件也返回结果，辅助请求不影响另一个请求的显示回调', async () => {
    const events = [];
    let count = 0;
    const client = createClient(async () => {
        count++;
        const output = [message(count === 1 ? '聊天结果' : '辅助结果')];
        return new Response(`data: ${JSON.stringify({type: 'response.completed', response: {status: 'completed', output}})}\n\ndata: [DONE]\n\n`, {headers: {'content-type': 'text/event-stream'}});
    });
    assert.equal(getResponseText(await client.respond({...request, onEvent: (event) => events.push(event)})), '聊天结果');
    const before = JSON.stringify(events);
    assert.equal(getResponseText(await client.respond(request)), '辅助结果');
    assert.equal(JSON.stringify(events), before);
});

test('响应尚未开始的 HTTP 错误可重试，之后成功显示一次结果', async () => {
    let attempts = 0;
    const events = [];
    const client = createClient(async () => {
        if (++attempts === 1) return new Response('temporarily unavailable', {status: 503, headers: {'retry-after': '0'}});
        return json({status: 'completed', output: [message('重试成功')]});
    });
    const result = await client.respond({...request, onEvent: (event) => events.push(event)});
    assert.equal(attempts, 2);
    assert.equal(getResponseText(result), '重试成功');
    assert.equal(events.filter((event) => event.type === 'reset').length, 2);
});

test('不完整响应中的工具调用不得成为可执行工具', async () => {
    const client = createClient(async () => json({status: 'incomplete', output: [
        {type: 'function_call', call_id: 'unsafe', name: 'write_file', arguments: '{"path":"a.txt"}'},
    ]}));
    try {
        const result = await client.respond(request);
        assert.equal(result.output.some((item) => item.type === 'tool_call'), false);
    } catch (error) {
        assert.match(error.message, /incomplete|不完整|未完成/i);
    }
});

test('continuation 不能跨连接或客户端误用，拒绝时不发送请求', async () => {
    let config = {baseUrl: 'https://example.test/v1', apiKey: 'key-a'};
    let requests = 0;
    const fetch = async () => { requests++; return json({output: [message('首轮')]}); };
    const client = createAiClient({protocol: 'openai', connection: () => config, fetch});
    const first = await client.respond(request);
    config = {...config, apiKey: 'key-b'};
    await assert.rejects(client.respond({...request, continuation: first.continuation}), /connection|continu/i);
    const secondClient = createAiClient({protocol: 'openai', connection: () => config, fetch});
    await assert.rejects(secondClient.respond({...request, continuation: first.continuation}), /connection|continu/i);
    assert.equal(requests, 1);
});

test('首个有效事件后网络断开禁止自动重试，并保留最后文字快照', async () => {
    let controller;
    let attempts = 0;
    const events = [];
    const client = createClient(async () => {
        attempts++;
        return new Response(new ReadableStream({start(value) { controller = value; }}), {headers: {'content-type': 'text/event-stream'}});
    });
    const pending = client.respond({...request, onEvent: (event) => events.push(event)});
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '保留进度'})}\n\n`));
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.error(new TypeError('Network connection lost'));
    await assert.rejects(pending, /Network connection lost/);
    assert.equal(attempts, 1);
    assert.equal(getResponseText(events.filter((event) => event.type === 'output').at(-1)), '保留进度');
});

test('完整工具项可从 done 恢复，只有参数增量的未完成调用不可执行', async () => {
    const completeCall = {type: 'function_call', id: 'tool-complete', call_id: 'complete', name: 'read_file', arguments: '{"path":"a.txt"}'};
    const partialCall = {type: 'function_call', id: 'tool-partial', call_id: 'partial', name: 'write_file', arguments: ''};
    const events = [
        {type: 'response.output_item.done', output_index: 0, item: completeCall},
        {type: 'response.output_item.added', output_index: 1, item: partialCall},
        {type: 'response.function_call_arguments.delta', output_index: 1, item_id: 'tool-partial', delta: '{"path":'},
        {type: 'response.completed', response: {status: 'completed', output: []}},
    ];
    const client = createClient(async () => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}}));
    const output = (await client.respond(request)).output;
    assert.deepEqual(output.filter((item) => item.type === 'tool_call'), [{type: 'tool_call', id: 'complete', name: 'read_file', arguments: {path: 'a.txt'}}]);
});


test('审批结果混有未完成工具调用时不能被过滤成有效批准', async () => {
    const client = createClient(async () => json({status: 'completed', output: [
        message(JSON.stringify({decision: 'approve', reason: '允许执行'})),
        {type: 'function_call', status: 'incomplete', call_id: 'incomplete', name: 'execute_command', arguments: '{}'},
    ]}));
    await assert.rejects(reviewAiCommand({model: 'review-model', action: {command: 'pwd'}, request: client.respond}), {code: 'COMMAND_REVIEW_INVALID'});
});

test('原生搜索缺少完成状态时不能被标记为成功', async () => {
    const client = createClient(async () => json({status: 'completed', output: [{type: 'web_search_call', id: 'search-unknown', action: {type: 'search', queries: ['Vue']}}]}));
    const result = await client.respond(request);
    assert.notEqual(result.output.find((item) => item.type === 'web_search')?.status, 'completed');
    assert.equal(result.output.find((item) => item.type === 'web_search').error, null);
    for (const [error, expected] of [['搜索失败', '搜索失败'], [{message: '限额不足'}, '限额不足'], [{code: 'SEARCH_FAILED'}, JSON.stringify({code: 'SEARCH_FAILED'})]]) {
        const failedClient = createClient(async () => json({status: 'completed', output: [
            {type: 'web_search_call', id: 'search-error', status: 'failed', action: {type: 'search'}, error},
        ]}));
        const failed = await failedClient.respond(request);
        assert.equal(failed.output.find((item) => item.type === 'web_search').error, expected);
    }
});

test('完成事件即可结束请求，终态 output_text 覆盖临时文字且无需等待连接关闭', async () => {
    let canceled = false;
    const events = [];
    const client = createClient(async () => new Response(new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode([
                {type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '临时文字'},
                {type: 'response.completed', response: {status: 'completed', output_text: '最终文字'}},
            ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')));
            // 故意保持连接，完成证据来自终态事件。
        },
        cancel() { canceled = true; },
    }), {headers: {'content-type': 'text/event-stream'}}));
    const signal = AbortSignal.timeout(500);
    const result = await client.respond({...request, signal, onEvent: (event) => events.push(event)});
    assert.equal(getResponseText(result), '最终文字');
    assert.equal(getResponseText(events.filter((event) => event.type === 'output').at(-1)), '最终文字');
    assert.equal(canceled, true);
});

test('工具调用参数必须是完整 JSON 对象，缺失或空参数不能默认为空对象执行', async () => {
    for (const argumentsValue of [undefined, '', '{', 'null', '[]']) {
        const client = createClient(async () => json({status: 'completed', output: [
            {type: 'function_call', call_id: 'invalid', name: 'execute_command', arguments: argumentsValue},
        ]}));
        await assert.rejects(client.respond(request), /arguments|参数/i);
    }
});

test('临时文字与完整工具混合时，续接使用合法完整助手输入并保留调用结果关联', async () => {
    const bodies = [];
    const call = {type: 'function_call', id: 'tool-1', call_id: 'call-1', name: 'read_file', arguments: '{"path":"a.txt"}'};
    const events = [
        {type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'message-1', delta: '临时'},
        {type: 'response.output_item.done', output_index: 1, item: call},
        {type: 'response.output_item.done', output_index: 2, item: {type: 'web_search_call', id: 'search-1', status: 'failed', action: {type: 'search', queries: ['Vue']}, error: {message: '服务端扩展错误'}}},
        {type: 'response.completed', response: {status: 'completed', output_text: '完整解释'}},
    ];
    const client = createClient(async (_url, options) => {
        bodies.push(JSON.parse(options.body));
        return bodies.length === 1
            ? new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''), {headers: {'content-type': 'text/event-stream'}})
            : json({output: [message('完成')]});
    });
    const first = await client.respond(request);
    assert.equal(getResponseText(first), '完整解释');
    await client.respond({model: request.model, continuation: first.continuation, input: [{type: 'tool_result', callId: 'call-1', output: {ok: true, content: '文件全文'}}]});
    const input = bodies[1].input;
    assert.deepEqual(input.filter((item) => item.role === 'assistant'), [{role: 'assistant', content: '完整解释'}]);
    assert.deepEqual(input.filter((item) => item.type === 'function_call'), [call]);
    assert.deepEqual(JSON.parse(input.find((item) => item.type === 'function_call_output' && item.call_id === 'call-1').output), {ok: true, content: '文件全文'});
    assert.equal(input.find((item) => item.type === 'web_search_call').error, undefined);
});
