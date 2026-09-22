import {PREVIEW_FRAME_SANDBOX} from './resources.js';

// 会话仍由调用方管理；销毁此辅助对象不会清空已加载的独立窗口。
export function createPreviewWindow(session, {
    onNavigate = (path, suffix) => session.open(path + suffix),
    onClientsChanged = () => {},
    onUrlChanged = () => {},
    getLocale = () => 'en',
} = {}) {
    const channelName = `preview-window-${crypto.randomUUID()}`;
    const clients = new Set();
    let channel = null, url = '', latest = null, revision = 0;

    function replaceUrl(next) {
        const previous = url;
        url = next;
        if (previous) URL.revokeObjectURL(previous);
        onUrlChanged(url);
    }

    function getChannel() {
        if (!('BroadcastChannel' in window)) return null;
        if (channel) return channel;
        channel = new BroadcastChannel(channelName);
        channel.addEventListener('message', ({data: message}) => {
            if (!message?.clientId) return;
            if (message.type === 'preview:subscribe') {
                clients.add(message.clientId);
                if (latest) channel.postMessage({...latest, targetClientId: message.clientId});
                onClientsChanged(clients.size);
            } else if (message.type === 'preview:navigate') {
                void Promise.resolve(onNavigate(message.path, message.suffix || '')).catch(() => {});
            } else if (message.type === 'preview:unsubscribe') {
                clients.delete(message.clientId);
                onClientsChanged(clients.size);
            }
        });
        return channel;
    }

    // 只清除宿主持有的快照和 URL，不改变已经打开的窗口。
    function clear() {
        latest = null;
        replaceUrl('');
    }

    function reset(title = '') {
        channel?.postMessage({type: 'preview:update', content: '', title, path: '', suffix: '', revision: ++revision});
        clear();
    }

    const unsubscribe = session.subscribe((state) => {
        if (!state.path || state.error) {
            if (latest) reset();
            return;
        }
        // 会话重建期间保留上一份完整文档。
        if (!state.content || state.error) return;
        if (latest?.content === state.content && latest.path === state.path && latest.suffix === state.suffix) return;
        latest = {type: 'preview:update', content: state.content, title: state.path.split('/').pop(), path: state.path, suffix: state.suffix, revision: ++revision};
        replaceUrl(createPreviewPageUrl(latest, channelName, getLocale()));
        getChannel()?.postMessage(latest);
    });

    return {
        getUrl: () => url,
        getClientCount: () => clients.size,
        clear,
        reset,
        dispose() {
            unsubscribe();
            channel?.close();
            channel = null;
            clients.clear();
            clear();
        },
    };
}

function createPreviewPageUrl(initialUpdate, channelName, locale) {
    const documentContent = `<!doctype html>
<html lang="${escapeAttribute(locale)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(initialUpdate.title)}</title>
  <style>html,body,iframe{width:100%;height:100%;margin:0;border:0}body{overflow:hidden;background:#fff}iframe{display:block}</style>
</head>
<body>
  <iframe title="${escapeAttribute(initialUpdate.title)}" sandbox="${PREVIEW_FRAME_SANDBOX}" srcdoc="${escapeAttribute(initialUpdate.content)}"></iframe>
  <script>
    (() => {
      const frame = document.querySelector("iframe");
      if (!("BroadcastChannel" in window)) return;
      const channel = new BroadcastChannel(${JSON.stringify(channelName)});
      const clientId = crypto.randomUUID();
      // 等待 iframe 首次加载完成，避免初始导航覆盖后续 srcdoc 更新。
      const loaded = new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));
      let revision = ${initialUpdate.revision};
      channel.addEventListener("message", async (event) => {
        const update = event.data;
        if (!update || update.type !== "preview:update" || typeof update.content !== "string") return;
        if (update.targetClientId && update.targetClientId !== clientId) return;
        if (Number(update.revision) <= revision) return;
        revision = Number(update.revision) || revision;
        await loaded;
        if (Number(update.revision) !== revision) return;
        const title = typeof update.title === "string" ? update.title : document.title;
        document.title = title;
        frame.title = title;
        frame.srcdoc = update.content;
      });
      window.addEventListener("message", (event) => {
        const message = event.data;
        if (event.source !== frame.contentWindow || message?.channel !== "preview-session" || message.type !== "navigate") return;
        channel.postMessage({ ...message, type: "preview:navigate", clientId });
      });
      channel.postMessage({ type: "preview:subscribe", clientId });
      window.addEventListener("pagehide", () => {
        channel.postMessage({ type: "preview:unsubscribe", clientId });
        channel.close();
      }, { once: true });
    })();
  </script>
</body>
</html>`;
    return URL.createObjectURL(new Blob([documentContent], {type: 'text/html;charset=utf-8'}));
}

function escapeHtml(value) {
    return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value) {
    return escapeHtml(value).replaceAll('"', '&quot;');
}
