(() => {
    const BASE_PATH = new URL('./', self.location.href).pathname;
    const DOWNLOAD_PREFIX = `${BASE_PATH}__stream_download__/`;
    const CREATE_MESSAGE = 'stream-download:create';
    const DISPOSE_MESSAGE = 'stream-download:dispose';
    const ENTRY_LIFETIME_MS = 60_000;
    const downloads = new Map();

    self.addEventListener('message', (event) => {
        const message = event.data;
        if (message?.type === CREATE_MESSAGE) registerDownload(message, event.ports[0]);
        else if (message?.type === DISPOSE_MESSAGE) disposeDownload(message.id, 'Download was disposed');
    });

    self.addEventListener('fetch', (event) => {
        const url = new URL(event.request.url);
        if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(DOWNLOAD_PREFIX)) return;
        event.respondWith(takeDownloadResponse(decodeURIComponent(url.pathname.slice(DOWNLOAD_PREFIX.length))));
    });

    function registerDownload(message, port) {
        if (!message.id || !message.stream || !port) return;
        disposeDownload(message.id, 'Download was replaced');
        const entry = {
            stream: message.stream,
            port,
            fileName: message.fileName || 'download',
            mimeType: message.mimeType || 'application/octet-stream',
            size: normalizeSize(message.size),
            timer: null,
        };
        entry.timer = setTimeout(() => disposeDownload(message.id, 'Download registration expired'), ENTRY_LIFETIME_MS);
        downloads.set(message.id, entry);
        port.postMessage({type: 'registered'});
    }

    function takeDownloadResponse(id) {
        const entry = downloads.get(id);
        if (!entry) return new Response('Stream download is unavailable', {status: 404});
        downloads.delete(id);
        clearTimeout(entry.timer);
        entry.port.postMessage({type: 'started'});
        entry.port.close();

        const headers = new Headers({
            'Content-Type': entry.mimeType,
            'Content-Disposition': contentDisposition(entry.fileName),
            'Cache-Control': 'no-store',
        });
        if (entry.size != null) headers.set('Content-Length', String(entry.size));
        return new Response(entry.stream, {headers});
    }

    function disposeDownload(id, reason) {
        const entry = downloads.get(id);
        if (!entry) return;
        downloads.delete(id);
        clearTimeout(entry.timer);
        entry.port.close();
        Promise.resolve(entry.stream.cancel(reason)).catch(() => {});
    }

    function contentDisposition(value) {
        const fileName = String(value || 'download');
        const asciiName = [...fileName].map((character) => {
            const code = character.charCodeAt(0);
            return code >= 0x20 && code <= 0x7e && character !== '"' && character !== '\\' ? character : '_';
        }).join('') || 'download';
        const encodedName = encodeURIComponent(fileName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
        return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
    }

    function normalizeSize(value) {
        if (value == null || value === '') return null;
        const size = Number(value);
        return Number.isFinite(size) && size >= 0 ? size : null;
    }
})();
