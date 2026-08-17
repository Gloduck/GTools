let serviceWorkerRegistered = false;
let activeEditorPwaCount = 0;
let currentManifestUrl = '';
const DEFAULT_THEME_COLOR = '#000000';
const BASE_PATH = import.meta.env?.BASE_URL || '/';
const HASH_ROUTER = import.meta.env?.VITE_ROUTER_MODE === 'hash';

export function enableEditorPwa(options = {}) {
  activeEditorPwaCount += 1;
  ensureManifestLink(options);
  ensurePwaMetaTags(options);
  registerServiceWorker();

  return () => {
    activeEditorPwaCount = Math.max(0, activeEditorPwaCount - 1);
    if (activeEditorPwaCount === 0) {
      document.querySelectorAll('[data-runtime-pwa="true"]').forEach((element) => element.remove());
      revokeCurrentManifestUrl();
    }
  };
}

function ensureManifestLink(options) {
  const link = document.querySelector('link[rel="manifest"][data-runtime-pwa="true"]') || document.createElement('link');
  link.rel = 'manifest';
  link.href = createManifestUrl(options);
  link.dataset.runtimePwa = 'true';
  if (!link.parentNode) {
    document.head.appendChild(link);
  }
}

function ensurePwaMetaTags(options) {
  getPwaMetaTags(options).forEach(([name, content]) => {
    let meta = document.querySelector(`meta[name="${name}"]`);
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = name;
      meta.dataset.runtimePwa = 'true';
      document.head.appendChild(meta);
    }
    meta.content = content;
  });
}

function getPwaMetaTags(options) {
  const name = options.name || document.title;
  const defaultMeta = {
    'theme-color': options.themeColor || DEFAULT_THEME_COLOR,
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-title': name,
    'apple-mobile-web-app-status-bar-style': 'black-translucent'
  };
  return Object.entries({ ...defaultMeta, ...(options.meta || {}) });
}

function createManifestUrl(options) {
  revokeCurrentManifestUrl();
  const name = options.name || document.title;
  const baseUrl = new URL(BASE_PATH, window.location.origin);
  const manifest = {
    name,
    short_name: options.shortName || name,
    description: options.description || name,
    lang: options.lang || 'zh-CN',
    start_url: resolveManifestStartUrl(options.startUrl || window.location.pathname, baseUrl),
    scope: HASH_ROUTER ? baseUrl.toString() : resolveBaseRelativeUrl(options.scope || '/', baseUrl),
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: options.backgroundColor || DEFAULT_THEME_COLOR,
    theme_color: options.themeColor || DEFAULT_THEME_COLOR,
    categories: options.categories || ['productivity', 'developer', 'utilities']
  };
  if (options.icon) {
    const icon = resolveBaseRelativeUrl(options.icon, baseUrl);
    manifest.icons = [
      { src: icon, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: icon, sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
    ];
  }
  currentManifestUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
  return currentManifestUrl;
}

function resolveManifestStartUrl(path, baseUrl) {
  const routePath = `/${String(path || '').replace(/^\/+/, '')}`;
  return HASH_ROUTER
    ? `${baseUrl.toString()}#${routePath}`
    : resolveBaseRelativeUrl(routePath, baseUrl);
}

function resolveBaseRelativeUrl(path, baseUrl) {
  return new URL(String(path || '').replace(/^\/+/, ''), baseUrl).toString();
}

function revokeCurrentManifestUrl() {
  if (currentManifestUrl) {
    URL.revokeObjectURL(currentManifestUrl);
    currentManifestUrl = '';
  }
}

function registerServiceWorker() {
  if (serviceWorkerRegistered || !('serviceWorker' in navigator) || import.meta.env.DEV) {
    return;
  }

  const register = () => {
    navigator.serviceWorker.register(new URL('sw.js', new URL(BASE_PATH, location.origin)), {
      scope: BASE_PATH
    }).catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  };

  serviceWorkerRegistered = true;
  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}
