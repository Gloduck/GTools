import IndexView from '@/views/IndexView.vue';
import JrebelView from '@/views/JrebelView.vue';
import TorrentView from '@/views/TorrentView.vue';
import GithubView from '@/views/GithubView.vue';
import ImageEditorView from '@/views/ImageEditorView.vue';
import ForwardView from '@/views/ForwardView.vue';
import ClipboardView from '@/views/ClipboardView.vue';
import MdEditorView from '@/views/MdEditorView.vue';
import CodeEditorView from '@/views/CodeEditorView.vue';

export const pageDefinitions = [
  {
    id: 'index',
    paths: ['/'],
    component: IndexView,
    titleKey: 'pages.index.title',
    descKey: 'pages.index.description',
    icon: 'fas fa-tools'
  },
  {
    id: 'jrebel',
    paths: ['/jrebel'],
    component: JrebelView,
    titleKey: 'pages.jrebel.title',
    icon: 'fas fa-bolt',
    descKey: 'pages.jrebel.description',
    categoryId: 'development'
  },
  {
    id: 'torrent',
    paths: ['/torrent'],
    component: TorrentView,
    titleKey: 'pages.torrent.title',
    icon: 'fas fa-magnet',
    descKey: 'pages.torrent.description',
    categoryId: 'search'
  },
  {
    id: 'github',
    paths: ['/github'],
    component: GithubView,
    titleKey: 'pages.github.title',
    icon: 'fab fa-github',
    descKey: 'pages.github.description',
    categoryId: 'development'
  },
  {
    id: 'image-editor',
    paths: ['/imageEditor'],
    component: ImageEditorView,
    titleKey: 'pages.imageEditor.title',
    icon: 'fas fa-image',
    descKey: 'pages.imageEditor.description',
    categoryId: 'utilities'
  },
  {
    id: 'forward',
    paths: ['/forward'],
    component: ForwardView,
    titleKey: 'pages.forward.title',
    icon: 'fas fa-download',
    descKey: 'pages.forward.description',
    categoryId: 'utilities'
  },
  {
    id: 'clipboard',
    paths: ['/clipboard', '/clipboard/:id'],
    component: ClipboardView,
    titleKey: 'pages.clipboard.title',
    icon: 'fas fa-clipboard',
    descKey: 'pages.clipboard.description',
    categoryId: 'utilities'
  },
  {
    id: 'markdown',
    paths: ['/mdeditor'],
    component: MdEditorView,
    titleKey: 'pages.markdown.title',
    icon: 'fas fa-pen-nib',
    descKey: 'pages.markdown.description',
    categoryId: 'development'
  },
  {
    id: 'code-editor',
    paths: ['/codeEditor'],
    component: CodeEditorView,
    titleKey: 'pages.codeEditor.title',
    icon: 'fas fa-code',
    descKey: 'pages.codeEditor.description',
    categoryId: 'development'
  }
];

export const toolCards = pageDefinitions
  .filter((page) => page.categoryId)
  .map((page) => ({
    id: page.id,
    titleKey: page.titleKey,
    href: page.paths[0],
    descKey: page.descKey,
    categoryId: page.categoryId,
    icon: page.icon
  }));
