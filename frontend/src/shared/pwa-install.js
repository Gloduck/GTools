let serviceWorkerRegistered = false;
let activeEditorPwaCount = 0;
let currentManifestUrl = '';
const DEFAULT_THEME_COLOR = '#000000';

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
  const manifest = {
    name,
    short_name: options.shortName || name,
    description: options.description || name,
    lang: options.lang || 'zh-CN',
    start_url: new URL(options.startUrl || window.location.pathname, window.location.origin).toString(),
    scope: new URL(options.scope || '/', window.location.origin).toString(),
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
    orientation: 'any',
    background_color: options.backgroundColor || DEFAULT_THEME_COLOR,
    theme_color: options.themeColor || DEFAULT_THEME_COLOR,
    categories: options.categories || ['productivity', 'developer', 'utilities']
  };
  if (options.icon) {
    const icon = new URL(options.icon, window.location.origin).toString();
    manifest.icons = [
      { src: icon, sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: icon, sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
    ];
  }
  currentManifestUrl = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
  return currentManifestUrl;
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
    navigator.serviceWorker.register('/sw.js').catch((error) => {
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
