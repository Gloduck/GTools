import { createRouter, createWebHistory } from 'vue-router';
import { watch } from 'vue';
import IndexView from '@/views/IndexView.vue';
import { pageDefinitions } from '@/shared/page-config.js';
import { currentLocale, t } from '@/i18n/index.js';

const pageComponents = {
  'index': IndexView,
  'jrebel': () => import('@/views/JrebelView.vue'),
  'torrent': () => import('@/views/TorrentView.vue'),
  'github': () => import('@/views/GithubView.vue'),
  'image-editor': () => import('@/views/ImageEditorView.vue'),
  'forward': () => import('@/views/ForwardView.vue'),
  'clipboard': () => import('@/views/ClipboardView.vue'),
  'markdown': () => import('@/views/MdEditorView.vue'),
  'code-editor': () => import('@/views/CodeEditorView.vue')
};

const routes = pageDefinitions.flatMap(({ id, paths, titleKey, icon, descKey }) =>
  paths.map((path) => ({
    path,
    component: pageComponents[id],
    meta: { titleKey, icon, descKey }
  }))
);

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
});

function updateRouteMetadata() {
  for (const route of router.getRoutes()) {
    route.meta.title = route.meta.titleKey ? t(route.meta.titleKey) : 'GTools';
    route.meta.desc = route.meta.descKey ? t(route.meta.descKey) : '';
  }

  const currentRoute = router.currentRoute.value;
  document.title = currentRoute.meta.title || 'GTools';
  setMetaContent('description', currentRoute.meta.desc || '');
}

router.afterEach(updateRouteMetadata);
watch(currentLocale, updateRouteMetadata);
updateRouteMetadata();

function setMetaContent(name, content) {
  let meta = document.querySelector(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.content = content;
}

export default router;
