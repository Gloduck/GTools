// 此函数会被序列化后注入不透明源沙箱，不通过闭包引用宿主对象。
export function previewBridge(token, revision, suffix) {
    let domContentLoaded = false, loadEventFired = false;
    const snapshot = () => ({readyState: document.readyState, domContentLoaded, loadEventFired, observedAt: Date.now()});
    const send = (message) => parent.postMessage({channel: 'preview-session', token, revision, pageState: snapshot(), ...message}, '*');
    const bound = (value) => {
        let remaining = 20000;
        const seen = new WeakSet();
        const visit = (item, depth) => {
            if (remaining <= 0) return '[truncated]';
            remaining -= 20;
            if (item == null || typeof item === 'boolean') return item ?? null;
            if (typeof item === 'number') return Number.isFinite(item) ? item : String(item);
            if (typeof item !== 'object') {
                const text = String(item).slice(0, Math.min(4000, Math.max(0, remaining)));
                remaining -= text.length;
                return text;
            }
            if (depth >= 5 || seen.has(item)) return '[truncated]';
            seen.add(item);
            if (item instanceof Error) return {name: item.name, message: visit(item.message, depth + 1), stack: visit(item.stack, depth + 1)};
            if (item instanceof Element) return {tag: item.tagName, id: item.id, text: visit(item.textContent, depth + 1)};
            if (Array.isArray(item)) return item.slice(0, 100).map((child) => visit(child, depth + 1));
            const result = {};
            for (const key of Object.keys(item).slice(0, 100)) {
                if (remaining <= 0) break;
                Object.defineProperty(result, key.slice(0, 200), {value: visit(item[key], depth + 1), enumerable: true});
            }
            return result;
        };
        try { return visit(value, 0); } catch { return '[unserializable]'; }
    };
    let logCount = 0;
    const log = (kind, value) => {
        if (logCount++ < 200) send({type: 'log', entry: {kind, value: bound(value), timestamp: Date.now()}});
    };
    for (const level of ['warn', 'error']) {
        const original = console[level].bind(console);
        console[level] = (...args) => { log(`console.${level}`, args); original(...args); };
    }
    addEventListener('error', (event) => {
        if (event.target !== window) log('resource', {tag: event.target?.tagName, url: event.target?.src || event.target?.href});
        else log('runtime', event.error || event.message);
    }, true);
    addEventListener('unhandledrejection', (event) => log('unhandledrejection', event.reason));
    addEventListener('message', async (event) => {
        const request = event.data;
        if (event.source !== parent || request?.channel !== 'preview-session' || request.token !== token || request.revision !== revision || request.type !== 'request') return;
        try {
            let value;
            if (request.method === 'evaluate') {
                const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
                value = await new AsyncFunction('args', request.options.code)(request.options.args);
            } else if (request.method === 'inspect') {
                const {selector = 'body, body *', limit = 100, includeStyles = false} = request.options;
                const nodes = [...document.querySelectorAll(selector)].filter((node) => {
                    const style = getComputedStyle(node);
                    return style.display !== 'none' && style.visibility !== 'hidden' && node.getClientRects().length;
                });
                const max = Math.max(1, Math.min(100, limit));
                value = {
                    title: document.title,
                    viewport: {width: innerWidth, height: innerHeight},
                    scroll: {x: scrollX, y: scrollY, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight},
                    truncated: nodes.length > max,
                    elements: nodes.slice(0, max).map((node) => {
                        const rect = node.getBoundingClientRect();
                        const style = getComputedStyle(node);
                        const text = (node.innerText ?? node.textContent ?? '').slice(0, 2000);
                        return {tag: node.tagName.toLowerCase(), id: node.id, text,
                            role: node.getAttribute('role'),
                            name: node.getAttribute('aria-label') || [...(node.labels || [])].map((label) => label.innerText).join(' ') || text,
                            ...(node.matches('input:not([type=password]), textarea, select') ? {value: node.value} : {}),
                            ...(node.matches('input, textarea, select, button') ? {disabled: node.disabled} : {}),
                            ...(node.matches('input[type=checkbox], input[type=radio]') ? {checked: node.checked} : {}),
                            rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
                            display: style.display, visibility: style.visibility,
                            ...(includeStyles ? {styles: Object.fromEntries(['color', 'backgroundColor', 'fontFamily', 'fontSize', 'lineHeight', 'padding', 'margin', 'gap', 'gridTemplateColumns', 'flexDirection', 'overflow'].map((key) => [key, style[key]]))} : {})};
                    }),
                };
            } else throw new Error('Unknown preview request');
            send({type: 'response', id: request.id, result: {ok: true, value: bound(value)}});
        } catch (error) {
            send({type: 'response', id: request.id, result: {ok: false, error: bound(error)}});
        }
    });
    document.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const anchor = event.target.closest?.('a[data-preview-path]');
        if (!anchor || anchor.hasAttribute('download')) return;
        event.preventDefault();
        send({type: 'navigate', path: anchor.dataset.previewPath, suffix: anchor.dataset.previewSuffix});
    }, true);
    document.addEventListener('readystatechange', () => send({type: 'page-state'}));
    document.addEventListener('DOMContentLoaded', () => {
        domContentLoaded = true;
        send({type: 'page-state'});
    }, {once: true});
    addEventListener('load', () => {
        loadEventFired = true;
        const hash = suffix.includes('#') ? suffix.slice(suffix.indexOf('#') + 1) : '';
        let name = hash;
        try { name = decodeURIComponent(hash); } catch {}
        if (name) (document.getElementById(name) || document.getElementsByName(name)[0])?.scrollIntoView();
        send({type: 'page-state'});
    }, {once: true});
    // 消息处理器已安装即可连接；外部脚本、模型和图片可以继续加载。
    send({type: 'ready'});
}
