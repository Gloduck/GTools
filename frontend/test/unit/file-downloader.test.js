import assert from 'node:assert/strict';
import test from 'node:test';
import {unzipSync} from 'fflate';
import {
    downloadDirectory,
    downloadFile,
    normalizeDownloadEntries,
} from '../../src/shared/file-downloader.js';
import {createZipStream} from '../../src/shared/zip-stream.js';

test('场景：文件保存选择器优先于其他下载方式并在选择后打开源流', async () => {
    const events = [];
    const chunks = [];
    await withGlobals({
        isSecureContext: true,
        showSaveFilePicker: async () => {
            events.push('picker');
            return {
                async createWritable() {
                    return {
                        async write(chunk) {
                            chunks.push(chunk);
                        },
                        async close() {
                            events.push('close');
                        },
                        async abort() {
                        },
                    };
                },
            };
        },
    }, async () => {
        const result = await downloadFile({
            fileName: 'alpha.txt',
            openStream: () => {
                events.push('source');
                return new Blob(['alpha']).stream();
            },
        });
        assert.equal(result.method, 'file-access');
    });

    assert.deepEqual(events, ['picker', 'source', 'close']);
    assert.equal(await new Blob(chunks).text(), 'alpha');
});

test('场景：已知大小超过 Blob 上限时不打开源流', async () => {
    let opened = false;
    await withGlobals({isSecureContext: false}, async () => {
        await assert.rejects(downloadFile({
            fileName: 'large.bin',
            size: 5,
            maxBlobBytes: 4,
            openStream: () => {
                opened = true;
                return new Blob(['large']).stream();
            },
        }), (error) => error?.code === 'DOWNLOAD_BLOB_SIZE_LIMIT_EXCEEDED');
    });
    assert.equal(opened, false);
});

test('场景：用户取消文件选择后不打开源流或继续回退', async () => {
    let opened = false;
    await withGlobals({
        isSecureContext: true,
        showSaveFilePicker: async () => {
            throw new DOMException('Cancelled', 'AbortError');
        },
    }, async () => {
        await assert.rejects(downloadFile({
            fileName: 'cancelled.txt',
            openStream: () => {
                opened = true;
                return emptyStream();
            },
        }), (error) => error?.name === 'AbortError');
    });
    assert.equal(opened, false);
});

test('场景：未知大小超过 Blob 上限时取消源流', async () => {
    let cancelled = false;
    await withBrowserDownloadGlobals(async () => {
        await assert.rejects(downloadFile({
            fileName: 'large.bin',
            maxBlobBytes: 3,
            openStream: () => new ReadableStream({
                pull(controller) {
                    controller.enqueue(new Uint8Array([1, 2, 3, 4]));
                },
                cancel() {
                    cancelled = true;
                },
            }),
        }), (error) => error?.code === 'DOWNLOAD_BLOB_SIZE_LIMIT_EXCEEDED');
    });
    assert.equal(cancelled, true);
});

test('场景：打开源流后发现声明大小超限时主动取消源流', async () => {
    let cancelled = false;
    await withBrowserDownloadGlobals(async () => {
        await assert.rejects(downloadFile({
            fileName: 'declared-large.bin',
            maxBlobBytes: 3,
            openStream: () => ({
                size: 4,
                stream: new ReadableStream({cancel() { cancelled = true; }}),
            }),
        }), (error) => error?.code === 'DOWNLOAD_BLOB_SIZE_LIMIT_EXCEEDED');
    });
    assert.equal(cancelled, true);
});

test('场景：Blob 下载完成后释放对象 URL', async () => {
    const clicked = [];
    const revoked = [];
    await withBrowserDownloadGlobals(async ({links}) => {
        links.click = (link) => clicked.push({href: link.href, download: link.download});
        links.revoke = (url) => revoked.push(url);
        const result = await downloadFile({
            fileName: 'alpha.txt',
            openStream: () => new Blob(['alpha'], {type: 'text/plain'}).stream(),
        });
        assert.equal(result.method, 'blob');
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.deepEqual(clicked, [{href: 'blob:test-download', download: 'alpha.txt'}]);
    assert.deepEqual(revoked, ['blob:test-download']);
});

test('场景：目录路径拒绝重复项、父文件冲突和目录穿越', () => {
    assert.throws(() => normalizeDownloadEntries([
        {path: 'a.txt', openStream: emptyStream},
        {path: 'a.txt', openStream: emptyStream},
    ]), /Duplicate download path/);
    assert.throws(() => normalizeDownloadEntries([
        {path: 'folder', openStream: emptyStream},
        {path: 'folder/file.txt', openStream: emptyStream},
    ]), /conflicts with a file/);
    assert.throws(() => normalizeDownloadEntries([
        {path: '../secret.txt', openStream: emptyStream},
    ]), /Invalid download path/);
});

test('场景：流式 ZIP 保留文件路径和空目录', async () => {
    const stream = createZipStream([
        {path: 'src/main.js', openStream: () => new Blob(['main']).stream()},
        {path: 'empty', directory: true},
    ]);
    const archive = unzipSync(new Uint8Array(await new Response(stream).arrayBuffer()));
    assert.equal(new TextDecoder().decode(archive['src/main.js']), 'main');
    assert.ok(archive['empty/']);
});

test('场景：目录下载通过文件系统逐个创建目录并写入文件流', async () => {
    const root = new MockDirectoryHandle('selected');
    await withGlobals({
        isSecureContext: true,
        showDirectoryPicker: async () => root,
    }, async () => {
        const result = await downloadDirectory({
            name: 'project',
            entries: [
                {path: 'src/main.js', size: 4, openStream: () => new Blob(['main']).stream()},
                {path: 'empty', directory: true},
            ],
        });
        assert.equal(result.method, 'file-access');
    });

    const project = root.directories.get('project');
    assert.equal(await project.directories.get('src').files.get('main.js').blob.text(), 'main');
    assert.ok(project.directories.has('empty'));
});

test('场景：目录 Blob 回退在公共组件内生成保留路径的 ZIP', async () => {
    let archiveBlob = null;
    await withBrowserDownloadGlobals(async ({links}) => {
        links.captureBlob = (blob) => {
            archiveBlob = blob;
        };
        const result = await downloadDirectory({
            name: 'project',
            entries: [
                {path: 'src/main.js', openStream: () => new Blob(['main']).stream()},
                {path: 'empty', directory: true},
            ],
        });
        assert.equal(result.method, 'blob');
    });

    const archive = unzipSync(new Uint8Array(await archiveBlob.arrayBuffer()));
    assert.equal(new TextDecoder().decode(archive['src/main.js']), 'main');
    assert.ok(archive['empty/']);
});

test('场景：Service Worker 下载在 started 后流式写入', async () => {
    const worker = new MockDownloadWorker();
    const events = [];
    worker.events = events;
    const serviceWorker = new EventTarget();
    const registration = {active: worker};
    serviceWorker.controller = null;
    serviceWorker.ready = Promise.resolve(registration);
    serviceWorker.register = async () => {
        setTimeout(() => {
            events.push('controlled');
            serviceWorker.controller = worker;
            serviceWorker.dispatchEvent(new Event('controllerchange'));
        }, 0);
        return registration;
    };
    await withGlobals({
        isSecureContext: true,
        navigator: {serviceWorker},
        location: {origin: 'https://example.test'},
    }, async () => {
        await withDocument((link) => worker.start(link), async () => {
            const result = await downloadFile({
                fileName: 'stream.bin',
                openStream: () => {
                    events.push('source');
                    return new Blob([new Uint8Array([1, 2, 3])]).stream();
                },
            });
            assert.equal(result.method, 'service-worker');
            assert.deepEqual([...await worker.bytes], [1, 2, 3]);
        });
    });
    assert.deepEqual(events, ['controlled', 'started', 'source']);
});

async function withBrowserDownloadGlobals(run) {
    const links = {click: () => {}, revoke: () => {}, captureBlob: () => {}};
    return withGlobals({isSecureContext: false}, () => withDocument((link) => links.click(link), async () => {
        const createDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
        const revokeDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
        Object.defineProperty(URL, 'createObjectURL', {configurable: true, value: (blob) => {
            links.captureBlob(blob);
            return 'blob:test-download';
        }});
        Object.defineProperty(URL, 'revokeObjectURL', {configurable: true, value: (url) => links.revoke(url)});
        try {
            return await run({links});
        } finally {
            restoreProperty(URL, 'createObjectURL', createDescriptor);
            restoreProperty(URL, 'revokeObjectURL', revokeDescriptor);
        }
    }));
}

async function withDocument(click, run) {
    const document = {
        body: {
            appendChild(element) {
                if (element.tagName === 'IFRAME') click(element);
            },
        },
        createElement(tagName) {
            return {
                tagName: String(tagName).toUpperCase(),
                href: '',
                src: '',
                download: '',
                hidden: false,
                style: {},
                click() {
                    click(this);
                },
                remove() {
                },
            };
        },
    };
    return withGlobals({document}, run);
}

async function withGlobals(values, run) {
    const descriptors = new Map();
    for (const [key, value] of Object.entries(values)) {
        descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
        Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
    }
    try {
        return await run();
    } finally {
        for (const [key, descriptor] of descriptors) restoreProperty(globalThis, key, descriptor);
    }
}

function restoreProperty(target, key, descriptor) {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete target[key];
}

function emptyStream() {
    return new Blob([]).stream();
}

class MockDirectoryHandle {
    constructor(name) {
        this.name = name;
        this.directories = new Map();
        this.files = new Map();
    }

    async getDirectoryHandle(name, options = {}) {
        if (this.directories.has(name)) return this.directories.get(name);
        if (!options.create) throw new DOMException('Not found', 'NotFoundError');
        const directory = new MockDirectoryHandle(name);
        this.directories.set(name, directory);
        return directory;
    }

    async getFileHandle(name, options = {}) {
        if (this.files.has(name)) return this.files.get(name);
        if (!options.create) throw new DOMException('Not found', 'NotFoundError');
        const file = new MockFileHandle(name);
        this.files.set(name, file);
        return file;
    }
}

class MockFileHandle {
    constructor(name) {
        this.name = name;
        this.blob = new Blob([]);
    }

    async createWritable() {
        const chunks = [];
        return new WritableStream({
            write: (chunk) => chunks.push(chunk),
            close: () => {
                this.blob = new Blob(chunks);
            },
        });
    }
}

class MockDownloadWorker {
    constructor() {
        this.port = null;
        this.stream = null;
        this.bytes = Promise.resolve(new Uint8Array());
    }

    postMessage(message, transfer) {
        if (message.type === 'stream-download:dispose') return;
        this.stream = message.stream;
        this.port = transfer[1];
        this.port.postMessage({type: 'registered'});
    }

    start() {
        this.events?.push('started');
        this.port.postMessage({type: 'started'});
        this.bytes = new Response(this.stream).arrayBuffer().then((buffer) => new Uint8Array(buffer));
    }
}
