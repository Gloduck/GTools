export const pageDefinitions = [
  {
    id: 'index',
    paths: ['/'],
    titleKey: 'pages.index.title',
    descKey: 'pages.index.description',
    icon: 'fas fa-tools'
  },
  {
    id: 'jrebel',
    paths: ['/jrebel'],
    titleKey: 'pages.jrebel.title',
    icon: 'fas fa-bolt',
    descKey: 'pages.jrebel.description',
    categoryId: 'development'
  },
  {
    id: 'torrent',
    paths: ['/torrent'],
    titleKey: 'pages.torrent.title',
    icon: 'fas fa-magnet',
    descKey: 'pages.torrent.description',
    categoryId: 'search'
  },
  {
    id: 'github',
    paths: ['/github'],
    titleKey: 'pages.github.title',
    icon: 'fab fa-github',
    descKey: 'pages.github.description',
    categoryId: 'development'
  },
  {
    id: 'image-editor',
    paths: ['/imageEditor'],
    titleKey: 'pages.imageEditor.title',
    icon: 'fas fa-image',
    descKey: 'pages.imageEditor.description',
    categoryId: 'utilities'
  },
  {
    id: 'forward',
    paths: ['/forward'],
    titleKey: 'pages.forward.title',
    icon: 'fas fa-download',
    descKey: 'pages.forward.description',
    categoryId: 'utilities'
  },
  {
    id: 'file-transfer',
    paths: ['/fileTransfer'],
    titleKey: 'pages.fileTransfer.title',
    icon: 'fas fa-paper-plane',
    descKey: 'pages.fileTransfer.description',
    categoryId: 'network'
  },
  {
    id: 'clipboard',
    paths: ['/clipboard', '/clipboard/:id'],
    titleKey: 'pages.clipboard.title',
    icon: 'fas fa-clipboard',
    descKey: 'pages.clipboard.description',
    categoryId: 'utilities'
  },
  {
    id: 'markdown',
    paths: ['/mdeditor'],
    titleKey: 'pages.markdown.title',
    icon: 'fas fa-pen-nib',
    descKey: 'pages.markdown.description',
    categoryId: 'development'
  },
  {
    id: 'code-editor',
    paths: ['/codeEditor'],
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
