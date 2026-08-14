import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const scriptUrl = new URL('../../public/stream-download-sw.js', import.meta.url);

test('场景：下载 Worker 登记一次性流并返回附件响应', async () => {
    const worker = await createWorkerHarness();
    const messages = [];
    const port = {postMessage: (message) => messages.push(message), close() {}};
    worker.message({
        data: {
            type: 'stream-download:create',
            id: 'download-id',
            fileName: '测试.txt',
            mimeType: 'text/plain',
            size: 5,
            stream: new Blob(['hello']).stream(),
        },
        ports: [port],
    });
    assert.deepEqual(messages.map((message) => message.type), ['registered']);

    const response = worker.fetch('https://example.test/__stream_download__/download-id');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'hello');
    assert.equal(response.headers.get('content-type'), 'text/plain');
    assert.equal(response.headers.get('content-length'), '5');
    assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8''/);
    assert.deepEqual(messages.map((message) => message.type), ['registered', 'started']);

    assert.equal(worker.fetch('https://example.test/__stream_download__/download-id').status, 404);
});

test('场景：下载 Worker dispose 会删除并取消尚未取走的流', async () => {
    const worker = await createWorkerHarness();
    let cancelled = false;
    worker.message({
        data: {
            type: 'stream-download:create',
            id: 'dispose-id',
            stream: new ReadableStream({cancel() { cancelled = true; }}),
        },
        ports: [{postMessage() {}, close() {}}],
    });
    worker.message({data: {type: 'stream-download:dispose', id: 'dispose-id'}, ports: []});
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(cancelled, true);
    assert.equal(worker.fetch('https://example.test/__stream_download__/dispose-id').status, 404);
});

async function createWorkerHarness() {
    const listeners = new Map();
    const self = {
        location: {origin: 'https://example.test'},
        addEventListener(type, listener) {
            listeners.set(type, listener);
        },
    };
    const context = vm.createContext({
        self,
        URL,
        Headers,
        Response,
        Promise,
        Number,
        String,
        Map,
        setTimeout,
        clearTimeout,
        encodeURIComponent,
        decodeURIComponent,
    });
    vm.runInContext(await readFile(scriptUrl, 'utf8'), context);
    return {
        message: (event) => listeners.get('message')(event),
        fetch(url) {
            let response = null;
            listeners.get('fetch')({
                request: {method: 'GET', url},
                respondWith(value) {
                    response = value;
                },
            });
            return response;
        },
    };
}
