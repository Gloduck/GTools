import {expect, test} from '@playwright/test';

test('文字和 refusal 在流结束前显示，跨 UTF-8 与事件分片且完成后不重复', async ({page}) => {
    await openAi(page);
    await sendPrompt(page, '请逐步说明处理结果');
    await expectRequestCount(page, 1);

    const firstText = '你好🌍';
    const firstEvent = textDelta(firstText);
    const bytes = new TextEncoder().encode('event: ' + firstEvent.type + '\r\ndata: ' + JSON.stringify(firstEvent) + '\r\n\r\n');
    const split = bytes.findIndex((byte) => byte >= 0x80) + 1;

    // 分别拆开中文编码和事件结束符。
    await chunk(page, 0, [...bytes.slice(0, split)]);
    await expect(page.locator('.ai-chat-messages')).not.toContainText(firstText);
    await chunk(page, 0, [...bytes.slice(split, -1)]);
    await expect(page.locator('.ai-chat-messages')).not.toContainText(firstText);
    await chunk(page, 0, [...bytes.slice(-1)]);
    const answer = page.locator('.ai-message-assistant .ai-message-content');
    await expect(answer).toHaveText(firstText);

    const text = firstText + '，正在整理。';
    const refusal = '暂时不能执行删除。';
    await emit(page, 0, textDelta('，正在整理。'));
    await expect(answer).toHaveText(text);
    await emit(page, 0, {type: 'response.refusal.delta', item_id: 'message-1', output_index: 0, content_index: 1, delta: '暂时不能'});
    await expect(answer).toContainText('暂时不能');
    await emit(page, 0, {type: 'response.refusal.delta', item_id: 'message-1', output_index: 0, content_index: 1, delta: '执行删除。'});
    await expect(answer).toHaveText(text + '\n' + refusal, {useInnerText: true});
    await expect(page.getByRole('button', {name: '停止 AI 任务', exact: true})).toBeEnabled();
    expect((await requests(page))[0].closed).toBe(false);

    const message = assistantMessage(text);
    message.content.push({type: 'refusal', refusal});
    await emit(page, 0, {type: 'response.output_text.done', item_id: message.id, output_index: 0, content_index: 0, text});
    await emit(page, 0, {type: 'response.refusal.done', item_id: message.id, output_index: 0, content_index: 1, refusal});
    await emit(page, 0, {type: 'response.output_item.done', output_index: 0, item: message});
    await complete(page, 0, {output: [message]});

    await expectIdle(page);
    await expect(page.locator('.ai-message-assistant')).toHaveCount(1);
    await expect(answer).toHaveText(text + '\n' + refusal, {useInnerText: true});
    await expectRequestCount(page, 1);
});

test('停止保留已显示文字并结束请求，不再自动续跑', async ({page}) => {
    await openAi(page);
    await sendPrompt(page, '逐步整理资料');
    await expectRequestCount(page, 1);
    const partial = '已整理第一部分资料。';
    await emit(page, 0, textDelta(partial));
    await expect(page.locator('.ai-message-assistant').filter({hasText: partial})).toHaveCount(1);

    await page.getByRole('button', {name: '停止 AI 任务', exact: true}).click();
    await expectIdle(page);
    const recorded = await requests(page);
    expect(recorded[0].aborted).toBe(true);
    expect(recorded[0].closed).toBe(true);
    await expect(page.locator('.ai-message-assistant').filter({hasText: partial})).toHaveCount(1);
    await expect(page.locator('.ai-message-assistant').filter({hasText: partial})).toContainText(partial);

    // 结束后的迟到内容不能重新进入已停止的回答。
    expect(await page.evaluate(() => window.__aiStream.emit(0, {
        type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '不应出现的迟到内容',
    }))).toBe(false);
    await page.locator('.ai-chat-form textarea').fill('尚未发送的新要求');
    await expect(page.getByRole('button', {name: '发送', exact: true})).toBeEnabled();
    await expect(page.locator('.ai-chat-messages')).not.toContainText('不应出现的迟到内容');
    await expectRequestCount(page, 1);
});

test('停止正在等待回答的工具轮后，不执行后续工具也不自动续轮', async ({page}) => {
    await openAi(page);
    await sendPrompt(page, '先确认问题，再检查工具');
    await expectRequestCount(page, 1);
    await emit(page, 0, textDelta('先确认你的选择。'));
    const output = [assistantMessage('先确认你的选择。'),
        {type: 'function_call', call_id: 'question', name: 'ask_user', arguments: JSON.stringify({question: '选择方案', options: [{label: '方案 A'}]})},
        {type: 'function_call', call_id: 'queued', name: 'get_tool_availability', arguments: JSON.stringify({names: ['run_javascript']})},
    ];
    await complete(page, 0, {output});
    const dialog = page.getByRole('dialog', {name: 'AI 需要你的回答'});
    await expect(dialog).toBeVisible();
    await page.getByRole('button', {name: '停止 AI 任务', exact: true}).click();
    await expectIdle(page);
    await expect(dialog).toBeHidden();
    await expect(page.locator('.ai-message-assistant').filter({hasText: '先确认你的选择。'})).toHaveCount(1);
    const queued = page.locator('.ai-message-tool').filter({hasText: 'get_tool_availability'});
    await expect(queued.locator('.ai-tool-toggle')).not.toContainText('成功');
    await expectRequestCount(page, 1);
});

test('停止会话 A 不影响会话 B 的流和上下文', async ({page}) => {
    await openAi(page);
    await sendPrompt(page, '开始会话 A 的独立任务');
    await expectRequestCount(page, 1);
    await emit(page, 0, textDelta('A 的初步结论。'));
    await expect(page.locator('.ai-message-assistant').filter({hasText: 'A 的初步结论。'})).toHaveCount(1);

    await page.getByRole('button', {name: '新建会话', exact: true}).click();
    await sendPrompt(page, '开始会话 B 的独立任务');
    await expectRequestCount(page, 2);
    await emit(page, 1, textDelta('B 的初步结论。'));
    await expect(page.locator('.ai-message-assistant')).toContainText('B 的初步结论。');
    await expect(page.locator('.ai-chat-messages')).not.toContainText('A 的初步结论。');

    await switchSession(page, '会话 1');
    await expect(page.locator('.ai-message-assistant').filter({hasText: 'A 的初步结论。'})).toHaveCount(1);
    await emit(page, 1, textDelta('B 在后台继续完成。'));
    await expect(page.locator('.ai-chat-messages')).not.toContainText('B 在后台继续完成。');
    await page.getByRole('button', {name: '停止 AI 任务', exact: true}).click();
    await expectIdle(page);
    const recorded = await requests(page);
    expect(recorded[0].aborted).toBe(true);
    expect(recorded[1].aborted).toBe(false);
    await expect(page.locator('.ai-message-assistant').filter({hasText: 'A 的初步结论。'})).toHaveCount(1);

    await switchSession(page, '会话 2');
    await expect(page.locator('.ai-message-assistant .ai-message-content')).toHaveText('B 的初步结论。B 在后台继续完成。');
    await expect(page.getByRole('button', {name: '停止 AI 任务', exact: true})).toBeEnabled();
    await expect(page.locator('.ai-chat-messages')).not.toContainText('A 的初步结论。');
    await complete(page, 1, {output: [assistantMessage('B 的初步结论。B 在后台继续完成。')]});
    await expectIdle(page);
    expect((await requests(page))[1].aborted).toBe(false);
    await expectRequestCount(page, 2);
});

test('流已开始后断开不重试，保留已显示文字和历史消息', async ({page}) => {
    await openAi(page);
    await sendPrompt(page, '保留历史结论');
    await expectRequestCount(page, 1);
    await complete(page, 0, {output: [assistantMessage('历史结论。')]});
    await expectIdle(page);
    await sendPrompt(page, '继续分析');
    await expectRequestCount(page, 2);
    await emit(page, 1, textDelta('流断开后这段仍应保留。'));
    await expect(page.locator('.ai-message-assistant').last()).toContainText('流断开后这段仍应保留。');
    await page.evaluate(() => window.__aiStream.fail(1, 'temporarily unavailable'));
    await expectIdle(page);
    await expect(page.locator('.ai-message-assistant .ai-message-content').first()).toHaveText('历史结论。');
    await expect(page.locator('.ai-message-assistant').filter({hasText: '流断开后这段仍应保留。'})).toHaveCount(1);
    await expect(page.locator('.ai-message-user .ai-message-content')).toHaveText(['保留历史结论', '继续分析']);
    await expectRequestCount(page, 2);
});

test('频繁文字增量不逐 token 清写会话库，停止后的部分回答可恢复', async ({page}) => {
    await openAi(page, 'text/event-stream', true);
    await sendPrompt(page, '保存流式进度');
    await expectRequestCount(page, 1);
    await page.evaluate(() => {
        window.__aiSessionWrites = 0;
        for (const method of ['clear', 'put']) {
            const original = IDBObjectStore.prototype[method];
            IDBObjectStore.prototype[method] = function (...args) {
                if (this.name === 'aiSessions') window.__aiSessionWrites++;
                return original.apply(this, args);
            };
        }
    });
    for (let index = 0; index < 30; index++) await emit(page, 0, textDelta('字'));
    const partial = '字'.repeat(30);
    await expect(page.locator('.ai-message-assistant .ai-message-content')).toHaveText(partial);
    await page.getByRole('button', {name: '停止 AI 任务', exact: true}).click();
    await expectIdle(page);
    await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
        const open = indexedDB.open('browser-code-editor');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const read = db.transaction('aiSessions').objectStore('aiSessions').getAll();
            read.onsuccess = () => { db.close(); resolve(read.result.some((session) => session.messages.some((message) => message.content?.includes('字'.repeat(30))))); };
            read.onerror = () => { db.close(); reject(read.error); };
        };
    }))).toBe(true);
    expect(await page.evaluate(() => window.__aiSessionWrites)).toBeLessThan(30);
    await page.reload();
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
    await page.getByRole('button', {name: '切换会话', exact: true}).click();
    await page.locator('.ai-history-item-main').first().click();
    await expect(page.locator('.ai-message-assistant').filter({hasText: partial})).toHaveCount(1);
});

test('兼容以 application/json 返回的非流式回答', async ({page}) => {
    await openAi(page, 'application/json');
    await sendPrompt(page, '读取普通 JSON 回答');
    await expectRequestCount(page, 1);
    await chunk(page, 0, JSON.stringify({output: [assistantMessage('普通回答仍然正常显示。')]}));
    await page.evaluate(() => window.__aiStream.end(0));

    await expectIdle(page);
    await expect(page.locator('.ai-message-assistant')).toHaveCount(1);
    await expect(page.locator('.ai-message-assistant .ai-message-content')).toHaveText('普通回答仍然正常显示。');
    await expectRequestCount(page, 1);
});

async function openAi(page, contentType = 'text/event-stream', autoSaveSessions = false) {
    await page.addInitScript(({contentType, autoSaveSessions}) => {
        localStorage.setItem('ui-locale', 'zh-CN');
        localStorage.setItem('browser-code-editor-settings', JSON.stringify({
            ai: {apiKey: 'test-key', agentModels: 'test-model', baseUrl: 'https://api.openai.com/v1', autoSaveSessions},
        }));

        const originalFetch = window.fetch.bind(window);
        const encoder = new TextEncoder();
        const streams = [];
        const requests = [];
        const events = [];
        const chunk = (index, value) => {
            const stream = streams[index];
            if (!stream || stream.record.closed) return false;
            stream.controller.enqueue(typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value));
            return true;
        };
        window.__aiStream = {
            requests,
            events,
            chunk,
            emit: (index, event) => chunk(index, 'data: ' + JSON.stringify(event) + '\n\n'),
            end(index) {
                const stream = streams[index];
                if (!stream || stream.record.closed) return false;
                stream.record.closed = true;
                stream.controller.close();
                return true;
            },
            fail(index, message = '测试流连接断开') {
                const stream = streams[index];
                if (!stream || stream.record.closed) return false;
                stream.record.closed = true;
                stream.controller.error(new Error(message));
                return true;
            },
        };
        window.fetch = async (resource, options = {}) => {
            const url = resource instanceof Request ? resource.url : String(resource);
            if (url !== 'https://api.openai.com/v1/responses') return originalFetch(resource, options);
            const body = options.body ?? (resource instanceof Request ? await resource.clone().text() : '{}');
            const signal = options.signal ?? (resource instanceof Request ? resource.signal : null);
            const index = requests.length;
            const record = {body: JSON.parse(body), aborted: false, closed: false};
            requests.push(record);
            events.push({type: 'request', index});
            const stream = new ReadableStream({
                start(controller) {
                    streams[index] = {controller, record};
                },
                cancel() {
                    record.closed = true;
                },
            });
            const abort = () => {
                record.aborted = true;
                events.push({type: 'abort', index});
                if (!record.closed) {
                    record.closed = true;
                    streams[index].controller.error(new DOMException('测试请求已中止', 'AbortError'));
                }
            };
            if (signal?.aborted) abort();
            else signal?.addEventListener('abort', abort, {once: true});
            return new Response(stream, {status: 200, headers: {'content-type': contentType}});
        };
    }, {contentType, autoSaveSessions});
    await page.goto('/codeEditor');
    await page.getByRole('button', {name: 'AI 助手', exact: true}).click();
}

async function sendPrompt(page, prompt) {
    await page.locator('.ai-chat-form textarea').fill(prompt);
    await page.getByRole('button', {name: '发送', exact: true}).click();
}

async function switchSession(page, title) {
    await page.getByRole('button', {name: '切换会话', exact: true}).click();
    await page.locator('.ai-history-item-main').filter({hasText: title}).click();
}

async function requests(page) {
    return page.evaluate(() => window.__aiStream.requests);
}

async function expectRequestCount(page, count) {
    await expect.poll(() => page.evaluate(() => window.__aiStream.requests.length)).toBe(count);
}

async function expectIdle(page) {
    await expect(page.getByRole('button', {name: '停止 AI 任务', exact: true})).toBeDisabled();
    await expect(page.getByRole('button', {name: '发送', exact: true})).toBeVisible();
}

async function emit(page, index, event) {
    expect(await page.evaluate(({index, event}) => window.__aiStream.emit(index, event), {index, event})).toBe(true);
}

async function chunk(page, index, value) {
    expect(await page.evaluate(({index, value}) => window.__aiStream.chunk(index, value), {index, value})).toBe(true);
}

async function complete(page, index, response) {
    expect(await page.evaluate(({index, response}) => {
        const stream = window.__aiStream;
        return stream.emit(index, {type: 'response.completed', response})
            && stream.chunk(index, 'data: [DONE]\n\n')
            && stream.end(index);
    }, {index, response})).toBe(true);
}

function textDelta(delta) {
    return {type: 'response.output_text.delta', item_id: 'message-1', output_index: 0, content_index: 0, delta};
}

function assistantMessage(text) {
    return {type: 'message', id: 'message-1', role: 'assistant', status: 'completed', content: [{type: 'output_text', text, annotations: []}]};
}
