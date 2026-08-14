const PROTOCOL = 'gtools-file-transfer';
const PROTOCOL_VERSION = 1;
const FRAME_MAGIC = 0x47544631;
const FRAME_HEADER_BYTES = 37;
const FRAME_CHUNK = 1;
const FRAME_FILE_END = 2;
const FRAME_TRANSFER_END = 3;
const DEFAULT_CHUNK_BYTES = 48 * 1024;
const BUFFER_HIGH_BYTES = 4 * 1024 * 1024;
const BUFFER_LOW_BYTES = 1024 * 1024;
const RECEIVE_WINDOW_BYTES = 8 * 1024 * 1024;
const ACK_INTERVAL_BYTES = 1024 * 1024;
const ACK_INTERVAL_MS = 250;
const COMPLETION_TIMEOUT_MS = 60_000;
const MAX_FILES_PER_TRANSFER = 100;

export class WebRtcFileTransfer {
    #callbacks;
    #controlChannel = null;
    #dataChannel = null;
    #maxMessageSize = 0;
    #chunkBytes = DEFAULT_CHUNK_BYTES;
    #outgoing = null;
    #incoming = null;
    #receiveQueue = Promise.resolve();
    #listeners = null;

    constructor(callbacks = {}) {
        this.#callbacks = {
            onIncomingOffer: callbacks.onIncomingOffer || (() => {}),
            onIncomingState: callbacks.onIncomingState || (() => {}),
            onOutgoingState: callbacks.onOutgoingState || (() => {}),
            onSendProgress: callbacks.onSendProgress || (() => {}),
            onReceiveProgress: callbacks.onReceiveProgress || (() => {}),
            onFileReceived: callbacks.onFileReceived || (() => {}),
            onError: callbacks.onError || (() => {})
        };
    }

    get ready() {
        return this.#controlChannel?.readyState === 'open' && this.#dataChannel?.readyState === 'open';
    }

    get hasActiveOutgoing() {
        return Boolean(this.#outgoing && !isTerminal(this.#outgoing.status));
    }

    get hasActiveIncoming() {
        return Boolean(this.#incoming && !isTerminal(this.#incoming.status));
    }

    attach({controlChannel, dataChannel, maxMessageSize = 0}) {
        this.detach();
        this.#controlChannel = controlChannel;
        this.#dataChannel = dataChannel;
        this.#maxMessageSize = Number(maxMessageSize) || 0;
        this.#chunkBytes = this.#maxMessageSize > FRAME_HEADER_BYTES
            ? Math.max(1024, Math.min(DEFAULT_CHUNK_BYTES, this.#maxMessageSize - FRAME_HEADER_BYTES))
            : DEFAULT_CHUNK_BYTES;
        this.#dataChannel.binaryType = 'arraybuffer';
        this.#dataChannel.bufferedAmountLowThreshold = BUFFER_LOW_BYTES;

        const controlMessage = (event) => {
            this.#handleControlMessage(event.data).catch((error) => this.#reportError(error));
        };
        const dataMessage = (event) => {
            this.#receiveQueue = this.#receiveQueue
                .then(() => this.#handleDataMessage(event.data))
                .catch((error) => this.#failIncoming(error));
        };
        const channelClosed = () => {
            this.#cancelOutgoing('CHANNEL_CLOSED', false);
            this.#cancelIncoming('CHANNEL_CLOSED', false).catch(() => {});
        };
        const channelError = () => {
            if (this.hasActiveOutgoing || this.hasActiveIncoming) {
                this.#reportError(new Error('WEBRTC_DATA_CHANNEL_ERROR'));
            }
        };

        controlChannel.addEventListener('message', controlMessage);
        controlChannel.addEventListener('close', channelClosed);
        controlChannel.addEventListener('error', channelError);
        dataChannel.addEventListener('message', dataMessage);
        dataChannel.addEventListener('close', channelClosed);
        dataChannel.addEventListener('error', channelError);
        this.#listeners = {controlMessage, dataMessage, channelClosed, channelError};
    }

    detach() {
        if (this.#listeners && this.#controlChannel && this.#dataChannel) {
            const {controlMessage, dataMessage, channelClosed, channelError} = this.#listeners;
            this.#controlChannel.removeEventListener('message', controlMessage);
            this.#controlChannel.removeEventListener('close', channelClosed);
            this.#controlChannel.removeEventListener('error', channelError);
            this.#dataChannel.removeEventListener('message', dataMessage);
            this.#dataChannel.removeEventListener('close', channelClosed);
            this.#dataChannel.removeEventListener('error', channelError);
        }
        this.#listeners = null;
        this.#controlChannel = null;
        this.#dataChannel = null;
        this.#maxMessageSize = 0;
        this.#receiveQueue = Promise.resolve();
    }

    close() {
        this.#cancelOutgoing('TRANSFER_CLOSED', false);
        this.#cancelIncoming('TRANSFER_CLOSED', false).catch(() => {});
        this.detach();
    }

    offerFiles(files) {
        if (!this.ready) throw new Error('FILE_CHANNEL_NOT_READY');
        if (this.hasActiveOutgoing) throw new Error('OUTGOING_TRANSFER_ACTIVE');

        const selectedFiles = Array.from(files || []).filter((file) => file instanceof File);
        if (selectedFiles.length === 0) throw new Error('NO_FILES_SELECTED');
        if (selectedFiles.length > MAX_FILES_PER_TRANSFER) throw new Error('TOO_MANY_FILES');

        const transferId = createTransferId();
        const metadata = selectedFiles.map((file, index) => ({
            id: index,
            name: sanitizeFileName(file.name),
            size: file.size,
            type: file.type || 'application/octet-stream',
            lastModified: file.lastModified || 0
        }));
        const totalBytes = metadata.reduce((total, file) => total + file.size, 0);
        this.#outgoing = {
            transferId,
            files: selectedFiles,
            metadata,
            totalBytes,
            sentBytes: 0,
            acknowledgedBytes: 0,
            completedFiles: 0,
            status: 'offering',
            cancelled: false,
            ackWaiters: new Set(),
            completionTimer: null,
            lastProgressAt: 0
        };
        this.#notifyOutgoing();
        try {
            this.#sendControl('transfer.offer', {transferId, files: metadata, totalBytes});
        } catch (error) {
            this.#outgoing.status = 'failed';
            this.#outgoing.reason = error?.message || 'TRANSFER_OFFER_FAILED';
            this.#notifyOutgoing(true);
            throw error;
        }
        return transferId;
    }

    async acceptIncoming({directoryHandle = null, targets = null, createTarget = null, expectedTransferId = null} = {}) {
        const incoming = this.#incoming;
        if (!incoming || incoming.status !== 'offering') throw new Error('NO_INCOMING_TRANSFER');
        if (expectedTransferId && incoming.transferId !== expectedTransferId) throw new Error('INCOMING_OFFER_CHANGED');

        let directoryTargets = null;
        try {
            if (directoryHandle) {
                incoming.mode = 'directory';
                directoryTargets = await createDirectoryTargets(directoryHandle, incoming.metadata);
                incoming.files.forEach((file, index) => {
                    file.handle = directoryTargets[index].handle;
                    file.resolvedName = directoryTargets[index].name;
                });
            } else {
                if (typeof createTarget !== 'function') throw new Error('INVALID_DOWNLOAD_TARGET_FACTORY');
                incoming.mode = 'stream';
                incoming.createTarget = createTarget;
                incoming.files.forEach((file, index) => this.#assignIncomingTarget(file, targets?.[index] || null));
            }

            if (this.#incoming !== incoming || incoming.status !== 'offering'
                    || (expectedTransferId && incoming.transferId !== expectedTransferId)) {
                throw new Error('INCOMING_OFFER_CHANGED');
            }
            this.#sendControl('transfer.accept', {transferId: incoming.transferId});
        } catch (error) {
            if (directoryHandle && directoryTargets) await removeDirectoryTargets(directoryHandle, directoryTargets);
            if (this.#incoming === incoming && incoming.status === 'offering') {
                await abortIncomingWriters(incoming);
                incoming.mode = null;
                incoming.createTarget = null;
                incoming.files.forEach((file) => {
                    file.handle = null;
                    file.resolvedName = file.metadata.name;
                    file.writable = null;
                    file.target = null;
                });
            }
            throw error;
        }

        incoming.status = 'receiving';
        incoming.lastAckAt = performance.now();
        this.#notifyIncoming();
    }

    rejectIncoming(reason = 'USER_REJECTED') {
        const incoming = this.#incoming;
        if (!incoming || incoming.status !== 'offering') return;
        incoming.status = 'rejected';
        this.#sendControl('transfer.reject', {transferId: incoming.transferId, reason});
        this.#notifyIncoming();
        this.#incoming = null;
    }

    cancelOutgoing(reason = 'USER_CANCELLED') {
        this.#cancelOutgoing(reason, true);
    }

    cancelIncoming(reason = 'USER_CANCELLED') {
        return this.#cancelIncoming(reason, true);
    }

    async #handleControlMessage(rawMessage) {
        if (typeof rawMessage !== 'string') return;
        let message;
        try {
            message = JSON.parse(rawMessage);
        } catch {
            throw new Error('INVALID_TRANSFER_CONTROL_MESSAGE');
        }
        if (message?.protocol !== PROTOCOL || message?.version !== PROTOCOL_VERSION || !message.type) return;

        if (message.type === 'transfer.offer') {
            this.#handleIncomingOffer(message);
        } else if (message.type === 'transfer.accept') {
            if (this.#outgoing?.transferId === message.transferId && this.#outgoing.status === 'offering') {
                this.#outgoing.status = 'sending';
                this.#notifyOutgoing();
                this.#sendOutgoing(this.#outgoing).catch((error) => this.#failOutgoing(error));
            }
        } else if (message.type === 'transfer.reject') {
            if (this.#outgoing?.transferId === message.transferId) {
                this.#outgoing.status = 'rejected';
                this.#outgoing.reason = message.reason || 'REJECTED';
                this.#resolveAckWaiters(this.#outgoing);
                this.#notifyOutgoing();
            }
        } else if (message.type === 'transfer.ack') {
            this.#handleAcknowledgement(message);
        } else if (message.type === 'transfer.complete') {
            if (this.#outgoing?.transferId === message.transferId) {
                clearTimeout(this.#outgoing.completionTimer);
                this.#outgoing.acknowledgedBytes = Math.max(
                    this.#outgoing.acknowledgedBytes,
                    Number(message.receivedBytes) || 0
                );
                this.#outgoing.status = 'completed';
                this.#resolveAckWaiters(this.#outgoing);
                this.#notifyOutgoing(true);
            }
        } else if (message.type === 'transfer.cancel') {
            if (this.#outgoing?.transferId === message.transferId) {
                this.#cancelOutgoing(message.reason || 'PEER_CANCELLED', false);
            }
            if (this.#incoming?.transferId === message.transferId) {
                await this.#cancelIncoming(message.reason || 'PEER_CANCELLED', false);
            }
        } else if (message.type === 'transfer.error') {
            const error = new Error(message.reason || 'PEER_TRANSFER_ERROR');
            if (this.#outgoing?.transferId === message.transferId) this.#failOutgoing(error, false);
            if (this.#incoming?.transferId === message.transferId) await this.#failIncoming(error, false);
        }
    }

    #handleIncomingOffer(message) {
        if (this.hasActiveIncoming) {
            this.#sendControl('transfer.reject', {transferId: message.transferId, reason: 'RECEIVER_BUSY'});
            return;
        }
        const metadata = validateOffer(message);
        this.#incoming = {
            transferId: message.transferId,
            metadata,
            totalBytes: message.totalBytes,
            receivedBytes: 0,
            completedFiles: 0,
            status: 'offering',
            mode: null,
            createTarget: null,
            files: metadata.map((file) => ({
                metadata: file,
                receivedBytes: 0,
                handle: null,
                resolvedName: file.name,
                writable: null,
                target: null,
                completed: false
            })),
            lastAckBytes: 0,
            lastAckAt: performance.now(),
            lastProgressAt: 0
        };
        this.#notifyIncoming();
        this.#callbacks.onIncomingOffer(this.#incomingSummary(this.#incoming));
    }

    #handleAcknowledgement(message) {
        const outgoing = this.#outgoing;
        if (!outgoing || outgoing.transferId !== message.transferId) return;
        outgoing.acknowledgedBytes = Math.min(
            outgoing.totalBytes,
            Math.max(outgoing.acknowledgedBytes, Number(message.receivedBytes) || 0)
        );
        this.#resolveAckWaiters(outgoing);
    }

    async #sendOutgoing(outgoing) {
        for (let fileIndex = 0; fileIndex < outgoing.files.length; fileIndex += 1) {
            const file = outgoing.files[fileIndex];
            let offset = 0;
            while (offset < file.size) {
                this.#ensureOutgoingActive(outgoing);
                await this.#waitForSendCapacity(outgoing);
                this.#ensureOutgoingActive(outgoing);

                const nextOffset = Math.min(file.size, offset + this.#chunkBytes);
                const chunk = await file.slice(offset, nextOffset).arrayBuffer();
                this.#ensureOutgoingActive(outgoing);
                this.#dataChannel.send(encodeFrame({
                    type: FRAME_CHUNK,
                    transferId: outgoing.transferId,
                    fileIndex,
                    offset,
                    payload: chunk
                }));
                offset = nextOffset;
                outgoing.sentBytes += chunk.byteLength;
                this.#notifySendProgress(outgoing);
            }

            await this.#waitForSendCapacity(outgoing);
            this.#dataChannel.send(encodeFrame({
                type: FRAME_FILE_END,
                transferId: outgoing.transferId,
                fileIndex,
                offset: file.size
            }));
            outgoing.completedFiles += 1;
            this.#notifySendProgress(outgoing, true);
        }

        await this.#waitForSendCapacity(outgoing);
        this.#dataChannel.send(encodeFrame({
            type: FRAME_TRANSFER_END,
            transferId: outgoing.transferId,
            fileIndex: 0xffffffff,
            offset: outgoing.totalBytes
        }));
        outgoing.status = 'finishing';
        this.#notifyOutgoing();
        outgoing.completionTimer = setTimeout(() => {
            if (this.#outgoing === outgoing && outgoing.status === 'finishing') {
                this.#failOutgoing(new Error('TRANSFER_COMPLETION_TIMEOUT'));
            }
        }, COMPLETION_TIMEOUT_MS);
    }

    async #handleDataMessage(rawData) {
        const frame = decodeFrame(await toArrayBuffer(rawData));
        const incoming = this.#incoming;
        if (!incoming || incoming.transferId !== frame.transferId || incoming.status !== 'receiving') return;

        if (frame.type === FRAME_CHUNK) {
            await this.#writeIncomingChunk(incoming, frame);
        } else if (frame.type === FRAME_FILE_END) {
            await this.#completeIncomingFile(incoming, frame);
        } else if (frame.type === FRAME_TRANSFER_END) {
            await this.#completeIncomingTransfer(incoming, frame);
        }
    }

    async #writeIncomingChunk(incoming, frame) {
        const file = incoming.files[frame.fileIndex];
        if (!file || file.completed) throw new Error('INVALID_TRANSFER_FILE_INDEX');
        if (frame.offset !== file.receivedBytes) throw new Error('INVALID_TRANSFER_OFFSET');
        if (file.receivedBytes + frame.payload.byteLength > file.metadata.size) {
            throw new Error('TRANSFER_FILE_SIZE_EXCEEDED');
        }

        if (incoming.mode === 'directory') {
            if (!file.writable) file.writable = await file.handle.createWritable();
            await file.writable.write({type: 'write', position: frame.offset, data: frame.payload});
        } else {
            await this.#ensureIncomingTarget(incoming, file, frame.fileIndex);
            await file.writable.write(frame.payload);
        }

        file.receivedBytes += frame.payload.byteLength;
        incoming.receivedBytes += frame.payload.byteLength;
        this.#notifyReceiveProgress(incoming);
        this.#sendAcknowledgementIfNeeded(incoming);
    }

    async #completeIncomingFile(incoming, frame) {
        const file = incoming.files[frame.fileIndex];
        if (!file || file.completed || frame.offset !== file.metadata.size || file.receivedBytes !== file.metadata.size) {
            throw new Error('TRANSFER_FILE_INCOMPLETE');
        }

        if (incoming.mode === 'stream') await this.#ensureIncomingTarget(incoming, file, frame.fileIndex);
        const target = file.target;
        if (file.writable) await file.writable.close();
        if (target?.completed) await target.completed;
        file.writable = null;
        file.target = null;
        file.completed = true;
        incoming.completedFiles += 1;

        const received = {
            transferId: incoming.transferId,
            fileIndex: frame.fileIndex,
            name: file.resolvedName,
            size: file.metadata.size,
            type: file.metadata.type,
            lastModified: file.metadata.lastModified,
            savedToDisk: incoming.mode === 'directory',
            downloadMethod: target?.method || (incoming.mode === 'directory' ? 'directory' : 'stream')
        };
        this.#callbacks.onFileReceived(received);
        this.#notifyReceiveProgress(incoming, true);
        this.#sendAcknowledgement(incoming);
    }

    async #ensureIncomingTarget(incoming, file, fileIndex) {
        if (file.writable) return;
        const target = await incoming.createTarget?.(file.metadata, fileIndex);
        if (!target) throw new Error('DOWNLOAD_TARGET_UNAVAILABLE');
        this.#assignIncomingTarget(file, target);
    }

    #assignIncomingTarget(file, target) {
        if (!target) return;
        if (typeof target.write !== 'function' || typeof target.close !== 'function' || typeof target.abort !== 'function') {
            throw new Error('INVALID_DOWNLOAD_TARGET');
        }
        file.target = target;
        file.writable = target;
    }

    async #completeIncomingTransfer(incoming, frame) {
        const allFilesComplete = incoming.files.every((file) => file.completed);
        if (!allFilesComplete || frame.offset !== incoming.totalBytes || incoming.receivedBytes !== incoming.totalBytes) {
            throw new Error('TRANSFER_INCOMPLETE');
        }
        incoming.status = 'completed';
        this.#sendAcknowledgement(incoming);
        this.#sendControl('transfer.complete', {
            transferId: incoming.transferId,
            receivedBytes: incoming.receivedBytes
        });
        this.#notifyIncoming();
        this.#incoming = null;
    }

    async #waitForSendCapacity(outgoing) {
        this.#ensureOutgoingActive(outgoing);
        if (this.#dataChannel.bufferedAmount > BUFFER_HIGH_BYTES) {
            await waitForBufferedAmountLow(this.#dataChannel);
        }
        while (outgoing.sentBytes - outgoing.acknowledgedBytes >= RECEIVE_WINDOW_BYTES) {
            await new Promise((resolve) => outgoing.ackWaiters.add(resolve));
            this.#ensureOutgoingActive(outgoing);
        }
    }

    #sendAcknowledgementIfNeeded(incoming) {
        const now = performance.now();
        if (incoming.receivedBytes - incoming.lastAckBytes >= ACK_INTERVAL_BYTES
                || now - incoming.lastAckAt >= ACK_INTERVAL_MS) {
            this.#sendAcknowledgement(incoming);
        }
    }

    #sendAcknowledgement(incoming) {
        incoming.lastAckBytes = incoming.receivedBytes;
        incoming.lastAckAt = performance.now();
        this.#sendControl('transfer.ack', {
            transferId: incoming.transferId,
            receivedBytes: incoming.receivedBytes
        });
    }

    #sendControl(type, payload = {}) {
        if (this.#controlChannel?.readyState !== 'open') throw new Error('CONTROL_CHANNEL_NOT_READY');
        const message = JSON.stringify({
            protocol: PROTOCOL,
            version: PROTOCOL_VERSION,
            type,
            ...payload
        });
        if (this.#maxMessageSize && new TextEncoder().encode(message).byteLength > this.#maxMessageSize) {
            throw new Error('TRANSFER_CONTROL_MESSAGE_TOO_LARGE');
        }
        this.#controlChannel.send(message);
    }

    #ensureOutgoingActive(outgoing) {
        if (this.#outgoing !== outgoing || outgoing.cancelled || !this.ready) {
            throw new Error(outgoing.reason || 'TRANSFER_CANCELLED');
        }
    }

    #cancelOutgoing(reason, notifyPeer) {
        const outgoing = this.#outgoing;
        if (!outgoing || isTerminal(outgoing.status)) return;
        outgoing.cancelled = true;
        outgoing.reason = reason;
        outgoing.status = 'cancelled';
        clearTimeout(outgoing.completionTimer);
        this.#resolveAckWaiters(outgoing);
        if (notifyPeer && this.ready) {
            this.#sendControl('transfer.cancel', {transferId: outgoing.transferId, reason});
        }
        this.#notifyOutgoing(true);
    }

    async #cancelIncoming(reason, notifyPeer) {
        const incoming = this.#incoming;
        if (!incoming || isTerminal(incoming.status) || ['cancelling', 'failing'].includes(incoming.status)) return;
        incoming.status = 'cancelling';
        incoming.reason = reason;
        if (notifyPeer && this.ready) {
            try {
                this.#sendControl('transfer.cancel', {transferId: incoming.transferId, reason});
            } catch {
            }
        }
        await abortIncomingWriters(incoming);
        if (this.#incoming !== incoming) return;
        incoming.status = 'cancelled';
        this.#notifyIncoming();
        this.#incoming = null;
    }

    #failOutgoing(error, notifyPeer = true) {
        const outgoing = this.#outgoing;
        if (!outgoing || isTerminal(outgoing.status)) return;
        outgoing.cancelled = true;
        outgoing.status = 'failed';
        outgoing.reason = error?.message || 'TRANSFER_FAILED';
        clearTimeout(outgoing.completionTimer);
        this.#resolveAckWaiters(outgoing);
        if (notifyPeer && this.ready) {
            this.#sendControl('transfer.error', {
                transferId: outgoing.transferId,
                reason: outgoing.reason
            });
        }
        this.#notifyOutgoing(true);
        this.#reportError(error);
    }

    async #failIncoming(error, notifyPeer = true) {
        const incoming = this.#incoming;
        if (!incoming || isTerminal(incoming.status) || ['cancelling', 'failing'].includes(incoming.status)) {
            this.#reportError(error);
            return;
        }
        incoming.status = 'failing';
        incoming.reason = error?.message || 'TRANSFER_FAILED';
        if (notifyPeer && this.ready) {
            try {
                this.#sendControl('transfer.error', {
                    transferId: incoming.transferId,
                    reason: incoming.reason
                });
            } catch {
            }
        }
        await abortIncomingWriters(incoming);
        if (this.#incoming !== incoming) return;
        incoming.status = 'failed';
        this.#notifyIncoming();
        this.#incoming = null;
        this.#reportError(error);
    }

    #resolveAckWaiters(outgoing) {
        for (const resolve of outgoing.ackWaiters) resolve();
        outgoing.ackWaiters.clear();
    }

    #notifyOutgoing(forceProgress = false) {
        if (!this.#outgoing) return;
        this.#callbacks.onOutgoingState(this.#outgoingSummary(this.#outgoing));
        this.#notifySendProgress(this.#outgoing, forceProgress);
    }

    #notifyIncoming() {
        if (!this.#incoming) return;
        this.#callbacks.onIncomingState(this.#incomingSummary(this.#incoming));
    }

    #notifySendProgress(outgoing, force = false) {
        const now = performance.now();
        if (!force && now - outgoing.lastProgressAt < 100) return;
        outgoing.lastProgressAt = now;
        this.#callbacks.onSendProgress(this.#outgoingSummary(outgoing));
    }

    #notifyReceiveProgress(incoming, force = false) {
        const now = performance.now();
        if (!force && now - incoming.lastProgressAt < 100) return;
        incoming.lastProgressAt = now;
        this.#callbacks.onReceiveProgress(this.#incomingSummary(incoming));
    }

    #outgoingSummary(outgoing) {
        return {
            transferId: outgoing.transferId,
            files: outgoing.metadata.map((file) => ({...file})),
            totalBytes: outgoing.totalBytes,
            sentBytes: outgoing.sentBytes,
            acknowledgedBytes: outgoing.acknowledgedBytes,
            completedFiles: outgoing.completedFiles,
            status: outgoing.status,
            reason: outgoing.reason || ''
        };
    }

    #incomingSummary(incoming) {
        return {
            transferId: incoming.transferId,
            files: incoming.metadata.map((file, index) => ({
                ...file,
                receivedBytes: incoming.files[index].receivedBytes,
                completed: incoming.files[index].completed,
                resolvedName: incoming.files[index].resolvedName
            })),
            totalBytes: incoming.totalBytes,
            receivedBytes: incoming.receivedBytes,
            completedFiles: incoming.completedFiles,
            status: incoming.status,
            mode: incoming.mode,
            reason: incoming.reason || ''
        };
    }

    #reportError(error) {
        this.#callbacks.onError(error instanceof Error ? error : new Error(String(error)));
    }
}

function validateOffer(message) {
    if (!isTransferId(message.transferId) || !Array.isArray(message.files)
            || message.files.length === 0 || message.files.length > MAX_FILES_PER_TRANSFER) {
        throw new Error('INVALID_TRANSFER_OFFER');
    }
    const metadata = message.files.map((file, index) => {
        const size = Number(file?.size);
        if (!Number.isSafeInteger(size) || size < 0) throw new Error('INVALID_TRANSFER_FILE_SIZE');
        return {
            id: index,
            name: sanitizeFileName(file?.name),
            size,
            type: String(file?.type || 'application/octet-stream').slice(0, 255),
            lastModified: Number(file?.lastModified) || 0
        };
    });
    const totalBytes = metadata.reduce((total, file) => total + file.size, 0);
    if (!Number.isSafeInteger(totalBytes) || totalBytes !== Number(message.totalBytes)) {
        throw new Error('INVALID_TRANSFER_TOTAL_SIZE');
    }
    return metadata;
}

function encodeFrame({type, transferId, fileIndex, offset, payload = null}) {
    const payloadBytes = payload ? new Uint8Array(payload) : new Uint8Array();
    const frame = new ArrayBuffer(FRAME_HEADER_BYTES + payloadBytes.byteLength);
    const view = new DataView(frame);
    view.setUint32(0, FRAME_MAGIC);
    view.setUint8(4, type);
    new Uint8Array(frame, 5, 16).set(transferIdToBytes(transferId));
    view.setUint32(21, fileIndex);
    view.setBigUint64(25, BigInt(offset));
    view.setUint32(33, payloadBytes.byteLength);
    new Uint8Array(frame, FRAME_HEADER_BYTES).set(payloadBytes);
    return frame;
}

function decodeFrame(frame) {
    if (!(frame instanceof ArrayBuffer) || frame.byteLength < FRAME_HEADER_BYTES) {
        throw new Error('INVALID_TRANSFER_FRAME');
    }
    const view = new DataView(frame);
    if (view.getUint32(0) !== FRAME_MAGIC) throw new Error('INVALID_TRANSFER_FRAME_MAGIC');
    const type = view.getUint8(4);
    const transferId = bytesToTransferId(new Uint8Array(frame, 5, 16));
    const fileIndex = view.getUint32(21);
    const offsetValue = view.getBigUint64(25);
    if (offsetValue > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('TRANSFER_OFFSET_TOO_LARGE');
    const payloadLength = view.getUint32(33);
    if (FRAME_HEADER_BYTES + payloadLength !== frame.byteLength) throw new Error('INVALID_TRANSFER_FRAME_LENGTH');
    return {
        type,
        transferId,
        fileIndex,
        offset: Number(offsetValue),
        payload: new Uint8Array(frame, FRAME_HEADER_BYTES, payloadLength)
    };
}

function createTransferId() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return bytesToTransferId(bytes);
}

function transferIdToBytes(value) {
    if (!isTransferId(value)) throw new Error('INVALID_TRANSFER_ID');
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(24, '=');
    const binary = atob(base64);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytesToTransferId(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function isTransferId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{22}$/.test(value);
}

function sanitizeFileName(value) {
    const name = String(value || 'file')
        .replace(/[\\/\0]/g, '_')
        .replace(/[. ]+$/g, '')
        .trim()
        .slice(0, 255);
    return name && name !== '.' && name !== '..' ? name : 'file';
}

function isTerminal(status) {
    return ['completed', 'rejected', 'cancelled', 'failed'].includes(status);
}

async function toArrayBuffer(value) {
    if (value instanceof ArrayBuffer) return value;
    if (ArrayBuffer.isView(value)) {
        return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    }
    if (value instanceof Blob) return value.arrayBuffer();
    throw new Error('INVALID_TRANSFER_DATA');
}

function waitForBufferedAmountLow(channel) {
    if (channel.bufferedAmount <= BUFFER_HIGH_BYTES) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timeout);
            channel.removeEventListener('bufferedamountlow', handleLow);
            channel.removeEventListener('close', handleClose);
            channel.removeEventListener('error', handleError);
        };
        const handleLow = () => {
            cleanup();
            resolve();
        };
        const handleClose = () => {
            cleanup();
            reject(new Error('DATA_CHANNEL_CLOSED'));
        };
        const handleError = () => {
            cleanup();
            reject(new Error('DATA_CHANNEL_ERROR'));
        };
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error('DATA_CHANNEL_BACKPRESSURE_TIMEOUT'));
        }, 30_000);
        channel.addEventListener('bufferedamountlow', handleLow);
        channel.addEventListener('close', handleClose);
        channel.addEventListener('error', handleError);
    });
}

async function createDirectoryTargets(directoryHandle, metadata) {
    const reserved = new Set();
    const targets = [];
    try {
        for (const file of metadata) {
            const name = await uniqueFileName(directoryHandle, file.name, reserved);
            reserved.add(name);
            targets.push({
                name,
                handle: await directoryHandle.getFileHandle(name, {create: true})
            });
        }
        return targets;
    } catch (error) {
        await removeDirectoryTargets(directoryHandle, targets);
        throw error;
    }
}

async function removeDirectoryTargets(directoryHandle, targets) {
    await Promise.allSettled(targets.map((target) => directoryHandle.removeEntry(target.name)));
}

async function uniqueFileName(directoryHandle, requestedName, reserved) {
    const {base, extension} = splitFileName(requestedName);
    for (let index = 0; index < 10_000; index += 1) {
        const candidate = index === 0 ? requestedName : `${base} (${index})${extension}`;
        if (reserved.has(candidate)) continue;
        try {
            await directoryHandle.getFileHandle(candidate);
        } catch (error) {
            if (error?.name === 'NotFoundError') return candidate;
            if (error?.name === 'TypeMismatchError') continue;
            throw error;
        }
    }
    throw new Error('UNABLE_TO_CREATE_UNIQUE_FILE_NAME');
}

function splitFileName(fileName) {
    const index = fileName.lastIndexOf('.');
    if (index <= 0) return {base: fileName, extension: ''};
    return {base: fileName.slice(0, index), extension: fileName.slice(index)};
}

async function abortIncomingWriters(incoming) {
    for (const file of incoming.files) {
        if (!file.writable) continue;
        try {
            if (typeof file.writable.abort === 'function') await file.writable.abort();
            else await file.writable.close();
        } catch {
        }
        file.writable = null;
        file.target = null;
    }
}
