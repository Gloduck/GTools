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

test('流式中打断发送保留部分回答，重复点击只启动一次新请求', async ({page}) => {
    await openAi(page);
    await sendPrompt(page, '原始任务');
    await expectRequestCount(page, 1);
    await emit(page, 0, textDelta('已确认的部分结论。'));
    await expect(page.locator('.ai-chat-messages')).toContainText('已确认的部分结论。');
    await page.locator('.ai-chat-form textarea').fill('按新要求继续');
    await page.locator('.ai-chat-form button[type="submit"]').evaluate((button) => { button.click(); button.click(); });
    await expectRequestCount(page, 2);
    const recorded = await requests(page);
    expect(recorded[0].aborted).toBe(true);
    const input = JSON.stringify(recorded[1].body.input);
    for (const text of ['原始任务', '已确认的部分结论。', '按新要求继续']) expect(input).toContain(text);
    await emit(page, 1, textDelta('新任务正在处理。'));
    expect(await page.evaluate(() => window.__aiStream.emit(0, {type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: '旧任务迟到内容'}))).toBe(false);
    await complete(page, 1, {output: [assistantMessage('新任务完成。')]});
    await expectIdle(page);
    await expect(page.locator('.ai-message-user .ai-message-content')).toHaveText(['原始任务', '按新要求继续']);
    await expect(page.locator('.ai-chat-messages')).not.toContainText('旧任务迟到内容');
    await expect(page.locator('.ai-message-assistant').filter({hasText: '已确认的部分结论。'})).toHaveCount(1);
    await expectRequestCount(page, 2);
});

for (const stopPending of [false, true, 'stop_then_send']) {
    test(`旧请求真实收尾前合并连续新消息，停止待续轮：${stopPending}`, async ({page}) => {
        await openAi(page, 'text/event-stream', false, true);
        await sendPrompt(page, '第一项任务');
        await expectRequestCount(page, 1);
        await submitDuringRun(page, '新消息甲');
        await submitDuringRun(page, '新消息乙');
        await expectRequestCount(page, 1);
        expect((await requests(page))[0].aborted).toBe(true);
        // 模拟传输层直到稍后才结束，续轮不得越过真实收尾。
        if (stopPending) await page.getByRole('button', {name: '停止 AI 任务', exact: true}).click();
        if (stopPending === 'stop_then_send') await submitDuringRun(page, '停止后重新发起的新请求');
        await page.evaluate(() => window.__aiStream.releaseAbort(0));
        if (stopPending === true) {
            await expectIdle(page);
            await expectRequestCount(page, 1);
        } else {
            await expectRequestCount(page, 2);
            const input = JSON.stringify((await requests(page))[1].body.input);
            if (stopPending === 'stop_then_send') expect(input).toContain('停止后重新发起的新请求');
            else for (const text of ['第一项任务', '新消息甲', '新消息乙']) expect(input).toContain(text);
            await complete(page, 1, {output: [assistantMessage('合并处理完成。')]});
            await expectIdle(page);
            await expectRequestCount(page, 2);
        }
    });
}

test('打断等待提问的工具批次时保留成功结果，并为未执行调用给出唯一结果', async ({page}) => {
    await openAi(page);
    await sendPrompt(page, '检查工具，提问后再检查其他工具');
    await expectRequestCount(page, 1);
    const calls = [
        toolCall('completed', 'get_tool_availability', {names: ['run_javascript']}),
        toolCall('waiting', 'ask_user', {question: '选择方案', options: [{label: '方案 A'}]}),
        toolCall('queued', 'get_tool_availability', {names: ['ask_user']}),
    ];
    const search = {type: 'web_search_call', id: 'native-search', status: 'completed', action: {type: 'search', sources: [{url: 'https://example.com/source', title: '已完成搜索来源'}]}};
    const image = {type: 'image_generation_call', id: 'native-image', status: 'completed', output_format: 'png', result: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWJiYGD4DwAAAP//cGajQwAAAAZJREFUAwABDgEC81VxbAAAAABJRU5ErkJggg=='};
    await complete(page, 0, {output: [calls[0], calls[1], search, image, calls[2]]});
    await expect(page.getByRole('dialog', {name: 'AI 需要你的回答'})).toBeVisible();
    await expect(page.locator('.ai-message-tool').first().locator('.ai-tool-toggle')).toContainText('成功');
    await submitDuringRun(page, '不必提问，直接总结已知结果');
    await expectRequestCount(page, 2);
    await expect(page.getByRole('dialog', {name: 'AI 需要你的回答'})).toBeHidden();
    const input = (await requests(page))[1].body.input;
    const outputs = input.filter((item) => item.type === 'function_call_output');
    expect(outputs).toHaveLength(3);
    expect(input.filter((item) => item.type === 'web_search_call')).toHaveLength(1);
    expect(input.filter((item) => item.type === 'image_generation_call')).toHaveLength(1);
    const searchCard = page.locator('.ai-message-tool').filter({has: page.locator('.ai-tool-toggle', {hasText: 'web_search'})});
    await expect(searchCard.locator('.ai-tool-toggle')).toContainText('成功');
    await expect(searchCard.getByRole('link', {name: /已完成搜索来源/})).toHaveAttribute('href', 'https://example.com/source');
    const imageCard = page.locator('.ai-message-tool').filter({has: page.locator('.ai-tool-toggle', {hasText: 'image'})});
    const imageToggle = imageCard.locator('.ai-tool-toggle');
    if (await imageCard.locator('.ai-tool-details').count() === 0) await imageToggle.click();
    const imageResult = JSON.parse(await imageCard.locator('.ai-tool-details pre').last().textContent());
    expect(imageResult).toMatchObject({status: 'completed', local_save_state: 'not_started'});
    await expect(page.locator('.ai-image-result')).toHaveCount(0);
    for (const call of calls) {
        expect(input.filter((item) => item.type === 'function_call' && item.call_id === call.call_id)).toHaveLength(1);
        expect(outputs.filter((item) => item.call_id === call.call_id)).toHaveLength(1);
    }
    const result = (id) => JSON.parse(outputs.find((item) => item.call_id === id).output);
    expect(result('completed').ok).toBe(true);
    expect(result('completed').tools).toEqual(expect.arrayContaining([expect.objectContaining({name: 'run_javascript', available: true})]));
    expect(result('waiting').ok).toBe(false);
    expect(result('waiting').interrupted).toBe(true);
    expect(result('waiting').cancelled).toBeUndefined();
    expect(result('waiting').answer).toBeUndefined();
    expect(result('waiting').selected_option).toBeUndefined();
    expect(result('waiting').summary).not.toMatch(/用户.*取消|user.*cancel/i);
    expect(result('queued').ok).toBe(false);
    expect(JSON.stringify(result('queued'))).toMatch(/未执行|未开始|not.?executed|not.?started/i);
    await emit(page, 1, textDelta('基于已完成工具的部分总结。'));
    await expect(page.locator('.ai-chat-messages')).toContainText('基于已完成工具的部分总结。');
    await submitDuringRun(page, '把总结写得更短');
    await expectRequestCount(page, 3);
    const resumed = (await requests(page))[2].body.input;
    for (const call of calls) {
        expect(resumed.filter((item) => item.type === 'function_call' && item.call_id === call.call_id)).toHaveLength(1);
        expect(resumed.filter((item) => item.type === 'function_call_output' && item.call_id === call.call_id)).toHaveLength(1);
    }
    expect(JSON.stringify(resumed).split('基于已完成工具的部分总结。')).toHaveLength(2);
    await complete(page, 2, {output: [assistantMessage('已按已知结果总结。')]});
    await expectIdle(page);
    await expectRequestCount(page, 3);
});

test('打断会话 A 的新消息不影响会话 B 的流和上下文', async ({page}) => {
    await openAi(page);
    await sendPrompt(page, '任务 A');
    await expectRequestCount(page, 1);
    await emit(page, 0, textDelta('A 的已有结论。'));
    await page.getByRole('button', {name: '新建会话', exact: true}).click();
    await sendPrompt(page, '任务 B');
    await expectRequestCount(page, 2);
    await emit(page, 1, textDelta('B 的已有结论。'));
    await switchSession(page, '会话 1');
    await submitDuringRun(page, '只调整 A');
    await expectRequestCount(page, 3);
    const recorded = await requests(page);
    expect(recorded[0].aborted).toBe(true);
    expect(recorded[1].aborted).toBe(false);
    expect(JSON.stringify(recorded[2].body.input)).not.toContain('任务 B');
    await emit(page, 1, textDelta('B 后台进度。'));
    await expect(page.locator('.ai-chat-messages')).not.toContainText('B 后台进度。');
    await complete(page, 2, {output: [assistantMessage('A 调整完成。')]});
    await expectIdle(page);
    await switchSession(page, '会话 2');
    await expect(page.locator('.ai-message-assistant .ai-message-content')).toHaveText('B 的已有结论。B 后台进度。');
    await complete(page, 1, {output: [assistantMessage('B 的已有结论。B 后台进度。')]});
    await expectIdle(page);
    await expectRequestCount(page, 3);
});

for (const readFails of [false, true]) {
test(`附件准备期间修改草稿并停止，迟到读取不能清除新草稿或在其他会话复活（读取失败：${readFails}）`, async ({page}) => {
    await openAi(page);
    await sendPrompt(page, '建立会话 A');
    await expectRequestCount(page, 1);
    await complete(page, 0, {output: [assistantMessage('会话 A 已建立。')]});
    await expectIdle(page);
    await page.evaluate(() => {
        const original = File.prototype.text;
        File.prototype.text = async function () {
            if (this.name === 'delayed.txt') {
                window.__attachmentReadStarted = true;
                await new Promise((resolve, reject) => { window.__releaseAttachmentRead = resolve; window.__rejectAttachmentRead = reject; });
            }
            return original.call(this);
        };
    });
    await page.locator('.ai-attachment-input').setInputFiles({name: 'delayed.txt', mimeType: 'text/plain', buffer: Buffer.from('附件正文')});
    await page.locator('.ai-chat-form textarea').fill('读取此附件');
    await page.locator('.ai-chat-form button[type="submit"]').click();
    await expect.poll(() => page.evaluate(() => window.__attachmentReadStarted)).toBe(true);
    await page.locator('.ai-chat-form textarea').fill('A 的新草稿不得丢失');
    await page.getByRole('button', {name: '停止 AI 任务', exact: true}).click();
    await page.getByRole('button', {name: '新建会话', exact: true}).click();
    await page.locator('.ai-chat-form textarea').fill('B 的独立草稿');
    await page.evaluate((readFails) => readFails ? window.__rejectAttachmentRead(new Error('迟到附件失败')) : window.__releaseAttachmentRead(), readFails);
    await expect(page.locator('.editor-dialog-backdrop')).toHaveCount(0);
    await expect(page.locator('.ai-chat-form textarea')).toHaveValue('B 的独立草稿');
    await expectRequestCount(page, 1);
    await switchSession(page, '会话 1');
    await expectIdle(page);
    await expect(page.locator('.ai-chat-form textarea')).toHaveValue('A 的新草稿不得丢失');
    await expect(page.locator('.ai-chat-messages')).not.toContainText('读取附件失败');
    await expect(page.locator('.editor-dialog-backdrop')).toHaveCount(0);
    await expectRequestCount(page, 1);
});

}

async function submitDuringRun(page, text) {
    await page.locator('.ai-chat-form textarea').fill(text);
    await page.locator('.ai-chat-form button[type="submit"]').click();
}

function toolCall(id, name, args) {
    return {type: 'function_call', call_id: id, name, arguments: JSON.stringify(args)};
}

async function openAi(page, contentType = 'text/event-stream', autoSaveSessions = false, holdAbort = false) {
    await page.addInitScript(({contentType, autoSaveSessions, holdAbort}) => {
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
            releaseAbort(index) {
                const stream = streams[index];
                if (!stream || stream.record.closed) return;
                stream.record.closed = true;
                stream.controller.error(new DOMException('测试请求已中止', 'AbortError'));
                stream.releaseResponse?.();
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
                if (!record.closed && !holdAbort) {
                    record.closed = true;
                    streams[index].controller.error(new DOMException('测试请求已中止', 'AbortError'));
                }
            };
            if (signal?.aborted) abort();
            else signal?.addEventListener('abort', abort, {once: true});
            if (holdAbort && index === 0) await new Promise((resolve) => { streams[index].releaseResponse = resolve; });
            return new Response(stream, {status: 200, headers: {'content-type': contentType}});
        };
    }, {contentType, autoSaveSessions, holdAbort});
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
