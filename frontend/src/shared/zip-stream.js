import {Zip, ZipPassThrough} from 'fflate';

const EMPTY_BYTES = new Uint8Array();

function createZipStream(entries, {signal} = {}) {
    const transform = new TransformStream();
    const writer = transform.writable.getWriter();
    let zip = null;
    let currentReader = null;
    let stopped = false;
    let output = Promise.resolve();

    const stop = async (reason) => {
        if (stopped) return;
        stopped = true;
        zip?.terminate();
        try {
            await currentReader?.cancel(reason);
        } catch {
        }
    };

    zip = new Zip((error, chunk, final) => {
        output = output.then(async () => {
            if (error) throw error;
            if (chunk?.byteLength) await writer.write(chunk);
            if (final) await writer.close();
        });
    });

    const abort = () => {
        const reason = abortError(signal?.reason);
        void stop(reason).then(() => writer.abort(reason)).catch(() => {});
    };
    signal?.addEventListener('abort', abort, {once: true});
    writer.closed.catch((error) => stop(error));

    void (async () => {
        try {
            for (const entry of entries) {
                if (signal?.aborted) throw abortError(signal.reason);
                const name = entry.directory && !entry.path.endsWith('/') ? `${entry.path}/` : entry.path;
                const file = new ZipPassThrough(name);
                if (entry.directory) file.attrs = 0x10;
                zip.add(file);
                await output;

                if (!entry.directory) {
                    const stream = await entry.openStream();
                    if (!(stream instanceof ReadableStream)) throw new TypeError(`ZIP entry must provide a ReadableStream: ${entry.path}`);
                    currentReader = stream.getReader();
                    try {
                        while (true) {
                            if (signal?.aborted) throw abortError(signal.reason);
                            const {done, value} = await currentReader.read();
                            if (done) break;
                            file.push(toBytes(value));
                            await output;
                        }
                    } finally {
                        currentReader.releaseLock();
                        currentReader = null;
                    }
                }

                file.push(EMPTY_BYTES, true);
                await output;
            }

            zip.end();
            await output;
        } catch (error) {
            await stop(error);
            try {
                await writer.abort(error);
            } catch {
            }
        } finally {
            signal?.removeEventListener('abort', abort);
            currentReader = null;
            zip = null;
        }
    })();

    return transform.readable;
}

function toBytes(value) {
    if (value instanceof Uint8Array) return value;
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    throw new TypeError('Download streams must emit byte chunks');
}

function abortError(reason) {
    if (reason?.name === 'AbortError') return reason;
    return Object.assign(new Error(reason?.message || 'The operation was aborted'), {name: 'AbortError'});
}

export {createZipStream};
