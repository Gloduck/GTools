import {createZipStream} from './zip-stream.js';

const BASE_PATH = import.meta.env?.BASE_URL || '/';
const STREAM_DOWNLOAD_PREFIX = `${BASE_PATH}__stream_download__/`;
const STREAM_DOWNLOAD_CREATE = 'stream-download:create';
const STREAM_DOWNLOAD_DISPOSE = 'stream-download:dispose';
const STREAM_DOWNLOAD_TIMEOUT_MS = 10_000;
const STREAM_DOWNLOAD_CONTROL_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BLOB_DOWNLOAD_BYTES = 256 * 1024 * 1024;
let serviceWorkerRegistrationPromise = null;
let fallbackDownloadId = 0;

async function prepareDownload({
    fileName = 'download',
    size = null,
    mimeType = 'application/octet-stream',
    signal,
    onProgress,
    maxBlobBytes = DEFAULT_MAX_BLOB_DOWNLOAD_BYTES,
    allowFileAccess = true,
    validateFileHandle,
} = {}) {
    throwIfAborted(signal);
    const normalizedSize = normalizeSize(size);

    if (allowFileAccess && canUseFilePicker()) {
        return prepareFileAccessTarget({fileName, size: normalizedSize, signal, onProgress, validateFileHandle});
    }

    const worker = await getDownloadServiceWorker();
    if (worker) {
        try {
            return await prepareServiceWorkerTarget(worker, {fileName, size: normalizedSize, mimeType, signal, onProgress});
        } catch (error) {
            if (signal?.aborted) throw abortError(signal.reason);
            console.warn('Stream download service worker is unavailable, using Blob fallback.', error);
        }
    }

    return prepareBlobTarget({fileName, size: normalizedSize, mimeType, signal, onProgress, maxBlobBytes});
}

async function downloadFile({
    fileName = 'download',
    size = null,
    mimeType = 'application/octet-stream',
    openStream,
    signal,
    onProgress,
    maxBlobBytes = DEFAULT_MAX_BLOB_DOWNLOAD_BYTES,
    allowFileAccess = true,
    validateFileHandle,
} = {}) {
    if (typeof openStream !== 'function') throw new TypeError('openStream must be a function');
    throwIfAborted(signal);

    let target = null;
    let source = null;
    let piping = false;
    try {
        target = await prepareDownload({
            fileName,
            size,
            mimeType,
            signal,
            onProgress,
            maxBlobBytes,
            allowFileAccess,
            validateFileHandle,
        });
        source = await resolveDownloadSource(await openStream(), {fileName, size, mimeType});
        target.setTotal(source.size);
        piping = true;
        await source.stream.pipeTo(target.writable, signal ? {signal} : undefined);
        return await target.completed;
    } catch (error) {
        if (source?.stream && !piping && !source.stream.locked) {
            try {
                await source.stream.cancel(error);
            } catch {
            }
        }
        if (target && !target.done) await target.abort(error);
        throw error;
    } finally {
        source = null;
        target = null;
    }
}

async function downloadDirectory({
    name = 'download',
    entries,
    signal,
    onProgress,
    maxBlobBytes = DEFAULT_MAX_BLOB_DOWNLOAD_BYTES,
    allowDirectoryAccess = true,
} = {}) {
    const normalizedEntries = normalizeDownloadEntries(entries);
    throwIfAborted(signal);

    if (allowDirectoryAccess && canUseDirectoryPicker()) {
        const parent = await globalThis.showDirectoryPicker({mode: 'readwrite'});
        const directoryName = sanitizeFileName(name);
        const root = await createUniqueDirectory(parent, directoryName);
        let loaded = 0;
        const total = sumKnownSizes(normalizedEntries);

        for (const entry of normalizedEntries) {
            throwIfAborted(signal);
            if (entry.directory) {
                await ensureDirectory(root, entry.path);
                continue;
            }

            const {directory, fileName} = await resolveDirectoryFile(root, entry.path);
            const handle = await directory.getFileHandle(fileName, {create: true});
            const writable = await handle.createWritable();
            try {
                const stream = await entry.openStream();
                if (!(stream instanceof ReadableStream)) throw new TypeError(`Directory entry must provide a ReadableStream: ${entry.path}`);
                const progress = stream.pipeThrough(new TransformStream({
                    transform(chunk, controller) {
                        const bytes = toBytes(chunk);
                        loaded += bytes.byteLength;
                        onProgress?.(loaded, total);
                        controller.enqueue(bytes);
                    },
                }));
                await progress.pipeTo(writable, signal ? {signal} : undefined);
            } catch (error) {
                try {
                    await writable.abort(error);
                } catch {
                }
                throw error;
            }
        }

        onProgress?.(loaded, total || loaded);
        return {method: 'file-access', bytes: loaded, name: root.name || directoryName};
    }

    return downloadFile({
        fileName: `${sanitizeFileName(name)}.zip`,
        mimeType: 'application/zip',
        openStream: () => createZipStream(normalizedEntries, {signal}),
        signal,
        onProgress,
        maxBlobBytes,
        allowFileAccess: false,
    });
}

async function prepareFileAccessTarget({fileName, size, signal, onProgress, validateFileHandle}) {
    throwIfAborted(signal);
    const handle = await globalThis.showSaveFilePicker({suggestedName: fileName});
    throwIfAborted(signal);
    await validateFileHandle?.(handle);
    const writable = await handle.createWritable();
    return createManagedTarget({
        method: 'file-access',
        fileName,
        size,
        signal,
        onProgress,
        sink: {
            write: (chunk) => writable.write(chunk),
            close: () => writable.close(),
            abort: (reason) => writable.abort(reason),
        },
    });
}

async function prepareServiceWorkerTarget(worker, {fileName, size, mimeType, signal, onProgress}) {
    throwIfAborted(signal);
    const transform = new TransformStream();
    const writer = transform.writable.getWriter();
    const channel = new MessageChannel();
    const id = createDownloadId();
    let registered = false;
    let started = false;

    const waitFor = (expected) => {
        let settled = false;
        let rejectPromise;
        const handleMessage = (event) => {
            if (event.data?.type !== expected) return;
            finish(resolvePromise);
        };
        const handleAbort = () => finish(rejectPromise, abortError(signal.reason));
        const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            channel.port1.removeEventListener('message', handleMessage);
            signal?.removeEventListener('abort', handleAbort);
            callback(value);
        };
        let resolvePromise;
        const promise = new Promise((resolve, reject) => {
            resolvePromise = resolve;
            rejectPromise = reject;
        });
        const timer = setTimeout(() => finish(rejectPromise, new Error(`Timed out waiting for ${expected}`)), STREAM_DOWNLOAD_TIMEOUT_MS);
        channel.port1.addEventListener('message', handleMessage);
        signal?.addEventListener('abort', handleAbort, {once: true});
        channel.port1.start?.();
        return {promise, cancel: () => finish(resolvePromise)};
    };

    let pendingMessage = null;
    try {
        pendingMessage = waitFor('registered');
        worker.postMessage({
            type: STREAM_DOWNLOAD_CREATE,
            id,
            fileName,
            mimeType,
            size,
            stream: transform.readable,
        }, [transform.readable, channel.port2]);
        await pendingMessage.promise;
        pendingMessage = null;
        registered = true;

        pendingMessage = waitFor('started');
        triggerStreamDownloadUrl(`${location.origin}${STREAM_DOWNLOAD_PREFIX}${encodeURIComponent(id)}`);
        await pendingMessage.promise;
        pendingMessage = null;
        started = true;
        channel.port1.close();
    } catch (error) {
        pendingMessage?.cancel();
        worker.postMessage({type: STREAM_DOWNLOAD_DISPOSE, id});
        channel.port1.close();
        try {
            await writer.abort(error);
        } catch {
        }
        throw error;
    }

    return createManagedTarget({
        method: 'service-worker',
        fileName,
        size,
        signal,
        onProgress,
        sink: {
            write: (chunk) => writer.write(chunk),
            close: () => writer.close(),
            abort: async (reason) => {
                if (registered && !started) worker.postMessage({type: STREAM_DOWNLOAD_DISPOSE, id});
                await writer.abort(reason);
            },
        },
    });
}

function prepareBlobTarget({fileName, size, mimeType, signal, onProgress, maxBlobBytes}) {
    if (!Number.isFinite(maxBlobBytes) || maxBlobBytes < 0) throw new RangeError('maxBlobBytes must be a non-negative finite number');
    if (size != null && size > maxBlobBytes) throw createBlobSizeLimitError(size, maxBlobBytes);
    let chunks = [];
    let bytes = 0;

    return createManagedTarget({
        method: 'blob',
        fileName,
        size,
        signal,
        onProgress,
        sink: {
            write(chunk) {
                bytes += chunk.byteLength;
                if (bytes > maxBlobBytes) throw createBlobSizeLimitError(bytes, maxBlobBytes);
                chunks.push(chunk);
            },
            close() {
                const blob = new Blob(chunks, {type: mimeType});
                chunks = [];
                triggerBlobDownload(blob, fileName);
            },
            abort() {
                chunks = [];
                bytes = 0;
            },
            setTotal(value) {
                if (value != null && value > maxBlobBytes) throw createBlobSizeLimitError(value, maxBlobBytes);
            },
        },
        cleanup() {
            chunks = [];
            bytes = 0;
        },
    });
}

function createManagedTarget({method, fileName, size, signal, onProgress, sink, cleanup = () => {}}) {
    let state = 'ready';
    let loaded = 0;
    let total = size;
    let resolveCompleted;
    let rejectCompleted;
    const completed = new Promise((resolve, reject) => {
        resolveCompleted = resolve;
        rejectCompleted = reject;
    });
    completed.catch(() => {});

    const finish = () => {
        cleanup();
        signal?.removeEventListener('abort', handleAbort);
    };
    const fail = async (reason) => {
        if (state === 'closed' || state === 'aborted') return;
        state = 'aborted';
        const error = reason instanceof Error ? reason : new Error(String(reason || 'Download aborted'));
        try {
            await sink.abort?.(error);
        } catch {
        } finally {
            finish();
            rejectCompleted(error);
        }
    };
    const write = async (chunk) => {
        if (state !== 'ready' && state !== 'writing') throw new Error('Download target is not writable');
        state = 'writing';
        const bytes = toBytes(chunk);
        try {
            await sink.write(bytes);
            loaded += bytes.byteLength;
            onProgress?.(loaded, total);
        } catch (error) {
            await fail(error);
            throw error;
        }
    };
    const close = async () => {
        if (state === 'closed') return;
        if (state === 'aborted') return completed;
        try {
            await sink.close();
            state = 'closed';
            onProgress?.(loaded, total ?? loaded);
            const result = {method, bytes: loaded, name: fileName};
            finish();
            resolveCompleted(result);
        } catch (error) {
            await fail(error);
            throw error;
        }
    };
    const handleAbort = () => void fail(abortError(signal.reason));
    signal?.addEventListener('abort', handleAbort, {once: true});

    const writable = new WritableStream({write, close, abort: fail});
    return {
        method,
        writable,
        completed,
        write,
        close,
        abort: fail,
        setTotal(value) {
            total = normalizeSize(value);
            sink.setTotal?.(total);
        },
        get done() {
            return state === 'closed' || state === 'aborted';
        },
    };
}

async function resolveDownloadSource(value, defaults) {
    let stream = value;
    let fileName = defaults.fileName;
    let size = normalizeSize(defaults.size);
    let mimeType = defaults.mimeType || 'application/octet-stream';

    if (value instanceof Response) {
        if (!value.body) throw new Error('Download response body is unavailable');
        stream = value.body;
        size = responseSize(value) ?? size;
        mimeType = value.headers.get('content-type') || mimeType;
    } else if (value instanceof Blob) {
        stream = value.stream();
        size = value.size;
        mimeType = value.type || mimeType;
    } else if (!(value instanceof ReadableStream) && value && typeof value === 'object') {
        stream = value.stream || value.body;
        fileName = value.fileName || value.name || fileName;
        size = normalizeSize(value.size) ?? size;
        mimeType = value.mimeType || value.type || mimeType;
    }

    if (!(stream instanceof ReadableStream)) throw new TypeError('Download source must provide a ReadableStream');
    return {stream, fileName: sanitizeFileName(fileName), size, mimeType};
}

function normalizeDownloadEntries(entries) {
    const values = Array.from(entries || []);
    const paths = new Map();

    return values.map((entry) => {
        const directory = Boolean(entry?.directory);
        const path = normalizeEntryPath(entry?.path, directory);
        const segments = path.split('/');
        for (let index = 1; index < segments.length; index += 1) {
            const parent = segments.slice(0, index).join('/');
            if (paths.get(parent) === 'file') throw new Error(`Directory path conflicts with a file: ${parent}`);
            if (!paths.has(parent)) paths.set(parent, 'directory');
        }
        if (paths.has(path)) throw new Error(`Duplicate download path: ${path}`);
        paths.set(path, directory ? 'directory' : 'file');
        if (!directory && typeof entry?.openStream !== 'function') throw new TypeError(`File entry must provide openStream(): ${path}`);
        return {
            path,
            directory,
            size: normalizeSize(entry?.size),
            mimeType: entry?.mimeType || 'application/octet-stream',
            openStream: entry?.openStream,
        };
    });
}

function normalizeEntryPath(value, directory) {
    const input = String(value || '').replaceAll('\\', '/').trim();
    if (!input || input.startsWith('/') || /^[A-Za-z]:\//.test(input)) throw new Error(`Invalid download path: ${input || '(empty)'}`);
    const segments = input.split('/').filter((segment) => segment && segment !== '.');
    if (!segments.length || segments.some((segment) => segment === '..' || segment.includes('\0'))) throw new Error(`Invalid download path: ${input}`);
    const path = segments.join('/');
    if (new TextEncoder().encode(path).byteLength > 65_535) throw new Error(`Download path is too long: ${input}`);
    return directory ? path.replace(/\/+$/, '') : path;
}

async function getDownloadServiceWorker() {
    if (import.meta.env?.DEV || !globalThis.isSecureContext || !globalThis.navigator?.serviceWorker || typeof TransformStream !== 'function') return null;
    if (!serviceWorkerRegistrationPromise) {
        serviceWorkerRegistrationPromise = navigator.serviceWorker.register(
            new URL('sw.js', new URL(BASE_PATH, location.origin)),
            {scope: BASE_PATH},
        )
            .then(() => navigator.serviceWorker.ready)
            .catch(() => null);
    }
    const registration = await serviceWorkerRegistrationPromise;
    if (!registration?.active) return null;
    if (navigator.serviceWorker.controller) return navigator.serviceWorker.controller;
    return waitForServiceWorkerController();
}

function waitForServiceWorkerController() {
    const serviceWorker = navigator.serviceWorker;
    if (typeof serviceWorker.addEventListener !== 'function') return Promise.resolve(null);
    return new Promise((resolve) => {
        let settled = false;
        const finish = (controller) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            serviceWorker.removeEventListener('controllerchange', handleControllerChange);
            resolve(controller);
        };
        const handleControllerChange = () => {
            if (serviceWorker.controller) finish(serviceWorker.controller);
        };
        const timer = setTimeout(() => finish(null), STREAM_DOWNLOAD_CONTROL_TIMEOUT_MS);
        serviceWorker.addEventListener('controllerchange', handleControllerChange);
        handleControllerChange();
    });
}

function canUseFilePicker() {
    return Boolean(globalThis.isSecureContext && typeof globalThis.showSaveFilePicker === 'function');
}

function canUseDirectoryPicker() {
    return Boolean(globalThis.isSecureContext && typeof globalThis.showDirectoryPicker === 'function');
}

function triggerDownloadUrl(url, fileName) {
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function triggerStreamDownloadUrl(url) {
    const frame = document.createElement('iframe');
    frame.src = url;
    frame.hidden = true;
    frame.style.display = 'none';
    document.body.appendChild(frame);
}

function triggerBlobDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    triggerDownloadUrl(url, fileName);
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

function createDownloadId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return crypto.randomUUID();
    fallbackDownloadId += 1;
    return `${Date.now()}-${fallbackDownloadId}`;
}

function createBlobSizeLimitError(size, maxBytes = DEFAULT_MAX_BLOB_DOWNLOAD_BYTES) {
    return Object.assign(new Error(`Blob download exceeds the ${maxBytes}-byte limit`), {
        code: 'DOWNLOAD_BLOB_SIZE_LIMIT_EXCEEDED',
        size: normalizeSize(size),
        maxBytes,
    });
}

function normalizeSize(value) {
    if (value == null || value === '') return null;
    const size = Number(value);
    return Number.isFinite(size) && size >= 0 ? size : null;
}

function responseSize(response) {
    return normalizeSize(response.headers.get('content-length'));
}

function sumKnownSizes(entries) {
    let total = 0;
    for (const entry of entries) {
        if (entry.directory) continue;
        if (entry.size == null) return null;
        total += entry.size;
    }
    return total;
}

async function createUniqueDirectory(parent, requestedName) {
    const {base, extension} = splitFileName(requestedName);
    for (let index = 0; index < 10_000; index += 1) {
        const name = index === 0 ? requestedName : `${base} (${index})${extension}`;
        try {
            await parent.getDirectoryHandle(name);
        } catch (error) {
            if (error?.name === 'NotFoundError') return parent.getDirectoryHandle(name, {create: true});
            if (error?.name === 'TypeMismatchError') continue;
            throw error;
        }
    }
    throw new Error('Unable to create a unique download directory');
}

async function ensureDirectory(root, path) {
    let current = root;
    for (const segment of path.split('/')) current = await current.getDirectoryHandle(segment, {create: true});
    return current;
}

async function resolveDirectoryFile(root, path) {
    const segments = path.split('/');
    const fileName = segments.pop();
    let directory = root;
    for (const segment of segments) directory = await directory.getDirectoryHandle(segment, {create: true});
    return {directory, fileName};
}

function sanitizeFileName(value) {
    const name = String(value || 'download').replace(/[\\/\0]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 255);
    return name && name !== '.' && name !== '..' ? name : 'download';
}

function splitFileName(fileName) {
    const index = fileName.lastIndexOf('.');
    if (index <= 0) return {base: fileName, extension: ''};
    return {base: fileName.slice(0, index), extension: fileName.slice(index)};
}

function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    throw new TypeError('Download streams must emit byte chunks');
}

function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError(signal.reason);
}

function abortError(reason) {
    if (reason?.name === 'AbortError') return reason;
    return Object.assign(new Error(reason?.message || 'The operation was aborted'), {name: 'AbortError'});
}

export {
    DEFAULT_MAX_BLOB_DOWNLOAD_BYTES,
    createBlobSizeLimitError,
    downloadDirectory,
    downloadFile,
    normalizeDownloadEntries,
    prepareDownload,
};
