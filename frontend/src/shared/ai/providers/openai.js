import {FileUtils} from '../../file-utils.js';
import {FileTooLargeError} from '../../file-system/file-system-errors.js';

const MEBIBYTE = 1024 * 1024;
const IMAGE_OUTPUT_LIMIT = 25 * MEBIBYTE;

/**
 * @param {import('../types.js').AiStrategyConfig} config
 * @returns {import('../types.js').AiStrategy}
 */
export function createOpenAiProvider({connection, fetch: fetcher}) {
    const continuations = new WeakMap();
    const getConnection = () => {
        const value = typeof connection === 'function' ? connection() : connection;
        const baseUrl = String(value?.baseUrl || 'https://api.openai.com').trim().replace(/\/+$/, '');
        return {baseUrl: baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`, apiKey: String(value?.apiKey || '').trim()};
    };
    const authHeaders = (config) => ({Authorization: `Bearer ${config.apiKey}`});

    return {
        async respond({model, instructions, input = [], continuation, tools, options = {}, signal, onEvent}) {
            const config = getConnection();
            const previous = continuation ? continuations.get(continuation) : null;
            if (continuation && (!previous || previous.baseUrl !== config.baseUrl || previous.apiKey !== config.apiKey)) {
                throw new Error('AI connection changed; start a new request before continuing');
            }
            const history = [...(previous?.input || []), ...encodeInput(input)];
            const payload = {
                model, instructions, input: history, stream: options.stream !== false,
                include: ['reasoning.encrypted_content'],
                ...(tools ? {tools: tools.map(encodeTool)} : {}),
                ...(options.store === undefined ? {} : {store: options.store}),
                ...(options.reasoningEffort ? {reasoning: {effort: options.reasoningEffort}} : {}),
                ...(options.maxOutputTokens === undefined ? {} : {max_output_tokens: options.maxOutputTokens}),
                ...((options.verbosity || options.responseFormat) ? {text: {
                    ...(options.verbosity ? {verbosity: options.verbosity} : {}),
                    ...(options.responseFormat ? {format: options.responseFormat} : {}),
                }} : {}),
            };
            let response;
            try {
                response = await fetcher(`${config.baseUrl}/responses`, {method: 'POST',
                    headers: {...authHeaders(config), 'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal});
            } catch (error) {
                if (!signal?.aborted && error.name !== 'AbortError') error.retryable = error instanceof TypeError;
                throw error;
            }
            let data;
            let bytes;
            let continuationOutput;
            if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
                ({response: data, bytes, continuationOutput} = await readResponseStream(response.body, onEvent, signal));
            } else {
                let raw;
                try { raw = await response.text(); } catch (error) {
                    if (!signal?.aborted && error.name !== 'AbortError') error.retryable = error instanceof TypeError;
                    throw error;
                }
                bytes = new TextEncoder().encode(raw).byteLength;
                try { data = raw ? JSON.parse(raw) : {}; } catch { data = {message: raw}; }
                if (!response.ok) throw responseError(data.error?.message || data.message || response.statusText, response.status, response.headers.get('retry-after'));
            }
            signal?.throwIfAborted();
            if (data.error || data.status === 'failed') throw new Error(data.error?.message || 'AI response failed');
            const output = normalizeOutput(data.output || [], data.status);
            if (!output.some((item) => item.type === 'message') && typeof data.output_text === 'string' && data.output_text) {
                output.push({type: 'message', role: 'assistant', content: [{type: 'text', text: data.output_text}], sources: []});
            }
            onEvent?.({type: 'output', output: output.filter((item) => item.type === 'message')});
            const token = Object.freeze({});
            // 原始输出（含推理和原生工具状态）由策略保存，业务不裁剪或重组协议历史。
            const rawOutput = continuationOutput ?? (data.output?.length ? normalizeContinuationOutput(data.output)
                : (data.output_text ? [{role: 'assistant', content: data.output_text}] : []));
            continuations.set(token, {...config, input: [...history, ...rawOutput]});
            return {output, status: data.status || 'completed', usage: normalizeUsage(data.usage), continuation: token, meta: {bytes}};
        },

        async listModels({signal} = {}) {
            const config = getConnection();
            const response = await fetcher(`${config.baseUrl}/models`, {headers: authHeaders(config), signal});
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error?.message || data.message || response.statusText);
            return [...new Set((data.data || []).map((item) => item.id || item.name || item.model).filter(Boolean))];
        },

        async generateImage({model, signal, ...options}) {
            const config = getConnection();
            const format = options.outputFormat || 'png';
            const isDallE = /^dall-e-/i.test(model);
            if (isDallE && format !== 'png') throw new Error(`${model} output must use a .png path`);
            if (/^dall-e-3$/i.test(model) && options.inputBlob) throw new Error('dall-e-3 does not support image edits');
            if (/^dall-e-2$/i.test(model) && options.inputBlob) {
                if (FileUtils.getImageMimeType(options.inputName, options.inputBlob.type) !== 'image/png') throw new Error('dall-e-2 edits require a PNG input image');
                if (options.inputBlob.size > 4 * MEBIBYTE) throw new Error(`dall-e-2 edit input exceeds ${FileUtils.formatFileSize(4 * MEBIBYTE)}`);
                if (options.inputWidth && options.inputWidth !== options.inputHeight) throw new Error('dall-e-2 edits require a square input image');
            }
            const common = isDallE ? {model, prompt: options.prompt, response_format: 'b64_json'}
                : {model, prompt: options.prompt, size: options.size || 'auto', quality: options.quality || 'auto', background: options.background || 'auto', output_format: format};
            if (!isDallE && format === 'gif') {
                if (options.frameCount !== undefined) common.frame_count = options.frameCount;
                if (options.frameDurationMs !== undefined) common.frame_duration_ms = options.frameDurationMs;
            }
            if (isDallE && options.size && options.size !== 'auto') common.size = options.size;
            if (/^dall-e-3$/i.test(model) && options.quality && options.quality !== 'auto') common.quality = normalizeDallE3Quality(options.quality);
            let endpoint = 'generations';
            let headers = authHeaders(config);
            let body;
            if (options.inputBlob) {
                endpoint = 'edits';
                body = new FormData();
                Object.entries(common).forEach(([key, value]) => { if (value) body.append(key, value); });
                body.append('image', options.inputBlob, options.inputName || 'input.png');
                if (options.maskBlob) body.append('mask', options.maskBlob, options.maskName || 'mask.png');
            } else {
                headers = {...headers, 'Content-Type': 'application/json'};
                body = JSON.stringify({...common, n: 1});
            }
            const maxSize = options.maxOutputBytes ?? IMAGE_OUTPUT_LIMIT;
            const path = options.outputPath || 'generated-image';
            const response = await fetcher(`${config.baseUrl}/images/${endpoint}`, {method: 'POST', headers, body, signal});
            const jsonBlob = await readBoundedBlob(response, path, Math.ceil(maxSize * 4 / 3) + MEBIBYTE, 'AI image JSON response');
            let data;
            try { data = JSON.parse(await jsonBlob.text()); } catch { data = {}; }
            if (!response.ok) throw new Error(data.error?.message || data.message || response.statusText);
            const item = data.data?.[0] || data;
            let blob;
            if (item.b64_json || item.base64) {
                const encoded = item.b64_json || item.base64;
                assertImageSize(path, FileUtils.getBase64DecodedSize(encoded), maxSize);
                blob = FileUtils.base64ToBlob(encoded, imageMimeType(format));
            } else if (item.url) {
                const imageResponse = await fetcher(item.url, {signal});
                if (!imageResponse.ok) throw new Error(`Failed to download generated image: ${imageResponse.statusText}`);
                blob = await readBoundedBlob(imageResponse, path, maxSize);
            } else {
                throw new Error('Image API response did not include b64_json or url');
            }
            if (!blob.type || blob.type === 'application/octet-stream') blob = FileUtils.withBlobType(blob, imageMimeType(format));
            assertImageSize(path, blob.size, maxSize);
            return {type: 'image', status: 'completed', blob, format, usage: normalizeUsage(data.usage)};
        },
    };
}

function encodeInput(input) {
    if (typeof input === 'string') return [{role: 'user', content: input}];
    return input.map((item) => {
        if (item.type === 'tool_result') return {type: 'function_call_output', call_id: item.callId, output: typeof item.output === 'string' ? item.output : JSON.stringify(item.output)};
        return {role: item.role, content: typeof item.content === 'string' ? item.content : (item.content || []).map((part) => {
            if (part.type === 'text') return {type: 'input_text', text: part.text};
            if (part.type === 'image') return {type: 'input_image', image_url: part.url, detail: part.detail || 'auto'};
            throw new Error(`Unsupported AI input content: ${part.type}`);
        })};
    });
}

function encodeTool(tool) {
    if (tool.type === 'function') return {type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, ...(tool.strict === undefined ? {} : {strict: tool.strict})};
    if (tool.type === 'web_search') return {type: 'web_search'};
    if (tool.type === 'image') return {type: 'image_generation'};
    throw new Error(`Unsupported AI tool: ${tool.type}`);
}

function normalizeContinuationOutput(items, synthesized = new Set()) {
    return items.map((item) => {
        // 展示快照不冒充协议输出项；缺失终态消息时按普通助手输入继续。
        if (synthesized.has(item)) return {role: 'assistant', content: (item.content || []).map((part) => part.text ?? part.output_text ?? part.refusal ?? '').join('\n')};
        if (item.type === 'web_search_call') {
            const {type, id, status, action} = item;
            return {type, id, status, action};
        }
        return item;
    });
}

function normalizeOutput(items, responseStatus) {
    return items.flatMap((item) => {
        switch (item.type) {
            case 'message': return [{type: 'message', role: 'assistant', content: (item.content || []).flatMap((part) => {
                if (typeof part.refusal === 'string') return [{type: 'refusal', text: part.refusal}];
                const text = part.text ?? part.output_text;
                return typeof text === 'string' ? [{type: 'text', text}] : [];
            }), sources: normalizeSources((item.content || []).flatMap((part) => part.annotations || []).filter((annotation) => annotation.type === 'url_citation'))}];
            case 'function_call': {
                if ((responseStatus && responseStatus !== 'completed') || (item.status && item.status !== 'completed')) {
                    return [{type: 'unsupported', name: 'tool_call', status: item.status || responseStatus}];
                }
                if (!item.call_id || !item.name) throw new Error('AI tool call is missing its id or name');
                let args;
                try { args = JSON.parse(item.arguments); } catch { throw new Error(`Invalid arguments for AI tool: ${item.name}`); }
                if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error(`Invalid arguments for AI tool: ${item.name}`);
                return [{type: 'tool_call', id: item.call_id, name: item.name, arguments: args}];
            }
            case 'image_generation_call': return [{type: 'image', status: item.status || 'completed', base64: item.result || '', format: item.output_format || 'png'}];
            case 'web_search_call': {
                const action = item.action || {};
                return [{type: 'web_search', status: item.status || 'unknown', action: {type: action.type || 'search', query: action.query, queries: action.queries, url: action.url, pattern: action.pattern},
                    sources: normalizeSources([...(Array.isArray(action.sources) ? action.sources : []), {url: action.url}]), error: normalizeErrorMessage(item.error)}];
            }
            case 'reasoning': return [{type: 'reasoning'}];
            default: return [{type: 'unsupported', name: item.type || 'unknown', status: item.status}];
        }
    });
}

function normalizeSources(values) {
    const sources = new Map();
    for (const source of values) {
        if (typeof source?.url !== 'string' || !/^https?:\/\//i.test(source.url) || /[\s\u0000-\u001f\u007f]/.test(source.url)) continue;
        try {
            const url = new URL(source.url);
            if (url.username || url.password || sources.has(url.href)) continue;
            sources.set(url.href, {url: url.href, title: typeof source.title === 'string' && source.title.trim() ? source.title : url.href});
        } catch { /* 忽略无效来源，保留其他结果。 */ }
    }
    return [...sources.values()];
}

function normalizeErrorMessage(error) {
    if (error == null) return null;
    if (typeof error === 'string') return error;
    if (typeof error.message === 'string') return error.message;
    return JSON.stringify(error);
}

function normalizeUsage(usage) {
    if (!usage || typeof usage !== 'object') return null;
    const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
    const inputTokens = finite(usage.input_tokens ?? usage.prompt_tokens);
    const outputTokens = finite(usage.output_tokens ?? usage.completion_tokens);
    const cached = usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens;
    return {inputTokens, outputTokens, totalTokens: finite(usage.total_tokens ?? inputTokens + outputTokens), ...(cached == null ? {} : {cachedInputTokens: finite(cached)})};
}

async function readResponseStream(stream, onEvent, signal) {
    const reader = stream?.getReader();
    if (!reader) throw new Error('Streaming response body is unavailable');
    const decoder = new TextDecoder();
    const items = new Map();
    const completeItems = new Map();
    let buffer = '';
    let bytes = 0;
    let receivedEvent = false;
    let completedResponse = null;
    const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
    signal?.addEventListener('abort', abort, {once: true});
    const publish = () => onEvent?.({type: 'output', output: normalizeOutput([...items].sort(([a], [b]) => a - b).map(([, item]) => item).filter((item) => item.type === 'message'))});
    const processEvent = (block) => {
        const raw = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (!raw || raw === '[DONE]') return;
        const event = JSON.parse(raw);
        receivedEvent = true;
        if (['response.output_text.delta', 'response.output_text.done', 'response.refusal.delta', 'response.refusal.done'].includes(event.type)) {
            const field = event.type.startsWith('response.refusal.') ? 'refusal' : 'text';
            const item = items.get(event.output_index) || {type: 'message', role: 'assistant', content: []};
            const part = item.content[event.content_index] || {type: field === 'text' ? 'output_text' : 'refusal'};
            part[field] = event.type.endsWith('.delta') ? (part[field] || '') + event.delta : event[field];
            item.content[event.content_index] = part;
            items.set(event.output_index, item);
            publish();
        } else if (event.type === 'response.content_part.done') {
            const item = items.get(event.output_index) || {type: 'message', role: 'assistant', content: []};
            item.content[event.content_index] = event.part;
            items.set(event.output_index, item);
            publish();
        } else if (event.type === 'response.output_item.done') {
            items.set(event.output_index, event.item);
            completeItems.set(event.output_index, event.item);
            publish();
        } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
            completedResponse = {...event.response, status: event.response?.status || (event.type === 'response.completed' ? 'completed' : 'incomplete')};
        } else if (event.type === 'response.failed' || event.type === 'error') {
            throw new Error(event.response?.error?.message || event.message || event.error?.message || 'AI streaming response failed');
        }
    };
    try {
        while (true) {
            signal?.throwIfAborted();
            const {value, done} = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            buffer += decoder.decode(value, {stream: true});
            const blocks = buffer.split(/\r?\n\r?\n/);
            buffer = blocks.pop() || '';
            for (const block of blocks) {
                processEvent(block);
                if (completedResponse) break;
            }
            if (completedResponse) {
                void reader.cancel().catch(() => {});
                break;
            }
        }
        signal?.throwIfAborted();
        if (!completedResponse) {
            buffer += decoder.decode();
            if (buffer.trim()) processEvent(buffer);
        }
        if (!completedResponse) throw new Error('AI streaming response ended before completion');
        const output = [...(completedResponse.output || [])];
        const synthesized = new Set();
        // 只用完整工具项填补终态缺项；尚在累积的工具参数绝不成为可执行调用。
        completeItems.forEach((item, index) => { if (!output[index]) output[index] = item; });
        const aggregateText = typeof completedResponse.output_text === 'string' && completedResponse.output_text;
        if (aggregateText && !output.some((item) => item?.type === 'message')) {
            const partialMessages = [...items].sort(([a], [b]) => a - b).filter(([, item]) => item.type === 'message');
            const annotations = partialMessages.flatMap(([, item]) => item.content.flatMap((part) => part.annotations || []));
            const content = [{type: 'output_text', text: aggregateText, annotations}, ...partialMessages.flatMap(([, item]) => item.content.filter((part) => part.type === 'refusal'))];
            const index = partialMessages[0]?.[0] ?? output.length;
            output[index] = {type: 'message', role: 'assistant', content};
            synthesized.add(output[index]);
        } else {
            items.forEach((item, index) => {
                if (!output[index] && item.type === 'message') {
                    output[index] = item;
                    synthesized.add(item);
                }
            });
        }
        return {response: {...completedResponse, output: output.filter(Boolean)}, bytes,
            continuationOutput: normalizeContinuationOutput(output.filter(Boolean), synthesized)};
    } catch (error) {
        error.retryable = !receivedEvent && !signal?.aborted && error.name !== 'AbortError' && error instanceof TypeError;
        void reader.cancel(error).catch(() => {});
        throw error;
    } finally {
        signal?.removeEventListener('abort', abort);
        reader.releaseLock();
    }
}

function responseError(message, status, retryAfter) {
    const error = new Error(message);
    error.retryable = [408, 409, 425, 429].includes(status) || (status >= 500 && status < 600)
        || /(?:overloaded|server busy|try again later|temporarily unavailable|temporary capacity)/i.test(message);
    if (retryAfter) {
        const seconds = Number(retryAfter);
        const timestamp = Date.parse(retryAfter);
        error.retryAfterMs = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
    }
    return error;
}

function imageMimeType(format) {
    return {jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp', png: 'image/png', gif: 'image/gif'}[String(format).toLowerCase()] || 'image/png';
}

function normalizeDallE3Quality(value) {
    const quality = String(value).toLowerCase();
    if (quality === 'high' || quality === 'hd') return 'hd';
    if (['low', 'medium', 'standard'].includes(quality)) return 'standard';
    throw new Error(`Unsupported dall-e-3 quality: ${value}`);
}

function assertImageSize(path, size, maxSize) {
    if (Number.isFinite(size) && size > maxSize) throw new FileTooLargeError(path, {size, maxSize, operation: 'AI image output'});
}

async function readBoundedBlob(response, path, maxSize, operation = 'AI image output') {
    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > maxSize) throw new FileTooLargeError(path, {size: declaredSize, maxSize, operation});
    const reader = response.body?.getReader();
    if (!reader) throw new Error(`Streaming response body is unavailable for ${operation}`);
    const chunks = [];
    let size = 0;
    try {
        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxSize) {
                await reader.cancel().catch(() => {});
                throw new FileTooLargeError(path, {size, maxSize, operation});
            }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    return new Blob(chunks, {type: response.headers.get('content-type') || 'application/octet-stream'});
}
