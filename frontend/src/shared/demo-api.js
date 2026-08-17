const DEMO_CLIPBOARD_ID = 'demo';

const demoClipboard = new Map([
    [DEMO_CLIPBOARD_ID, {
        id: DEMO_CLIPBOARD_ID,
        contentType: 'text',
        demoContent: true,
        createDate: Date.now(),
        updateDate: Date.now(),
    }],
]);

const torrentItems = [
    {
        id: 'demo-linux-image',
        names: {
            'zh-CN': '示例 Linux 发行版镜像',
            'en-US': 'Example Linux Distribution Image',
        },
        hash: '0123456789ABCDEF0123456789ABCDEF01234567',
        size: 2_147_483_648,
        uploadTime: '2026-08-01T12:00:00.000Z',
    },
    {
        id: 'demo-open-data',
        names: {
            'zh-CN': '示例开放数据归档',
            'en-US': 'Example Open Data Archive',
        },
        hash: '89ABCDEF0123456789ABCDEF0123456789ABCDEF',
        size: 734_003_200,
        uploadTime: '2026-07-20T08:30:00.000Z',
    },
];

const demoHandlers = {
    'GET /api/torrent/listHandlers': () => successResponse([
        {
            code: 'demo',
            url: 'https://example.com',
            available: true,
            tags: ['demo'],
            supportSortFields: ['name', 'uploadTime', 'size'],
        },
    ]),
    'GET /api/torrent/search': (url, _init, _input, locale) => {
        const keyword = url.searchParams.get('keyword')?.trim();
        const items = torrentItems.map((item) => ({
            ...item,
            name: keyword ? `${keyword} - ${item.names[locale]}` : item.names[locale],
            names: undefined,
        }));
        return successResponse({
            index: Number(url.searchParams.get('pageIndex') || 1),
            hasNext: false,
            items,
        });
    },
    'GET /api/torrent/queryDetail': (url, _init, _input, locale) => {
        const item = torrentItems.find((value) => value.id === url.searchParams.get('id')) || torrentItems[0];
        return successResponse({
            ...item,
            name: item.names[locale],
            names: undefined,
            fileCount: 3,
            files: [
                {name: 'README.txt', size: 4_096},
                {name: 'checksums.txt', size: 1_024},
                {name: `${item.id}.iso`, size: item.size - 5_120},
            ],
        });
    },
    'GET /api/github/hotSearches': () => successResponse([
        'vuejs/core',
        'quarkusio/quarkus',
        'microsoft/vscode',
    ]),
    'GET /api/clipboard/query': (url, _init, _input, locale) => {
        const value = cloneValue(demoClipboard.get(url.searchParams.get('id'))) || null;
        if (value?.demoContent) {
            value.content = locale === 'zh-CN'
                ? '欢迎体验 GTools 网络剪贴板演示。'
                : 'Welcome to the GTools online clipboard demo.';
            delete value.demoContent;
        }
        return successResponse(value);
    },
    'POST /api/clipboard/save': async (_url, init, input) => {
        const body = await readJsonBody(input, init);
        const id = String(body?.id || '').trim();
        if (!id) return jsonResponse({code: 417, msg: 'CLIPBOARD_SAVE_FAILED', data: null});

        const previous = demoClipboard.get(id);
        const now = Date.now();
        demoClipboard.set(id, {
            id,
            contentType: body.contentType || 'text',
            content: String(body.content || ''),
            createDate: previous?.createDate || now,
            updateDate: now,
        });
        return successResponse(null);
    },
    'DELETE /api/clipboard/delete': (url) => {
        demoClipboard.delete(url.searchParams.get('id'));
        return successResponse(null);
    },
    'GET /api/webrtc/v1/config': () => successResponse({
        protocolVersion: 1,
        participantIdleTimeoutMs: 120_000,
        sessionIdleTimeoutMs: 300_000,
        maxSessions: 100,
        maxParticipants: 10,
        maxOutgoingEventsPerSync: 100,
        maxPendingEventsPerParticipant: 100,
        maxPendingEventBytesPerParticipant: 1_048_576,
        maxEventPayloadBytes: 262_144,
        maxMetadataBytes: 16_384,
        sessionKeyConstraints: null,
        participantKeyConstraints: null,
        iceServers: [],
    }),
    'POST /api/webrtc/v1/sessions': demoFeatureUnavailableResponse,
    'POST /api/webrtc/v1/sessions/join': demoFeatureUnavailableResponse,
};

export function installDemoApi(options = {}) {
    const target = options.target || globalThis;
    const originalFetch = options.fetch || target.fetch?.bind(target);
    if (typeof originalFetch !== 'function') throw new TypeError('A fetch implementation is required');

    const pageUrl = options.pageUrl || target.location?.href || 'https://example.test/';
    const pageOrigin = new URL(pageUrl).origin;
    const demoFetch = async (input, init) => {
        const url = new URL(getRequestUrl(input), pageUrl);
        const method = getRequestMethod(input, init);
        const handler = url.origin === pageOrigin ? demoHandlers[`${method} ${url.pathname}`] : null;
        return handler ? handler(url, init, input, getDemoLocale(target)) : originalFetch(input, init);
    };

    target.fetch = demoFetch;
    return () => {
        if (target.fetch === demoFetch) target.fetch = originalFetch;
    };
}

function getDemoLocale(target) {
    try {
        const locale = target.localStorage?.getItem('ui-locale') || target.document?.documentElement?.lang || target.navigator?.language;
        return String(locale || '').toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN';
    } catch {
        return 'zh-CN';
    }
}

function getRequestUrl(input) {
    return typeof input === 'string' || input instanceof URL ? input : input?.url;
}

function getRequestMethod(input, init) {
    return String(init?.method || input?.method || 'GET').toUpperCase();
}

async function readJsonBody(input, init) {
    if (typeof init?.body === 'string') return JSON.parse(init.body);
    if (input instanceof Request) return input.clone().json();
    return init?.body || {};
}

function successResponse(data) {
    return jsonResponse({code: 200, msg: 'success', data});
}

function demoFeatureUnavailableResponse() {
    return jsonResponse({code: 417, msg: 'DEMO_FEATURE_UNAVAILABLE', data: null});
}

function jsonResponse(data) {
    return new Response(JSON.stringify(data), {
        status: 200,
        headers: {'Content-Type': 'application/json'},
    });
}

function cloneValue(value) {
    return value == null ? value : structuredClone(value);
}
