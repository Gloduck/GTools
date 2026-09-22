import {normalizePreviewPath, PREVIEW_FRAME_SANDBOX, renderPreview} from './resources.js';
import {previewBridge} from './bridge.js';
import {createPreviewCapture} from './capture.js';
export {collectPreviewReferences, normalizePreviewPath, resolvePreviewUrl, PREVIEW_FRAME_SANDBOX} from './resources.js';
export {createPreviewWindow} from './window.js';

export function createPreviewSession(initialFiles) {
    let files = fileMap(initialFiles);
    let frame = null, disposed = false, revision = 0, path = '', suffix = '', content = '', ready = false, error = null;
    let requestId = 0;
    const token = crypto.randomUUID();
    const listeners = new Set(), pending = new Map();
    let errors = [];
    const capture = createPreviewCapture(() => frame, publish);
    function getState() {
        return {path, suffix, revision, content, ready, error, disposed, attached: Boolean(frame), capture: capture.getState()};
    }
    function publish() { for (const listener of listeners) listener(getState()); }
    function assertLive() { if (disposed) throw new Error('Preview session is disposed'); }
    function invalidate() {
        revision++;
        ready = false;
        for (const operation of pending.values()) operation.reject(new Error('Preview document changed'));
        pending.clear();
    }
    function waitUntilReady(current, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const finish = (failure) => {
                clearTimeout(timer);
                listeners.delete(check);
                failure ? reject(failure) : resolve(getState());
            };
            const check = () => {
                if (current !== revision || disposed) finish(new Error('Preview document changed'));
                else if (error) finish(new Error(error));
                else if (ready) finish();
            };
            const timer = setTimeout(() => finish(new Error('Preview frame did not become ready')), timeoutMs);
            listeners.add(check);
            check();
        });
    }
    async function rebuild() {
        assertLive();
        invalidate();
        const current = revision;
        errors = [];
        error = null;
        content = '';
        publish();
        if (!path) return getState();
        try {
            const bridge = `(${previewBridge.toString()})(${JSON.stringify(token)},${current},${JSON.stringify(suffix).replaceAll('<', '\\u003c')})`;
            const next = await renderPreview(files, path, bridge);
            if (current !== revision || disposed) return getState();
            content = next;
            if (frame) frame.srcdoc = content;
            publish();
            if (frame) await waitUntilReady(current);
        } catch (failure) {
            if (current !== revision || disposed) return getState();
            content = '';
            if (frame) frame.srcdoc = '';
            error = failure.message;
            publish();
            throw failure;
        }
        return getState();
    }
    function receive(event) {
        const message = event.data;
        if (!frame || event.source !== frame.contentWindow || message?.token !== token || message.revision !== revision) return;
        if (message.channel !== 'preview-session') return;
        if (message.type === 'navigate') {
            session.open(message.path + (message.suffix || '')).catch(() => {});
            return;
        }
        if (message.type === 'ready') { ready = true; publish(); }
        if (message.type === 'log' && errors.length < 200 && JSON.stringify(message.entry)?.length <= 30000) errors.push({...message.entry, path, revision});
        if (message.type === 'response' && JSON.stringify(message.result)?.length <= 30000) pending.get(message.id)?.resolve(message.result);
    }
    window.addEventListener('message', receive);
    function request(method, options = {}) {
        assertLive();
        if (!frame || !ready) return Promise.reject(new Error('Preview frame is not ready'));
        const id = ++requestId;
        const targetPath = path, targetRevision = revision;
        return new Promise((resolve, reject) => {
            const finish = (callback, value) => { clearTimeout(timer); pending.delete(id); callback(value); };
            const timer = setTimeout(() => finish(reject, Object.assign(new Error('Preview request timed out; execution is not interrupted'), {name: 'TimeoutError'})), Math.max(100, Math.min(30000, options.timeoutMs || 5000)));
            pending.set(id, {
                resolve(result) {
                    if (result.ok) finish(resolve, {path: targetPath, revision: targetRevision, value: result.value});
                    else finish(reject, Object.assign(new Error(result.error?.message || String(result.error)), result.error));
                },
                reject: (value) => finish(reject, value),
            });
            try { frame.contentWindow.postMessage({channel: 'preview-session', type: 'request', token, revision, id, method, options}, '*'); }
            catch (failure) { finish(reject, failure); }
        });
    }
    const session = {
        attachFrame(next) {
            assertLive();
            if (frame) { capture.stop(); invalidate(); frame.srcdoc = ''; }
            frame = next;
            frame.setAttribute('sandbox', PREVIEW_FRAME_SANDBOX);
            if (path) void rebuild().catch(() => {});
            publish();
            return () => {
                if (frame !== next) return;
                capture.stop();
                invalidate();
                frame.srcdoc = '';
                frame = null;
                publish();
            };
        },
        setFiles(next) {
            assertLive();
            files = fileMap(next);
            if (path && !files.has(path)) {
                invalidate();
                content = '';
                error = `File not found: ${path}`;
                errors = [];
                if (frame) frame.srcdoc = '';
                publish();
                return Promise.resolve(getState());
            }
            return rebuild();
        },
        open(next) {
            assertLive();
            const index = String(next).search(/[?#]/);
            path = normalizePreviewPath(index < 0 ? next : next.slice(0, index));
            suffix = index < 0 ? '' : next.slice(index);
            return rebuild();
        },
        refresh: rebuild,
        inspect: (options) => request('inspect', options),
        evaluate(options) {
            if (typeof options?.code !== 'string' || options.code.length > 50000) return Promise.reject(new Error('Provide an async function body of at most 50000 characters'));
            if (JSON.stringify(options.args ?? null).length > 50000) return Promise.reject(new Error('Preview arguments exceed 50000 characters'));
            return request('evaluate', options);
        },
        getErrors({limit = 100, since = 0} = {}) { return structuredClone(errors.filter((entry) => entry.timestamp >= since).slice(-Math.max(1, Math.min(200, limit)))); },
        startCapture() { assertLive(); return capture.start(); },
        stopCapture: capture.stop,
        async screenshot(options) {
            assertLive();
            const current = revision, currentPath = path;
            const deadline = Date.now() + Math.max(100, Math.min(30000, options?.timeoutMs || 5000));
            if (capture.getState().status !== 'active') throw new Error('Start preview capture first');
            await waitUntilReady(current, deadline - Date.now());
            const image = await capture.screenshot({...options, timeoutMs: deadline - Date.now()}, () => current === revision && !disposed && ready);
            return {...image, path: currentPath, revision: current};
        },
        getState,
        subscribe(listener) { assertLive(); listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
        reset() {
            assertLive();
            invalidate();
            path = suffix = content = '';
            error = null;
            errors = [];
            capture.stop();
            if (frame) frame.srcdoc = '';
            publish();
        },
        dispose() {
            if (disposed) return;
            session.reset();
            disposed = true;
            frame = null;
            files.clear();
            window.removeEventListener('message', receive);
            publish();
            listeners.clear();
        },
    };
    return session;
}

function fileMap(files) {
    if (!Array.isArray(files)) throw new TypeError('Preview files must be an array');
    const result = new Map();
    for (const file of files) {
        if (typeof file.path !== 'string' || typeof file.mimeType !== 'string' || !(typeof file.content === 'string' || file.content instanceof Blob)) throw new TypeError('Expected {path, mimeType, content: string | Blob}');
        const path = normalizePreviewPath(file.path);
        if (result.has(path)) throw new Error(`Duplicate preview path: ${path}`);
        result.set(path, {...file, path});
    }
    return result;
}
