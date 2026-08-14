<template>
<!-- Toast提示 -->
    <common-toast ref="toastRef"></common-toast>

    <!-- 配置模态框 -->
    <common-modal :visible="showConfigModal" :title="$t('markdown.configTitle', { source: sourceName })" @update:visible="showConfigModal = $event">
        <!-- mdSource 选择 -->
        <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-2">
                <i class="fas fa-database mr-2"></i>{{ $t('markdown.dataSource') }}
            </label>
            <select v-model="mdSource"
                    class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <option value="github">{{ $t('markdown.sources.github') }}</option>
                <option value="local">{{ $t('markdown.sources.local') }}</option>
            </select>
        </div>

        <!-- GitHub 配置 -->
        <div v-if="mdSource === 'github'" class="space-y-4">
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    <i class="fab fa-github mr-2"></i>{{ $t('markdown.githubToken') }}
                </label>
                <input type="password" v-model="githubConfig.token"
                       placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                       class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <p class="text-xs text-gray-500 mt-1">{{ $t('markdown.tokenHelpBefore') }} <a href="https://github.com/settings/tokens" target="_blank"
                                                               class="text-blue-500 hover:underline">{{ $t('markdown.githubSettings') }}</a>
                    {{ $t('markdown.tokenHelpAfter') }}</p>
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    <i class="fas fa-book mr-2"></i>{{ $t('markdown.repository') }}
                </label>
                <input type="text" v-model="githubConfig.repo"
                       placeholder="owner/repo"
                       class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <p class="text-xs text-gray-500 mt-1">{{ $t('markdown.repositoryFormat') }}</p>
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    <i class="fas fa-book mr-2"></i>{{ $t('markdown.branch') }}
                </label>
                <input type="text" v-model="githubConfig.branch"
                       placeholder="main"
                       class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <p class="text-xs text-gray-500 mt-1">{{ $t('markdown.branchHelp') }}</p>
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    <i class="fas fa-folder mr-2"></i>{{ $t('markdown.rootDirectoryOptional') }}
                </label>
                <input type="text" v-model="githubConfig.rootPath"
                       placeholder="docs"
                       class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    <i class="fas fa-globe mr-2"></i>{{ $t('markdown.proxyOptional') }}
                </label>
                <input type="text" v-model="githubConfig.proxy"
                       placeholder="https://gh-proxy.com"
                       class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <p class="text-xs text-gray-500 mt-1">{{ $t('markdown.proxyHelp') }}</p>
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    <i class="fas fa-upload mr-2"></i>{{ $t('markdown.uploadPathOptional') }}
                </label>
                <input type="text" v-model="githubConfig.uploadPath"
                       placeholder="file"
                       class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <p class="text-xs text-gray-500 mt-1">{{ $t('markdown.githubUploadPathHelp') }}</p>
            </div>
        </div>

        <!-- 本地配置 -->
        <div v-else class="space-y-4">
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    <i class="fas fa-folder-open mr-2"></i>{{ $t('markdown.workingDirectory') }}
                </label>
                <div class="flex gap-2">
                    <input type="text" :value="localConfig.name || $t('markdown.selectFolderPrompt')"
                           readonly
                           :placeholder="$t('markdown.selectFolderPrompt')"
                           class="flex-grow px-4 py-2 border border-gray-300 rounded-lg bg-gray-50">
                    <button type="button" @click="selectDirectory"
                            class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                        <i class="fas fa-folder-open"></i>
                    </button>
                </div>
                <p class="text-xs text-gray-500 mt-1">{{ $t('markdown.selectFolderHelp') }}</p>
            </div>
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-2">
                    <i class="fas fa-upload mr-2"></i>{{ $t('markdown.uploadPathOptional') }}
                </label>
                <input type="text" v-model="localConfig.uploadPath"
                       placeholder="images"
                       class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
                <p class="text-xs text-gray-500 mt-1">{{ $t('markdown.localUploadPathHelp') }}</p>
            </div>
        </div>

        <div class="flex justify-end gap-3 mt-6">
            <button type="button" @click="showConfigModal = false"
                    class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                {{ $t('common.cancel') }}
            </button>
            <button type="button" @click="saveConfigAndConnect"
                    :disabled="!canConnect"
                    :class="['px-4 py-2 rounded-lg transition-colors flex items-center gap-2',
                                 !canConnect ? 'bg-gray-300 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 text-white']">
                <i class="fas fa-link"></i>
                {{ $t('markdown.connect') }}
            </button>
        </div>
    </common-modal>

    <!-- 新建文件模态框 -->
    <common-modal :visible="showNewFileModal" :title="$t('markdown.newFile')" @update:visible="showNewFileModal = $event">
        <label class="block text-sm font-medium text-gray-700 mb-2">{{ $t('markdown.filePath') }}</label>
        <input type="text" v-model="newFilePath"
               :placeholder="$t('markdown.filePathPlaceholder')"
               @keyup.enter="createNewFile"
               class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500">
        <div class="flex justify-end gap-3 mt-4">
            <button type="button" @click="showNewFileModal = false"
                    class="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                {{ $t('common.cancel') }}
            </button>
            <button type="button" @click="createNewFile"
                    :disabled="!newFilePath"
                    :class="['px-4 py-2 rounded-lg transition-colors',
                                 !newFilePath ? 'bg-gray-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 text-white']">
                {{ $t('common.create') }}
            </button>
        </div>
    </common-modal>

    <!-- 主界面 -->
    <div class="min-h-screen flex flex-col bg-white">
        <header class="bg-github text-white shadow-md py-2 px-4 flex-shrink-0">
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <i class="fab fa-markdown text-xl"></i>
                    <a href="/" class="hover:text-gray-200 transition-colors">{{ $route.meta.title }}</a>
                </div>
            </div>
        </header>

        <!-- 主内容区 -->
        <main class="flex-grow w-full min-h-0 h-[calc(100vh-56px)] h-[calc(100dvh-56px)] overflow-hidden">
        <div class="flex h-full overflow-hidden bg-white">
            <!-- 左侧文件树 -->
            <div :class="['bg-white border-r border-gray-200 flex flex-col overflow-hidden transition-all duration-300 sidebar-transition',
                             sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-48 md:w-72 flex-shrink-0']">
                <!-- 连接状态栏 -->
                <div class="p-3 border-b border-gray-200 bg-gray-50 flex-shrink-0">
                    <div v-if="canConnect" class="flex items-center justify-between">
                            <span class="text-xs text-gray-600 truncate" :title="displaySourceInfo">
                                <i :class="['mr-1', mdSource === 'github' ? 'fab fa-github' : 'fas fa-folder-open', mdSource === 'github' ? '' : 'text-blue-500']"></i>
                                {{ displaySourceInfo }}
                            </span>
                        <div class="flex gap-1">
                            <button type="button" @click="clearConfig"
                                    class="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                     :title="$t('markdown.clearConfig')" :aria-label="$t('markdown.clearConfig')">
                                <i class="fas fa-trash-alt" aria-hidden="true"></i>
                            </button>
                            <button type="button" @click="showConfigModal = true"
                                    class="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors"
                                     :title="$t('markdown.settings')" :aria-label="$t('markdown.settings')">
                                <i class="fas fa-cog" aria-hidden="true"></i>
                            </button>
                        </div>
                    </div>
                    <div v-else class="text-center">
                        <button type="button" @click="showConfigModal = true"
                                class="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors">
                             {{ $t('markdown.configureSource', { source: sourceName }) }}
                        </button>
                    </div>
                </div>

                <!-- 工具栏 -->
                <div class="p-3 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
                     <span class="text-sm font-medium text-gray-700">{{ $t('markdown.files') }}</span>
                    <div class="flex gap-1">
                        <button type="button" @click="showNewFileModal = true; newFilePath = ''"
                                class="p-1.5 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                 :title="$t('markdown.newFile')" :aria-label="$t('markdown.newFile')">
                            <i class="fas fa-plus" aria-hidden="true"></i>
                        </button>
                        <button type="button" @click="refreshFileTree"
                                :class="['p-1.5 rounded transition-colors', isLoading ? 'text-blue-600 bg-blue-50' : 'text-gray-600 hover:text-blue-600 hover:bg-blue-50']"
                                 :title="$t('common.refresh')" :aria-label="$t('common.refresh')">
                            <i class="fas fa-sync-alt" :class="{ 'fa-spin': isLoading }" aria-hidden="true"></i>
                        </button>
                        <button type="button" @click="showAllFile = !showAllFile"
                                :class="['p-1.5 rounded transition-colors', showAllFile ? 'text-blue-600 bg-blue-50' : 'text-gray-600 hover:text-blue-600 hover:bg-blue-50']"
                                 :title="showAllFile ? $t('markdown.showMarkdownOnly') : $t('markdown.showAllFiles')"
                                 :aria-label="showAllFile ? $t('markdown.showMarkdownOnly') : $t('markdown.showAllFiles')">
                            <i class="fas" :class="showAllFile ? 'fa-file-alt' : 'fa-file'" aria-hidden="true"></i>
                        </button>
                        <button type="button" @click="exportConfigUrl"
                                class="p-1.5 text-gray-600 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                                 :title="$t('markdown.exportConfigLink')" :aria-label="$t('markdown.exportConfigLink')">
                            <i class="fas fa-link" aria-hidden="true"></i>
                        </button>
                    </div>
                </div>

                <!-- 文件树 -->
                <div class="flex-grow overflow-y-auto p-2">
                    <div v-if="!canConnect" class="text-center py-8 text-gray-500">
                        <i class="fas fa-cloud-upload-alt text-4xl mb-3 text-gray-300"></i>
                         <p class="text-sm">{{ $t('markdown.configureFirst', { source: sourceName }) }}</p>
                    </div>
                    <div v-else-if="showFileTree.length === 0 && !isLoading" class="text-center py-8 text-gray-500">
                        <i class="fas fa-folder-open text-4xl mb-3 text-gray-300"></i>
                         <p class="text-sm">{{ $t('markdown.noFiles') }}</p>
                    </div>
                    <common-loading-spinner v-else-if="isLoading"></common-loading-spinner>
                    <ul v-else class="space-y-1">
                        <file-tree-item
                                v-for="item in showFileTree"
                                :key="item.path"
                                :item="item"
                                :selected-path="currentFilePath"
                                @select="selectFile"
                                @delete="deleteFile">
                        </file-tree-item>
                    </ul>
                </div>
            </div>

            <!-- 收缩按钮 -->
            <button type="button" @click="sidebarCollapsed = !sidebarCollapsed"
                    class="flex-shrink-0 px-2 py-4 bg-gray-100 hover:bg-gray-200 border-y border-r border-gray-200 transition-colors"
                     :title="sidebarCollapsed ? $t('markdown.expandSidebar') : $t('markdown.collapseSidebar')"
                     :aria-label="sidebarCollapsed ? $t('markdown.expandSidebar') : $t('markdown.collapseSidebar')">
                <i :class="['fas transition-transform text-gray-500', sidebarCollapsed ? 'fa-angle-right' : 'fa-angle-left']"
                   aria-hidden="true"></i>
            </button>

            <!-- 右侧编辑器区域 -->
            <div class="flex-grow flex flex-col overflow-hidden bg-white">
                <!-- 编辑器工具栏（仅在选择文件时显示） -->
                <div v-if="currentFilePath"
                     class="bg-white border-b border-gray-300 px-4 py-2 flex items-center justify-between flex-shrink-0">
                    <div class="flex items-center gap-3">
                        <input type="text"
                               :value="currentFilePath"
                               readonly
                               class="text-sm text-gray-600 bg-gray-100 px-3 py-1.5 rounded border border-gray-300 max-w-md">
                        <span v-if="isDirty" class="text-xs text-amber-600">
                                 <i class="fas fa-asterisk mr-1"></i>{{ $t('markdown.unsaved') }}
                            </span>
                        <span v-if="!isDirty && lastSavedAt" class="text-xs text-gray-500">
                                 {{ $t('markdown.savedAt', { time: formattedLastSaved }) }}
                            </span>
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" @click="saveMarkdownFile"
                                :disabled="!isDirty || isSaving"
                                :class="['px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2',
                                             !isDirty || isSaving ? 'bg-gray-300 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700 text-white']">
                            <i :class="['fas', isSaving ? 'fa-spinner fa-spin' : 'fa-save']"></i>
                             <span>{{ $t('common.save') }}</span>
                        </button>
                        <button type="button" @click="deleteFile(currentFilePath)"
                                class="px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white">
                            <i class="fas fa-trash"></i>
                             <span>{{ $t('common.delete') }}</span>
                        </button>
                    </div>
                </div>

                <!-- Vditor 编辑器 -->
                <div class="flex-grow overflow-hidden relative">
                    <!-- 编辑器容器（visibility 控制可见性，避免布局问题） -->
                    <div id="vditor" class="h-full"
                         :style="{ visibility: currentFilePath ? 'visible' : 'hidden' }"></div>
                    <!-- 空状态提示 -->
                    <div v-if="!currentFilePath"
                         class="absolute inset-0 flex items-center justify-center text-gray-400">
                        <div class="text-center">
                            <i class="fas fa-file-alt text-4xl mb-3"></i>
                             <p>{{ $t('markdown.selectMarkdownToEdit') }}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        </main>
    </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { CommonUtils } from '@/shared/common-utils.js';
import { CommonComponents } from '@/shared/common-components.js';
import { FileUtils, normalizeFilePath } from '@/shared/file-utils.js';
import {
    createFileSystem,
    FileConflictError,
    FileOperationPolicy,
    FileResourceResolver,
    FileSession,
} from '@/shared/file-system/index.js';
import { enableEditorPwa } from '@/shared/pwa-install.js';
import { t, currentLocale, translateErrorMessage } from '@/i18n/index.js';

const VDITOR_CDN_BASE = `${import.meta.env.BASE_URL}vendor/vditor/3.11.2`;
const MD_EDITOR_WEB_PATH = '/mdeditor';
const MD_EDITOR_PWA_PATH = '/mdeditor/pwa/';
const MAX_MEMORY_WRITE_BYTES = 50 * 1024 * 1024;
let vditorLoadPromise;

function loadVditor() {
    if (!vditorLoadPromise) {
        vditorLoadPromise = Promise.all([
            import('vditor'),
            import('vditor/dist/index.css')
        ]).then(([vditorModule]) => vditorModule.default || vditorModule).catch((error) => {
            vditorLoadPromise = null;
            throw error;
        });
    }
    return vditorLoadPromise;
}

// 文件树组件
const FileTreeItem = {
        name: 'FileTreeItem',
        template: `
            <li>
                <div :class="['file-tree-item group flex items-center gap-2 px-2 py-1.5 rounded text-sm',
                                 isFolder ? 'font-medium text-gray-700' : (isMdFile ? 'text-gray-600' : 'text-gray-400'),
                                 isActive ? 'active' : '']"
                     :style="{ paddingLeft: (depth * 16 + 8) + 'px' }"
                     @click="handleClick">
                    <i :class="['fas flex-shrink-0 w-4', isFolder ? (isExpanded ? 'fa-folder-open' : 'fa-folder') : (isMdFile ? 'fa-file-alt' : 'fa-file')]"
                       :style="{ color: isFolder ? '#fbbf24' : (isMdFile ? '#6b7280' : '#9ca3af') }"></i>
                    <span class="truncate flex-grow">{{ item.name }}</span>
                    <button v-if="!isFolder" type="button"
                            @click.stop="handleDelete"
                            class="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity"
                            :title="$t('markdown.deleteFile')">
                        <i class="fas fa-trash text-xs"></i>
                    </button>
                </div>
                <ul v-if="isFolder && isExpanded && item.children && item.children.length > 0" class="space-y-0.5">
                    <file-tree-item
                            v-for="child in item.children"
                            :key="child.path"
                            :item="child"
                            :depth="depth + 1"
                            :selected-path="selectedPath"
                            @select="$emit('select', $event)"
                            @delete="$emit('delete', $event)">
                    </file-tree-item>
                </ul>
            </li>
        `,
        props: {
            item: {
                type: Object,
                required: true
            },
            depth: {
                type: Number,
                default: 0
            },
            selectedPath: {
                type: String,
                default: ''
            }
        },
        emits: ['select', 'delete'],
        setup(props, {emit}) {
            const isExpanded = ref(false);

            const isFolder = computed(() => props.item.type === 'directory' || (props.item.children && props.item.children.length > 0));
            const isMdFile = computed(() => props.item.name.endsWith('.md'));
            const isActive = computed(() => props.selectedPath === props.item.path);

            const handleClick = () => {
                if (isFolder.value) {
                    isExpanded.value = !isExpanded.value;
                } else if (isMdFile.value) {
                    emit('select', props.item.path);
                }
            };

            const handleDelete = () => {
                emit('delete', props.item.path);
            };

            return {
                isExpanded,
                isFolder,
                isMdFile,
                isActive,
                handleClick,
                handleDelete
            };
        }
    };

export default {
    name: 'MdEditorView',
        components: {
            'common-toast': CommonComponents.Toast,
            'common-modal': CommonComponents.Modal,
            'common-loading-spinner': CommonComponents.LoadingSpinner,
            'file-tree-item': FileTreeItem
        },

        setup() {
            const computePath = CommonUtils.computePath;
            const locale = () => currentLocale.value || currentLocale;
            const formatDateTime = (timestamp) => CommonUtils.formatTime(timestamp) || t('common.unknown');
            const translatedError = (error) => translateErrorMessage(error?.message || t('common.unknown'));

            const isExternalResourceUrl = (url) => {
                const value = String(url || '').trim();
                return !value || value.startsWith('#') || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value);
            };

            const splitResourceUrl = (url) => {
                const match = String(url).match(/^([^?#]*)([?#].*)?$/);
                const rawPath = match?.[1] || '';
                let path = rawPath;
                try {
                    path = decodeURI(rawPath);
                } catch {
                }
                return {path, suffix: match?.[2] || ''};
            };

            const resolveResourcePath = (documentPath, url) => {
                const resource = splitResourceUrl(url);
                return {
                    path: computePath(documentPath, true, resource.path),
                    suffix: resource.suffix
                };
            };

            const appendResourceSuffix = (url, suffix) => {
                if (!suffix) return url;
                if (suffix.startsWith('?') && url.includes('?')) return `${url}&${suffix.slice(1)}`;
                return `${url}${suffix}`;
            };

            const relativePathFromFile = (documentPath, targetPath) => {
                const documentDirectory = computePath(documentPath, true, '');
                const fromParts = documentDirectory.split('/').filter(Boolean);
                const targetParts = targetPath.split('/').filter(Boolean);
                let commonLength = 0;
                while (commonLength < fromParts.length && fromParts[commonLength] === targetParts[commonLength]) {
                    commonLength += 1;
                }
                return [
                    ...Array(fromParts.length - commonLength).fill('..'),
                    ...targetParts.slice(commonLength)
                ].join('/');
            };

            // 过滤文件树（仅保留.md文件或全部）
            const filterFileTree = (items) => {
                if (!items || items.length === 0) return [];
                return items.filter(item => {
                    if (item.type === 'directory') {
                        filterFileTree(item.children);
                        return true;
                    }
                    return item.name.endsWith('.md');
                }).map(item => {
                    if (item.type === 'directory') {
                        return {
                            ...item,
                            children: filterFileTree(item.children)
                        };
                    }
                    return item;
                });
            };

            const sidebarCollapsed = ref(false);
            const showConfigModal = ref(true);
            const mdSource = ref('local');
            const githubConfig = ref({
                token: '',
                repo: '',
                branch: '',
                rootPath: '',
                proxy: '',
                uploadPath: ''
            });
            const localConfig = ref({
                directoryHandle: null,
                name: '',
                uploadPath: ''
            });
            const showAllFile = ref(false);
            const fileTree = ref([]);
            const isLoading = ref(false);
            const currentFilePath = ref('');
            const currentFilePathMapping = ref({});
            const isDirty = ref(false);
            const lastSavedAt = ref(null);
            const isSaving = ref(false);
            const showNewFileModal = ref(false);
            const newFilePath = ref('');
            const toastRef = ref(null);
            let disableEditorPwa = null;
            let session = null;
            let resourceResolver = null;
            let currentResourceHandles = [];
            let workspaceVersion = 0;
            let fileReadVersion = 0;
            let editorContentVersion = 0;
            let editorInputVersion = 0;
            let activeFileUploadPath = '';
            let vditorReady = false;
            let pendingVditorContent = '';

            const showToast = (message, type = 'info') => {
                if (toastRef.value) {
                    toastRef.value.show(message, type);
                }
            };

            const showFileTree = computed(() => {
                if (showAllFile.value) {
                    return fileTree.value;
                }
                return filterFileTree(fileTree.value);
            });

            const displaySourceInfo = computed(() => {
                return mdSource.value === 'github'
                    ? githubConfig.value.repo
                    : localConfig.value.name || t('markdown.sources.localFolder');
            });

            const sourceName = computed(() => {
                return mdSource.value === 'github' ? t('markdown.sources.github') : t('markdown.sources.localFolder');
            });

            const formattedLastSaved = computed(() => lastSavedAt.value ? formatDateTime(lastSavedAt.value) : '');

            const canConnect = computed(() => {
                if (mdSource.value === 'github') {
                    return Boolean(githubConfig.value.token && githubConfig.value.repo && githubConfig.value.branch);
                }
                return localConfig.value.directoryHandle?.kind === 'directory';
            });

            const fileUploadPath = () => activeFileUploadPath;

            const settingHandlers = [
                {
                    key: "mdSource",
                    source: null,
                    getter: () => mdSource.value,
                    setter: (value) => mdSource.value = value
                },
                {
                    key: "githubToken",
                    source: "github",
                    getter: () => githubConfig.value.token,
                    setter: (value) => githubConfig.value.token = value
                },
                {
                    key: "githubRepo",
                    source: "github",
                    getter: () => githubConfig.value.repo,
                    setter: (value) => githubConfig.value.repo = value
                },
                {
                    key: "githubBranch",
                    source: "github",
                    getter: () => githubConfig.value.branch,
                    setter: (value) => githubConfig.value.branch = value
                },
                {
                    key: "githubRootPath",
                    source: "github",
                    getter: () => githubConfig.value.rootPath,
                    setter: (value) => githubConfig.value.rootPath = value
                },
                {
                    key: "githubUploadPath",
                    source: "github",
                    getter: () => githubConfig.value.uploadPath,
                    setter: (value) => githubConfig.value.uploadPath = value
                },
                {
                    key: "githubProxy",
                    source: "github",
                    getter: () => githubConfig.value.proxy,
                    setter: (value) => githubConfig.value.proxy = value
                },
                {
                    key: "localUploadPath",
                    source: "local",
                    getter: () => localConfig.value.uploadPath,
                    setter: (value) => localConfig.value.uploadPath = value
                },
            ];

            const saveConfigToLocalStorage = (configs) => {
                try {
                    for (let settingHandler of settingHandlers) {
                        if (!configs.hasOwnProperty(settingHandler.key)) {
                            continue;
                        }
                        const toSaveValue = configs[settingHandler.key];
                        localStorage.setItem(settingHandler.key, toSaveValue ? toSaveValue : '');
                    }
                } catch (e) {
                    console.error('Failed to save config:', e);
                }
            };

            const saveConfigToStorage = () => {
                try {
                    for (let settingHandler of settingHandlers) {
                        const value = settingHandler.getter();
                        localStorage.setItem(settingHandler.key, value ? value : '');
                    }
                } catch (e) {
                    console.error('Failed to save config:', e);
                }
            };

            const loadConfig = () => {
                try {
                    for (let settingHandler of settingHandlers) {
                        const saved = localStorage.getItem(settingHandler.key);
                        if (saved) {
                            settingHandler.setter(saved);
                        }
                    }
                } catch (e) {
                    console.warn('Failed to load config:', e);
                }
            };

            const applyConfigFromUrl = () => {
                const params = new URLSearchParams(window.location.search);
                const urlConfig = {};
                for (let settingHandler of settingHandlers) {
                    const value = params.get(settingHandler.key);
                    if (value) {
                        urlConfig[settingHandler.key] = value;
                    }
                }
                saveConfigToLocalStorage(urlConfig);
            };

            const clearConfig = () => {
                if (!confirm(t('markdown.confirmClearConfig', { source: sourceName.value }))) {
                    return;
                }
                if (!confirmDiscardChanges()) return;
                disposeWorkspace();
                for (let settingHandler of settingHandlers) {
                    if (settingHandler.source !== mdSource.value) {
                        continue;
                    }
                    settingHandler.setter('');
                }
                saveConfigToStorage();
                if (mdSource.value === 'local') {
                    localConfig.value.directoryHandle = null;
                    localConfig.value.name = '';
                }
                showToast(t('markdown.configCleared'), 'info');
                showConfigModal.value = true;
            };

            const saveConfigAndConnect = async () => {
                saveConfigToStorage();
                if (await connect()) showConfigModal.value = false;
            };

            const selectDirectory = async () => {
                try {
                    const dirHandle = await window.showDirectoryPicker();
                    localConfig.value.directoryHandle = dirHandle;
                    localConfig.value.name = dirHandle.name;
                } catch (e) {
                    if (e.name !== 'AbortError') {
                        console.error('Failed to select directory:', e);
                        showToast(t('markdown.selectFolderFailed'), 'error');
                    }
                }
            };

            const exportConfigUrl = () => {
                const baseUrl = new URL(MD_EDITOR_WEB_PATH, window.location.origin).toString();
                const params = new URLSearchParams();
                for (let settingHandler of settingHandlers) {
                    const value = settingHandler.getter();
                    params.set(settingHandler.key, value ? value : "");
                }
                const fullUrl = `${baseUrl}?${params.toString()}`;
                navigator.clipboard.writeText(fullUrl).then(() => {
                    showToast(t('markdown.configLinkCopied'), 'success');
                }).catch(err => {
                    showToast(t('common.copyFailed'), 'error');
                    console.error('Failed to copy:', err);
                });
            };

            const releaseCurrentResources = () => {
                for (const handle of currentResourceHandles) handle.release();
                currentResourceHandles = [];
            };

            const resetCurrentFileInfo = ({revertChange = true} = {}) => {
                fileReadVersion += 1;
                if (revertChange && session && currentFilePath.value) {
                    session.revert(currentFilePath.value);
                }
                releaseCurrentResources();
                currentFilePath.value = '';
                currentFilePathMapping.value = {};
                isDirty.value = false;
                lastSavedAt.value = null;
                setVditorContent('');
            };

            const confirmDiscardChanges = () => {
                return !isDirty.value || confirm(t('markdown.confirmDiscardChanges'));
            };

            const disposeWorkspace = () => {
                workspaceVersion += 1;
                resetCurrentFileInfo();
                session?.revertAll();
                resourceResolver?.dispose();
                session = null;
                resourceResolver = null;
                activeFileUploadPath = '';
                fileTree.value = [];
            };

            const connect = async () => {
                if (!canConnect.value || !confirmDiscardChanges()) return false;

                disposeWorkspace();
                const connectionWorkspaceVersion = workspaceVersion;
                const source = mdSource.value;
                const config = source === 'local'
                    ? {
                        directoryHandle: localConfig.value.directoryHandle,
                        uploadPath: localConfig.value.uploadPath
                    }
                    : {
                        token: githubConfig.value.token,
                        repo: githubConfig.value.repo,
                        branch: githubConfig.value.branch,
                        rootPath: githubConfig.value.rootPath,
                        proxy: githubConfig.value.proxy,
                        uploadPath: githubConfig.value.uploadPath
                    };
                let nextResolver = null;

                isLoading.value = true;
                try {
                    const nextFileSystem = createFileSystem({
                        type: source,
                        config,
                        policy: new FileOperationPolicy({
                            maxMemoryWriteBytes: MAX_MEMORY_WRITE_BYTES,
                            maxListEntries: Number.MAX_SAFE_INTEGER,
                            maxWalkEntries: Number.MAX_SAFE_INTEGER
                        })
                    });
                    const nextSession = new FileSession({fileSystem: nextFileSystem});
                    nextResolver = new FileResourceResolver();

                    await nextSession.checkAccess('', {
                        writable: true,
                        request: true
                    });
                    const nextFileTree = await loadFileTree('', nextSession);
                    if (connectionWorkspaceVersion !== workspaceVersion) {
                        nextResolver.dispose();
                        return false;
                    }

                    session = nextSession;
                    resourceResolver = nextResolver;
                    activeFileUploadPath = config.uploadPath;
                    fileTree.value = nextFileTree;
                    showToast(t('markdown.connectSuccess'), 'success');
                    return true;
                } catch (error) {
                    nextResolver?.dispose();
                    showToast(t('markdown.connectFailed', { message: translatedError(error) }), 'error');
                    console.error('Connection error:', error);
                    return false;
                } finally {
                    if (connectionWorkspaceVersion === workspaceVersion) isLoading.value = false;
                }
            };

            const refreshFileTree = async () => {
                if (!session) return;

                const activeSession = session;
                const activeWorkspaceVersion = workspaceVersion;
                isLoading.value = true;

                try {
                    const nextFileTree = await loadFileTree('', activeSession);
                    if (activeSession === session && activeWorkspaceVersion === workspaceVersion) {
                        fileTree.value = nextFileTree;
                    }
                } catch (error) {
                    if (activeSession === session && activeWorkspaceVersion === workspaceVersion) {
                        showToast(t('markdown.loadFileListFailed', { message: translatedError(error) }), 'error');
                    }
                } finally {
                    if (activeSession === session && activeWorkspaceVersion === workspaceVersion) {
                        isLoading.value = false;
                    }
                }
            };

            const loadFileTree = async (path, activeSession) => {
                const entries = await activeSession.list(path);
                const files = [];
                for (const entry of entries) {
                    const type = entry.kind === 'directory' ? 'directory' : 'file';
                    const file = {
                        name: entry.name,
                        path: entry.path,
                        type,
                        children: []
                    };
                    if (type === 'directory') {
                        file.children = await loadFileTree(entry.path, activeSession);
                    }
                    files.push(file);
                }
                return files;
            };

            const selectFile = async (path) => {
                if (path === currentFilePath.value) return;
                if (!confirmDiscardChanges()) return;
                resetCurrentFileInfo();
                currentFilePath.value = path;
                const readVersion = ++fileReadVersion;
                await loadMarkdownFile(path, readVersion);
            };

            const loadMarkdownFile = async (path, readVersion) => {
                const activeSession = session;
                const activeResolver = resourceResolver;
                const activeWorkspaceVersion = workspaceVersion;
                if (!activeSession || !activeResolver) return;

                try {
                    const content = await activeSession.readText(path, {adoptBase: true});
                    const converted = await convertMarkdownFilePath(path, content, activeSession, activeResolver);
                    if (readVersion !== fileReadVersion || activeWorkspaceVersion !== workspaceVersion || path !== currentFilePath.value) {
                        converted.handles.forEach((handle) => handle.release());
                        return;
                    }
                    releaseCurrentResources();
                    currentResourceHandles = converted.handles;
                    currentFilePathMapping.value = converted.mapping;
                    setVditorContent(converted.content);
                } catch (error) {
                    if (readVersion === fileReadVersion && activeWorkspaceVersion === workspaceVersion) {
                        console.error('Load Markdown failed:', error);
                        showToast(t('markdown.loadFileFailed', { message: translatedError(error) }), 'error');
                    }
                }
            };

            // Markdown 路径转换核心逻辑
            const processMarkdownPaths = async (content, converter) => {
                const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
                const linkRegex = /(?<!!)\[([^\]]*)\]\(([^)]+)\)/g;
                const processMatches = async (source, regex, buildReplacement) => {
                    let result = '';
                    let lastIndex = 0;
                    const matches = [...source.matchAll(regex)];
                    for (const match of matches) {
                        const url = match[2];
                        const convertedUrl = await converter(match, url);
                        result += source.slice(lastIndex, match.index);
                        result += convertedUrl === url ? match[0] : buildReplacement(match, convertedUrl);
                        lastIndex = match.index + match[0].length;
                    }
                    return result + source.slice(lastIndex);
                };

                const withImages = await processMatches(content, imageRegex, (match, url) => `![${match[1]}](${url})`);
                return processMatches(withImages, linkRegex, (match, url) => `[${match[1]}](${url})`);
            };

            const convertMarkdownFilePath = async (path, content, activeSession, activeResolver) => {
                const mapping = {};
                const handles = [];
                const resources = new Map();
                try {
                    const convertedContent = await processMarkdownPaths(content, async (match, url) => {
                        if (isExternalResourceUrl(url)) return url;
                        try {
                            const resourcePath = resolveResourcePath(path, url);
                            if (!resourcePath.path) return url;

                            let resource = resources.get(resourcePath.path);
                            if (!resource) {
                                resource = await activeResolver.acquire(resourcePath.path, {
                                    source: activeSession,
                                    view: 'effective'
                                });
                                resources.set(resourcePath.path, resource);
                                handles.push(resource);
                            }
                            const convertedUrl = appendResourceSuffix(resource.url, resourcePath.suffix);
                            mapping[convertedUrl] = url;
                            return convertedUrl;
                        } catch (error) {
                            console.warn(`Resolve Markdown resource failed: ${url}`, error);
                            return url;
                        }
                    });
                    return {content: convertedContent, mapping, handles};
                } catch (error) {
                    handles.forEach((handle) => handle.release());
                    throw error;
                }
            };

            const revertMarkdownFilePath = async (path, content, mapping) => {
                return processMarkdownPaths(content, (match, url) => {
                    if (Object.prototype.hasOwnProperty.call(mapping, url)) {
                        return mapping[url];
                    }
                    return url;
                });
            };

            const setVditorContent = (content) => {
                pendingVditorContent = String(content ?? '');
                if (!vditor || !vditorReady) return;
                const contentVersion = ++editorContentVersion;
                setTimeout(() => {
                    if (contentVersion === editorContentVersion && vditor?.setValue) {
                        vditor.setValue(pendingVditorContent);
                        isDirty.value = false;
                    }
                }, 100);
            };

            let vditor = null;

            watch(currentLocale, () => {
                if (!vditor) return;
                pendingVditorContent = vditor.getValue?.() ?? pendingVditorContent;
                vditor.destroy?.();
                vditor = null;
                vditorReady = false;
                void initVditor();
            });

            const initVditor = async () => {
                const Vditor = await loadVditor();
                vditor = new Vditor('vditor', {
                    mode: 'wysiwyg',
                    cdn: VDITOR_CDN_BASE,
                    lang: locale().startsWith('zh') ? 'zh_CN' : 'en_US',
                    height: '100%',
                    placeholder: t('markdown.editorPlaceholder'),
                    toolbarConfig: {pin: true},
                    customWysiwygToolbar: () => {},
                    editorName: 'vditor',
                    toolbar: [
                        'headings', 'bold', 'italic', 'strike', 'link', '|',
                        'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
                        'code', 'inline-code', 'code-block', 'table', '|',
                        'insert', 'upload', 'line', 'quote', '|',
                        'fullscreen', 'preview', 'export'
                    ],
                    upload: {
                        url: '',
                        max: MAX_MEMORY_WRITE_BYTES,
                        handler: async (files) => {
                            if (!session || !resourceResolver || !currentFilePath.value) {
                                showToast(t('markdown.connectFirst', { source: sourceName.value }), 'error');
                                return [];
                            }

                            const activeSession = session;
                            const activeResolver = resourceResolver;
                            const activeWorkspaceVersion = workspaceVersion;
                            const documentPath = currentFilePath.value;
                            const configuredUploadPath = fileUploadPath();
                            const uploadDirectory = computePath(documentPath, true, configuredUploadPath);
                            const results = await Promise.all(Array.from(files).map(async (file) => {
                                const path = computePath(uploadDirectory, false, file.name);
                                let committed = false;
                                try {
                                    await activeSession.stageBlob(path, file, {mimeType: file.type});
                                    await activeSession.commit(path, {
                                        message: `Upload ${file.name} via GTools MdEditor`
                                    });
                                    committed = true;

                                    if (activeWorkspaceVersion !== workspaceVersion || documentPath !== currentFilePath.value) {
                                        return null;
                                    }

                                    const markdownPath = relativePathFromFile(documentPath, path);
                                    activeResolver.invalidate(path, {source: activeSession, view: 'effective'});
                                    let resource;
                                    try {
                                        resource = await activeResolver.acquire(path, {
                                            source: activeSession,
                                            view: 'effective'
                                        });
                                    } catch (error) {
                                        console.warn(`Resolve uploaded resource failed: ${path}`, error);
                                        if (activeWorkspaceVersion !== workspaceVersion || documentPath !== currentFilePath.value) return null;
                                        return {
                                            name: file.name,
                                            url: markdownPath,
                                            isImage: FileUtils.isImageFile(file)
                                        };
                                    }
                                    if (activeWorkspaceVersion !== workspaceVersion || documentPath !== currentFilePath.value) {
                                        resource.release();
                                        return null;
                                    }

                                    currentResourceHandles.push(resource);
                                    currentFilePathMapping.value[resource.url] = markdownPath;
                                    return {
                                        name: file.name,
                                        url: resource.url,
                                        isImage: FileUtils.isImageFile(file)
                                    };
                                } catch (error) {
                                    if (!committed) activeSession.revert(path);
                                    console.error('Upload failed:', error);
                                    showToast(t('markdown.uploadFailed', { name: file.name, message: translatedError(error) }), 'error');
                                    return null;
                                }
                            }));

                            const completed = results.filter(Boolean);
                            for (const result of completed) {
                                const markdown = result.isImage
                                    ? `![${result.name}](${result.url})`
                                    : `[${result.name}](${result.url})`;
                                vditor.insertValue(`\n${markdown}\n`);
                            }
                            if (completed.length > 0) await refreshFileTree();
                            return completed;
                        }
                    },
                    preview: {
                        theme: {current: 'light'},
                        markdown: {}
                    },
                    input: () => {
                        editorInputVersion += 1;
                        if (currentFilePath.value) {
                            isDirty.value = true;
                        }
                    },
                    after: () => {
                        vditorReady = true;
                        setVditorContent(pendingVditorContent);
                    }
                });

                window.addEventListener('keydown', handleKeyDown, {capture: true});
            };

            const handleKeyDown = (e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (currentFilePath.value && isDirty.value && !isSaving.value) {
                        saveMarkdownFile();
                    }
                }
            };

            const saveMarkdownFile = async () => {
                const path = currentFilePath.value;
                const activeSession = session;
                const activeWorkspaceVersion = workspaceVersion;
                if (!path || !vditor || !activeSession) return;

                isSaving.value = true;
                try {
                    let content = vditor.getMarkdown ? vditor.getMarkdown() : vditor.getValue();
                    const saveInputVersion = editorInputVersion;
                    const processedContent = await revertMarkdownFilePath(path, content, currentFilePathMapping.value);
                    await activeSession.stageText(path, processedContent, {mimeType: 'text/markdown'});
                    await activeSession.commit(path, {
                        message: `Update ${path} via GTools MdEditor`
                    });

                    if (activeSession === session && activeWorkspaceVersion === workspaceVersion && path === currentFilePath.value) {
                        const hasNewChanges = editorInputVersion !== saveInputVersion;
                        isDirty.value = hasNewChanges;
                        lastSavedAt.value = Date.now();
                        showToast(hasNewChanges ? t('markdown.savedWithNewChanges') : t('markdown.saveSuccess'), hasNewChanges ? 'info' : 'success');
                    }
                } catch (error) {
                    if (activeSession !== session || activeWorkspaceVersion !== workspaceVersion) return;
                    if (error?.code === FileConflictError.code) {
                        try {
                            await activeSession.refreshChangeBase(path);
                            showToast(t('markdown.saveConflictRetry'), 'error');
                        } catch (refreshError) {
                            console.error('Refresh conflicted file failed:', refreshError);
                            showToast(t('markdown.saveConflictRefresh'), 'error');
                        }
                    } else {
                        showToast(t('markdown.saveFailed', { message: translatedError(error) }), 'error');
                    }
                } finally {
                    isSaving.value = false;
                }
            };

            const createNewFile = async () => {
                const activeSession = session;
                if (!newFilePath.value || !activeSession) return;

                let path = '';

                try {
                    path = normalizeFilePath(newFilePath.value.trim());
                    if (!path) throw new Error(t('markdown.filePathRequired'));
                    if (!path.endsWith('.md')) path += '.md';
                    await activeSession.stageText(path, '', {mimeType: 'text/markdown', createOnly: true});
                    await activeSession.commit(path, {
                        message: `Create ${path} via GTools MdEditor`
                    });

                    if (activeSession !== session) return;
                    showNewFileModal.value = false;
                    newFilePath.value = '';
                    await refreshFileTree();
                    await selectFile(path);
                    showToast(t('markdown.createSuccess'), 'success');
                } catch (error) {
                    if (path) activeSession.revert(path);
                    if (activeSession === session) showToast(t('markdown.createFailed', { message: translatedError(error) }), 'error');
                }
            };

            const deleteFile = async (path) => {
                if (!path) return;
                if (!confirm(t('markdown.confirmDeleteFile', { path }))) return;
                const activeSession = session;
                if (!activeSession) return;

                try {
                    await activeSession.stageDelete(path);
                    await activeSession.commit(path, {
                        message: `Delete ${path} via GTools MdEditor`
                    });

                    if (activeSession !== session) return;
                    if (currentFilePath.value === path) {
                        resetCurrentFileInfo({revertChange: false});
                    }
                    await refreshFileTree();
                    showToast(t('markdown.deleteSuccess'), 'success');
                } catch (error) {
                    if (activeSession !== session) return;
                    if (error?.code === FileConflictError.code) {
                        activeSession.revert(path);
                        showToast(t('markdown.deleteConflictRefresh'), 'error');
                    } else {
                        showToast(t('markdown.deleteFailed', { message: translatedError(error) }), 'error');
                    }
                }
            };

            const tryConnectToMdSource = async () => {
                if (mdSource.value === 'github' && githubConfig.value.token && githubConfig.value.repo && githubConfig.value.branch) {
                    showConfigModal.value = !(await connect());
                } else {
                    showConfigModal.value = true;
                }
            };

            onMounted(async () => {
                const pageTitle = document.title;
                const pageDescription = document.querySelector('meta[name="description"]')?.content || pageTitle;
                disableEditorPwa = enableEditorPwa({
                    name: pageTitle,
                    shortName: pageTitle,
                    description: pageDescription,
                    startUrl: MD_EDITOR_PWA_PATH,
                    scope: MD_EDITOR_PWA_PATH,
                    icon: '/pwa-md-editor-icon.svg',
                    meta: {
                        'theme-color': '#111827',
                        'mobile-web-app-capable': 'yes',
                        'apple-mobile-web-app-capable': 'yes',
                        'apple-mobile-web-app-title': pageTitle,
                        'apple-mobile-web-app-status-bar-style': 'black-translucent'
                    }
                });
                applyConfigFromUrl();
                loadConfig();
                try {
                    await initVditor();
                    await tryConnectToMdSource();
                } catch (error) {
                    console.error('Failed to initialize Vditor:', error);
                    showToast(t('markdown.editorLoadFailed', { message: translatedError(error) }), 'error');
                }
            });

            onBeforeUnmount(() => {
                disableEditorPwa?.();
                vditorReady = false;
                disposeWorkspace();
                window.removeEventListener('keydown', handleKeyDown, {capture: true});
            });

            return {
                sidebarCollapsed,
                mdSource,
                localConfig,
                canConnect,
                displaySourceInfo,
                sourceName,
                selectDirectory,
                showConfigModal,
                githubConfig,
                saveConfigAndConnect,
                clearConfig,
                exportConfigUrl,
                fileTree,
                showFileTree,
                showAllFile,
                isLoading,
                refreshFileTree,
                currentFilePath,
                selectFile,
                isDirty,
                lastSavedAt,
                formattedLastSaved,
                saveMarkdownFile,
                isSaving,
                showNewFileModal,
                newFilePath,
                createNewFile,
                deleteFile,
                toastRef
            };
        }
    };
</script>

<style>
/* 文件树样式 */
        .file-tree-item {
            cursor: pointer;
            user-select: none;
        }

        .file-tree-item:hover {
            background-color: #f0f4f8;
        }

        .file-tree-item.active {
            background-color: #e0f2fe;
            color: #0369a1;
        }

        /* 自定义滚动条 */
        ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
        }

        ::-webkit-scrollbar-track {
            background: #f1f1f1;
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb {
            background: #c1c1c1;
            border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb:hover {
            background: #a1a1a1;
        }

        /* 侧边栏动画 */
        .sidebar-transition {
            transition: width 0.3s ease, opacity 0.3s ease;
        }

        .vditor-reset h1 {
            font-size: 2em;
            font-weight: 600;
            margin: 1em 0 0.5em;
            border-bottom: 1px solid #d0d7de;
            padding-bottom: 0.3em;
        }

        .vditor-reset h2 {
            font-size: 1.5em;
            font-weight: 600;
            margin: 1em 0 0.5em;
            border-bottom: 1px solid #d0d7de;
            padding-bottom: 0.3em;
        }

        .vditor-reset h3 {
            font-size: 1.25em;
            font-weight: 600;
            margin: 1em 0 0.5em;
        }

        .vditor-reset p {
            margin: 1em 0;
        }

        .vditor-reset code {
            padding: 0.2em 0.4em;
            margin: 0;
            font-size: 85%;
            background-color: rgba(175, 184, 193, 0.2);
            border-radius: 6px;
            font-family: 'Fira Code', Consolas, monospace;
        }

        .vditor-reset pre {
            padding: 16px;
            overflow: auto;
            font-size: 85%;
            line-height: 1.45;
            background-color: #f6f8fa;
            border-radius: 6px;
            margin: 1em 0;
        }

        .vditor-reset pre code {
            padding: 0;
            background-color: transparent;
        }

        .vditor-reset blockquote {
            padding: 0 1em;
            color: #57606a;
            border-left: 0.25em solid #d0d7de;
            margin: 1em 0;
        }

        .vditor-reset ul, .vditor-reset ol {
            padding-left: 2em;
            margin: 1em 0;
        }

        .vditor-reset table {
            border-collapse: collapse;
            width: 100%;
            margin: 1em 0;
        }

        .vditor-reset table th, .vditor-reset table td {
            border: 1px solid #d0d7de;
            padding: 6px 13px;
        }

        .vditor-reset table tr:nth-child(2n) {
            background-color: #f6f8fa;
        }

        .vditor-reset img {
            max-width: 100%;
            height: auto;
        }

        .vditor-reset hr {
            height: 0.25em;
            padding: 0;
            margin: 1.5em 0;
            background-color: #d0d7de;
            border: 0;
        }
</style>
