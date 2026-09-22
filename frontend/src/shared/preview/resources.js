import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import {MarkdownUtils} from '../markdown-utils.js';

export const PREVIEW_FRAME_SANDBOX = 'allow-forms allow-modals allow-popups allow-scripts';

export function normalizePreviewPath(path) {
    const parts = [];
    for (const part of String(path).replaceAll('\\', '/').split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') {
            if (!parts.length) throw new Error('Path escapes preview root');
            parts.pop();
        } else parts.push(part);
    }
    if (!parts.length) throw new Error('Empty preview path');
    return parts.join('/');
}

export function resolvePreviewUrl(value, from) {
    value = String(value || '').trim();
    if (!value || /^(#|\/\/|[a-z][\w+.-]*:)/i.test(value)) return null;
    const index = value.search(/[?#]/);
    const pathname = index < 0 ? value : value.slice(0, index);
    const suffix = index < 0 ? '' : value.slice(index);
    try {
        const decoded = decodeURIComponent(pathname).replaceAll('\\', '/');
        const path = !decoded ? from : decoded.startsWith('/') ? decoded : `${from.slice(0, from.lastIndexOf('/') + 1)}${decoded}`;
        return {path: normalizePreviewPath(path), suffix, hash: suffix.includes('#') ? suffix.slice(suffix.indexOf('#')) : ''};
    } catch { return null; }
}

export function previewType(file) {
    const mime = file?.mimeType?.split(';')[0];
    return mime === 'text/html' ? 'html' : mime === 'text/markdown' ? 'markdown' : '';
}

export function sourceDocument(file) {
    if (previewType(file) === 'html') return file.content;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><style>
        :root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.6}
        body{max-width:960px;margin:0 auto;padding:32px;color:CanvasText;background:Canvas;overflow-wrap:anywhere}
        img,video{max-width:100%;height:auto}pre{overflow:auto;padding:16px;border-radius:6px;background:color-mix(in srgb,CanvasText 8%,Canvas)}
        code{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}blockquote{margin-left:0;padding-left:16px;border-left:4px solid color-mix(in srgb,CanvasText 24%,Canvas)}
        table{border-collapse:collapse}th,td{padding:6px 12px;border:1px solid color-mix(in srgb,CanvasText 24%,Canvas)}a{color:LinkText}
        @media(max-width:640px){body{padding:20px}}
    </style></head><body>${MarkdownUtils.renderMarkdown(file.content)}</body></html>`;
}

// 分别解析声明值和导入参数，支持带引号的导入路径及嵌套函数。
export async function rewriteCss(css, resolve) {
    const root = postcss.parse(css);
    const rewrite = async (owner, key, isImport = false) => {
        const jobs = [];
        const parsed = valueParser(owner[key]);
        parsed.walk((node) => {
            if (node.type === 'function' && node.value.toLowerCase() === 'url') {
                const value = node.nodes.filter((child) => child.type !== 'space' && child.type !== 'comment');
                if (value.length === 1) jobs.push(Promise.resolve(resolve(value[0].value)).then((url) => {
                    node.nodes = [{type: 'string', quote: '"', value: url.replaceAll('"', '\\"')}];
                }));
                return false;
            }
        });
        const first = parsed.nodes.find((node) => node.type !== 'space' && node.type !== 'comment');
        if (isImport && first?.type === 'string') jobs.push(Promise.resolve(resolve(first.value)).then((url) => { first.value = url; }));
        await Promise.all(jobs);
        owner[key] = parsed.toString();
    };
    // 先收集待处理的值，再异步重写，避免遍历 CSS 树时修改节点。
    const values = [];
    root.walkDecls((node) => values.push([node, 'value', false]));
    root.walkAtRules('import', (node) => values.push([node, 'params', true]));
    for (const value of values) {
        await rewrite(...value);
    }
    return root.toString();
}

export async function collectPreviewReferences(file) {
    const references = new Set();
    const collect = (url) => {
        const resolved = resolvePreviewUrl(url, file.path);
        if (resolved) references.add(resolved.path);
        return url;
    };
    if (file.mimeType === 'text/css') await rewriteCss(file.content, collect);
    else if (previewType(file)) {
        const doc = new DOMParser().parseFromString(sourceDocument(file), 'text/html');
        for (const element of doc.querySelectorAll('[src], [href], [poster], [style], style')) {
            for (const attr of ['src', 'href', 'poster']) if (element.hasAttribute(attr)) collect(element.getAttribute(attr));
            if (element.hasAttribute('style')) await rewriteCss(element.getAttribute('style'), collect);
            if (element.tagName === 'STYLE') await rewriteCss(element.textContent, collect);
        }
    }
    return [...references];
}

export async function renderPreview(files, path, bridge) {
    const file = files.get(path);
    if (!previewType(file) || typeof file.content !== 'string') throw new Error(`File is not previewable: ${path}`);
    const cache = new Map();
    const resource = async (url, from, ancestors = []) => {
        const resolved = resolvePreviewUrl(url, from);
        const target = resolved && files.get(resolved.path);
        if (!target) return url;
        if (ancestors.includes(target.path)) return 'data:text/css,';
        if (!cache.has(target.path)) {
            let content = target.content;
            if (target.mimeType === 'text/css' && typeof content === 'string') {
                content = await rewriteCss(content, (ref) => resource(ref, target.path, [...ancestors, target.path]));
            }
            // data URL 可在不透明源 iframe 中加载，包括字体和脚本。
            const data = typeof content === 'string'
                ? `data:${target.mimeType};charset=utf-8,${encodeURIComponent(content)}`
                : await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(new Blob([content], {type: target.mimeType}));
                });
            cache.set(target.path, data);
        }
        return cache.get(target.path) + resolved.hash;
    };
    const doc = new DOMParser().parseFromString(sourceDocument(file), 'text/html');
    if (!doc.title) doc.title = path.split('/').pop();
    doc.querySelectorAll('base').forEach((node) => node.remove());
    for (const element of doc.querySelectorAll('[src], [href], [poster], [style], style')) {
        for (const attr of ['src', 'href', 'poster']) {
            if (!element.hasAttribute(attr)) continue;
            const url = element.getAttribute(attr);
            const resolved = resolvePreviewUrl(url, path);
            if (attr === 'href' && element.tagName === 'A' && resolved && previewType(files.get(resolved.path))) {
                element.dataset.previewPath = resolved.path;
                element.dataset.previewSuffix = resolved.suffix;
                element.removeAttribute('target');
            } else element.setAttribute(attr, await resource(url, path));
        }
        if (element.hasAttribute('style')) element.setAttribute('style', await rewriteCss(element.getAttribute('style'), (url) => resource(url, path)));
        if (element.tagName === 'STYLE') element.textContent = await rewriteCss(element.textContent, (url) => resource(url, path));
    }
    const script = doc.createElement('script');
    script.textContent = bridge;
    doc.head.prepend(script);
    return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
