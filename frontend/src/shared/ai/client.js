import {createOpenAiProvider} from './providers/openai.js';

const PROVIDERS = {openai: createOpenAiProvider};
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000];

// 协议选择集中于入口，业务只接触统一请求、结果和不透明续接令牌。
/**
 * @param {import('./types.js').AiClientConfig} [config]
 * @returns {import('./types.js').AiStrategy}
 */
export function createAiClient({protocol = 'openai', connection, fetch: fetcher = (...args) => globalThis.fetch(...args), retryDelaysMs = RETRY_DELAYS_MS} = {}) {
    const createProvider = PROVIDERS[protocol];
    if (!Object.hasOwn(PROVIDERS, protocol)) throw new Error(`Unsupported AI protocol: ${protocol}`);
    const provider = createProvider({connection, fetch: fetcher});
    return {
        async respond(request) {
            const startedAt = performance.now();
            for (let retry = 0; ; retry += 1) {
                request.signal?.throwIfAborted();
                try {
                    request.onEvent?.({type: 'reset'});
                    const response = await provider.respond(request);
                    return {...response, meta: {...response.meta, ms: Math.round(performance.now() - startedAt)}};
                } catch (error) {
                    if (request.signal?.aborted || error.name === 'AbortError' || !error.retryable || retry >= retryDelaysMs.length) throw error;
                    await delayWithSignal(error.retryAfterMs ?? retryDelaysMs[retry], request.signal);
                }
            }
        },
        listModels: (request = {}) => provider.listModels(request),
        generateImage: (request) => provider.generateImage(request),
    };
}

/** @param {{output?: import('./types.js').AiOutput[]}} response */
export function getResponseText(response) {
    return (response?.output || []).filter((item) => item.type === 'message')
        .flatMap((item) => item.content || []).filter((part) => ['text', 'refusal'].includes(part.type))
        .map((part) => part.text || '').join('\n');
}

function delayWithSignal(ms, signal) {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
        const abort = () => {
            clearTimeout(timer);
            reject(signal.reason || new DOMException('Aborted', 'AbortError'));
        };
        signal?.addEventListener('abort', abort, {once: true});
    });
}
