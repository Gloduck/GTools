import assert from 'node:assert/strict';
import test from 'node:test';
import {WebRtcFileTransfer} from '../../src/shared/webrtc/file-transfer.js';

test('场景：接收文件分片直接写入流式目标并在完成时关闭', async () => {
    const control = createChannelPair();
    const data = createChannelPair();
    const writes = [];
    const target = createTarget({writes});
    let receivedFile = null;
    let resolveCompleted;
    let rejectCompleted;
    const completed = new Promise((resolve, reject) => {
        resolveCompleted = resolve;
        rejectCompleted = reject;
    });

    const receiver = new WebRtcFileTransfer({
        onIncomingOffer: () => {
            receiver.acceptIncoming({targets: [], createTarget: async () => target}).catch(rejectCompleted);
        },
        onIncomingState: (state) => {
            if (state.status === 'completed') resolveCompleted();
        },
        onFileReceived: (file) => {
            receivedFile = file;
        },
        onError: rejectCompleted,
    });
    const sender = new WebRtcFileTransfer({onError: rejectCompleted});
    receiver.attach({controlChannel: control.right, dataChannel: data.right});
    sender.attach({controlChannel: control.left, dataChannel: data.left});

    sender.offerFiles([new File(['streamed-content'], 'stream.txt', {type: 'text/plain'})]);
    await withTimeout(completed);

    assert.equal(new TextDecoder().decode(concatBytes(writes)), 'streamed-content');
    assert.equal(target.closed, true);
    assert.equal(target.aborted, false);
    assert.equal(receivedFile.name, 'stream.txt');
    assert.equal(receivedFile.downloadMethod, 'test-stream');
    assert.equal('blob' in receivedFile, false);
});

test('场景：流式目标写入失败时中止目标并通知传输失败', async () => {
    const control = createChannelPair();
    const data = createChannelPair();
    const target = createTarget({writeError: new Error('WRITE_FAILED')});
    let resolveFailed;
    const failed = new Promise((resolve) => {
        resolveFailed = resolve;
    });

    const receiver = new WebRtcFileTransfer({
        onIncomingOffer: () => {
            receiver.acceptIncoming({targets: [target], createTarget: async () => target}).catch(resolveFailed);
        },
        onError: resolveFailed,
    });
    const sender = new WebRtcFileTransfer({onError: () => {}});
    receiver.attach({controlChannel: control.right, dataChannel: data.right});
    sender.attach({controlChannel: control.left, dataChannel: data.left});

    sender.offerFiles([new File(['content'], 'failed.txt')]);
    await withTimeout(failed);
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(target.aborted, true);
    assert.equal(target.closed, false);
});

test('场景：发送 transfer.accept 失败时接收状态保持为 offering', async () => {
    const control = createChannelPair();
    const data = createChannelPair();
    const states = [];
    let resolveFailure;
    const failure = new Promise((resolve) => {
        resolveFailure = resolve;
    });
    control.right.failSend = (data) => JSON.parse(data).type === 'transfer.accept';

    const target = createTarget();
    const receiver = new WebRtcFileTransfer({
        onIncomingOffer: () => {
            receiver.acceptIncoming({targets: [target], createTarget: async () => createTarget()})
                .catch(resolveFailure);
        },
        onIncomingState: (state) => states.push(state.status),
    });
    const sender = new WebRtcFileTransfer();
    receiver.attach({controlChannel: control.right, dataChannel: data.right});
    sender.attach({controlChannel: control.left, dataChannel: data.left});

    sender.offerFiles([new File(['content'], 'failed-accept.txt')]);
    await withTimeout(failure);

    assert.equal(states.at(-1), 'offering');
    assert.equal(receiver.hasActiveIncoming, true);
    assert.equal(target.aborted, true);
});

function createTarget({writes = [], writeError = null} = {}) {
    let resolveCompleted;
    let rejectCompleted;
    const completed = new Promise((resolve, reject) => {
        resolveCompleted = resolve;
        rejectCompleted = reject;
    });
    completed.catch(() => {});
    return {
        method: 'test-stream',
        completed,
        closed: false,
        aborted: false,
        async write(chunk) {
            if (writeError) throw writeError;
            writes.push(new Uint8Array(chunk));
        },
        async close() {
            this.closed = true;
            resolveCompleted();
        },
        async abort(error) {
            this.aborted = true;
            rejectCompleted(error);
        },
    };
}

function createChannelPair() {
    const left = new MockDataChannel();
    const right = new MockDataChannel();
    left.peer = right;
    right.peer = left;
    return {left, right};
}

class MockDataChannel extends EventTarget {
    constructor() {
        super();
        this.readyState = 'open';
        this.bufferedAmount = 0;
        this.bufferedAmountLowThreshold = 0;
        this.binaryType = 'arraybuffer';
        this.peer = null;
    }

    send(data) {
        if (this.failSend?.(data)) throw new Error('CONTROL_SEND_FAILED');
        queueMicrotask(() => this.peer.dispatchEvent(new MessageEvent('message', {data})));
    }
}

function concatBytes(chunks) {
    const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
}

function withTimeout(promise, timeoutMs = 2000) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for transfer')), timeoutMs)),
    ]);
}
