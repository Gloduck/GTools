<template>
<!-- Toast提示 -->
        <common-toast ref="toastRef"></common-toast>

        <!-- 页面容器 -->
        <div class="min-h-screen flex flex-col">
            <!-- 头部 -->
            <common-header :title="$route.meta.title" :icon="$route.meta.icon" link="/"></common-header>

            <!-- 主内容区 -->
            <main class="flex-grow container mx-auto px-4 py-8">
                <!-- 剪贴板编辑器页面 -->
                <div v-if="clipboardId" class="max-w-full mx-auto">
                    <!-- 剪贴板标题 -->
                    <section class="bg-white rounded-xl shadow-lg p-6 mb-6">
                        <div class="text-center">
                            <h2 class="text-2xl font-bold text-gray-800 mb-2">
                                {{ $t('clipboard.title') }}
                                <span class="bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-lg font-medium">
                                    {{ clipboardId }}
                                </span>
                            </h2>
                            <p class="text-gray-600">{{ $t('clipboard.lastUpdated', { time: formattedLastUpdated }) }}</p>
                        </div>
                    </section>

                    <!-- 控制区域 -->
                    <section class="bg-white rounded-xl shadow-lg p-6 mb-6">
                        <div class="flex flex-col lg:flex-row justify-between gap-6">
                            <!-- 左侧控制 -->
                            <div class="space-y-4 flex-grow">
                                <div class="flex flex-wrap gap-4">
                                    <div class="flex items-center gap-2">
                                        <input type="checkbox" id="auto-copy" v-model="settings.autoCopy"
                                            class="w-5 h-5 text-blue-600 rounded focus:ring-blue-500">
                                        <label for="auto-copy" class="text-gray-700 cursor-pointer select-none">
                                            {{ $t('clipboard.autoCopy') }}
                                        </label>
                                    </div>

                                    <div class="flex items-center gap-2">
                                        <input type="checkbox" id="auto-refresh" v-model="settings.autoRefresh"
                                            @change="onAutoRefreshChange"
                                            class="w-5 h-5 text-blue-600 rounded focus:ring-blue-500">
                                        <label for="auto-refresh" class="text-gray-700 cursor-pointer select-none">
                                            {{ $t('clipboard.autoRefresh') }}
                                        </label>
                                    </div>

                                    <div class="flex items-center gap-2">
                                        <input type="checkbox" id="auto-save" v-model="settings.autoSave"
                                            class="w-5 h-5 text-blue-600 rounded focus:ring-blue-500">
                                        <label for="auto-save" class="text-gray-700 cursor-pointer select-none">
                                            {{ $t('clipboard.autoSave') }}
                                        </label>
                                    </div>
                                </div>

                                <div class="flex flex-wrap gap-3">
                                    <button @click="deleteClipboard" :disabled="!editorExist"
                                        :class="['px-4 py-2 rounded-lg font-medium transition-all duration-300 flex items-center gap-2',
                                                     !editorExist ? 'bg-gray-300 cursor-not-allowed' : 'bg-red-500 hover:bg-red-600 text-white']">
                                        <i class="fas fa-trash-alt"></i>
                                         {{ $t('common.delete') }}
                                    </button>

                                    <button @click="saveContent" :class="['px-4 py-2 rounded-lg font-medium transition-all duration-300 flex items-center gap-2',
                                                    'bg-green-500 hover:bg-green-600 text-white']">
                                        <i class="fas fa-save"></i>
                                         {{ $t('common.save') }}
                                    </button>

                                    <button @click="copyToClipboard" :disabled="!editorExist"
                                        :class="['px-4 py-2 rounded-lg font-medium transition-all duration-300 flex items-center gap-2',
                                                     !editorExist ? 'bg-gray-300 cursor-not-allowed' : 'bg-purple-500 hover:bg-purple-600 text-white']">
                                        <i class="fas fa-copy"></i>
                                         {{ $t('common.copy') }}
                                    </button>
                                </div>
                            </div>

                        </div>
                    </section>

                    <!-- 编辑器区域 -->
                    <section class="bg-white rounded-xl shadow-lg p-6 mb-6">
                        <div class="mb-4 flex justify-between items-center">
                            <h3 class="text-lg font-semibold text-gray-800">{{ $t('clipboard.editorTitle') }}</h3>
                            <span class="text-sm text-gray-500">{{ $t('clipboard.editorStatus', { status: editorStatusInfo }) }}</span>
                        </div>

                        <div id="editor-container" class="rounded-lg overflow-hidden border border-gray-200">
                            <textarea id="clipboard-editor" v-model="editorContent" @input="handleEditorInput"
                                class="clipboard-editor w-full h-[450px] p-4 text-[15px] leading-6 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-blue-500"
                                autofocus spellcheck="false"></textarea>
                        </div>
                    </section>

                    <!-- 状态栏 -->
                    <div class="flex justify-between items-center px-4 py-3 bg-white rounded-lg shadow">
                        <div class="text-sm text-gray-600">
                            <span class="font-medium">{{ $t('clipboard.hintLabel') }}</span> {{ $t('clipboard.editorHint') }}
                        </div>
                        <div class="text-sm text-gray-500">
                            {{ $t('clipboard.lastUpdated', { time: formattedLastUpdated }) }}
                        </div>
                    </div>
                </div>

                <!-- 首页内容 -->
                <div v-else class="max-w-4xl mx-auto">
                    <!-- 欢迎区域 -->
                    <section class="text-center mb-12">
                        <!-- 搜索框 -->
                        <div class="max-w-2xl mx-auto mb-10">
                            <div class="relative shadow-lg rounded-xl overflow-hidden">
                                <input ref="clipboardIdInput" type="text" v-model="newClipboardId" :placeholder="$t('clipboard.idPlaceholder')"
                                    @keyup.enter="goToClipboard"
                                    class="w-full px-6 py-4 text-lg border-0 focus:ring-2 focus:ring-blue-500 focus:outline-none">
                                <button @click="goToClipboard"
                                    class="absolute right-2 top-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors">
                                    {{ $t('clipboard.go') }}
                                </button>
                            </div>
                        </div>

                        <!-- 快速创建按钮 -->
                        <div class="space-x-4">
                            <button @click="createRandomClipboard"
                                class="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors">
                                <i class="fas fa-plus-circle mr-2"></i>
                                 {{ $t('clipboard.createRandom') }}
                            </button>
                        </div>
                    </section>

                    <!-- 使用说明 -->
                    <section class="bg-white rounded-xl shadow-lg p-8 mb-8">
                        <h2 class="text-2xl font-bold text-gray-800 mb-6 text-center">{{ $t('clipboard.instructions') }}</h2>

                        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div class="text-center p-4">
                                <div
                                    class="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <i class="fas fa-key text-blue-600 text-2xl"></i>
                                </div>
                                <h3 class="font-semibold text-gray-800 mb-2">{{ $t('clipboard.instructionAccessTitle') }}</h3>
                                <p class="text-gray-600">{{ $t('clipboard.instructionAccessDescription') }}</p>
                            </div>

                            <div class="text-center p-4">
                                <div
                                    class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <i class="fas fa-magic text-green-600 text-2xl"></i>
                                </div>
                                <h3 class="font-semibold text-gray-800 mb-2">{{ $t('clipboard.instructionCreateTitle') }}</h3>
                                <p class="text-gray-600">{{ $t('clipboard.instructionCreateDescription') }}</p>
                            </div>

                            <div class="text-center p-4">
                                <div
                                    class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <i class="fas fa-exclamation-triangle text-red-600 text-2xl"></i>
                                </div>
                                <h3 class="font-semibold text-gray-800 mb-2">{{ $t('clipboard.instructionSecurityTitle') }}</h3>
                                <p class="text-gray-600">{{ $t('clipboard.instructionSecurityDescription') }}</p>
                            </div>
                        </div>
                    </section>

                    <!-- 热门剪贴板示例 -->
                    <section class="bg-white rounded-xl shadow-lg p-8">
                        <h2 class="text-2xl font-bold text-gray-800 mb-6 text-center">{{ $t('clipboard.examplesTitle') }}</h2>

                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <a v-for="example in examples" :key="example.id" :href="'/clipboard/' + example.id" @click.prevent="router.push('/clipboard/' + example.id)"
                                class="block p-4 bg-gray-50 hover:bg-blue-50 rounded-lg border border-gray-200 hover:border-blue-300 transition-colors group">
                                <div class="flex items-center justify-between mb-2">
                                    <h3 class="font-medium text-gray-800 group-hover:text-blue-600">{{ example.name }}
                                    </h3>
                                    <i class="fas fa-external-link-alt text-gray-400 group-hover:text-blue-500"></i>
                                </div>
                                <p class="text-sm text-gray-600">{{ example.description }}</p>
                            </a>
                        </div>
                    </section>
                </div>
            </main>

            <!-- 页脚 -->
            <common-footer copyright="© 2025 Gloduck"></common-footer>
        </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CommonUtils } from '@/shared/common-utils.js';
import { CommonComponents } from '@/shared/common-components.js';
import { t, translateErrorMessage } from '@/i18n/index.js';

export default {
    name: 'ClipboardView',
            components: {
                'common-header': CommonComponents.Header,
                'common-footer': CommonComponents.Footer,
                'common-toast': CommonComponents.Toast
            },

            setup() {
                const route = useRoute();
                const router = useRouter();
                const clipboardId = ref(route.params.id || null);
                const newClipboardId = ref('');
                const toastRef = ref(null);
                const clipboardIdInput = ref(null);

                // 编辑器相关
                const editorContent = ref('');
                const editorStatus = ref('ready');
                const editorStatusDetail = ref('');
                const editorExist = ref(false);
                const lastUpdatedTimestamp = ref(null);

                // 默认设置
                const defaultSettings = {
                    autoCopy: false,
                    autoRefresh: false,
                    autoSave: false
                };

                // 设置 - 从localStorage加载或使用默认值
                const settings = ref({ ...defaultSettings });

                // 状态变量
                let lastUserEditTime = 0;
                let isUpdatingFromServer = false;
                let refreshInterval = null;
                let autoSaveTimeout = null;

                // 首页示例
                const examples = computed(() => [
                    { id: 'quick-notes', name: t('clipboard.examples.quickNotes.name'), description: t('clipboard.examples.quickNotes.description') },
                    { id: 'code-snippets', name: t('clipboard.examples.codeSnippets.name'), description: t('clipboard.examples.codeSnippets.description') },
                    { id: 'meeting-minutes', name: t('clipboard.examples.meetingMinutes.name'), description: t('clipboard.examples.meetingMinutes.description') }
                ]);

                // 工具函数
                const editorStatusInfo = computed(() => {
                    if (editorStatus.value === 'networkError') {
                        return `${t('common.error.networkError')}: ${editorStatusDetail.value}`;
                    }
                    return t(`clipboard.status.${editorStatus.value}`);
                });
                const formatTime = (timestamp) => {
                    if (!timestamp) return t('clipboard.neverUpdated');
                    return CommonUtils.formatTime(timestamp) || t('clipboard.neverUpdated');
                };
                const formattedLastUpdated = computed(() => formatTime(lastUpdatedTimestamp.value));

                const showToast = (message, type = 'info') => {
                    if (toastRef.value) {
                        toastRef.value.show(message, type);
                    }
                };

                // 从localStorage加载设置
                const loadSettings = () => {
                    try {
                        const savedSettings = JSON.parse(localStorage.getItem('clipboardSettings'));
                        if (savedSettings) {
                            settings.value = {
                                autoCopy: Boolean(savedSettings.autoCopy),
                                autoRefresh: Boolean(savedSettings.autoRefresh),
                                autoSave: Boolean(savedSettings.autoSave)
                            };
                        }
                    } catch (e) {
                        console.warn('Failed to load settings:', e);
                        // 如果加载失败，使用默认设置
                        settings.value = { ...defaultSettings };
                    }
                };

                // 保存设置到localStorage
                const saveSettings = () => {
                    try {
                        localStorage.setItem('clipboardSettings', JSON.stringify(settings.value));
                        console.log('Settings saved:', settings.value);
                    } catch (e) {
                        console.error('Failed to save settings:', e);
                        showToast(t('clipboard.settingsSaveFailed'), 'error');
                    }
                };

                watch(settings, (newSettings) => {
                    saveSettings();
                }, { deep: true });

                // 获取剪贴板内容
                const fetchClipboardContent = async () => {
                    if (!clipboardId.value) return;

                    // 如果最近3秒内有用户编辑，跳过此次更新
                    const now = Date.now();
                    if (now - lastUserEditTime < 3000) {
                        editorStatus.value = 'editing';
                        return;
                    }


                    try {
                        isUpdatingFromServer = true;
                        editorStatus.value = 'fetching';
                        const beforeValue = editorContent.value;

                        const response = await fetch(`/api/clipboard/query?id=${clipboardId.value}`);
                        const data = await CommonUtils.checkJsonResponseStatus(response);

                        if (data.code === 200) {
                            if (data.data === null) {
                                editorStatus.value = 'new';
                                lastUpdatedTimestamp.value = null;
                                editorExist.value = false;
                                return;
                            }

                            editorExist.value = true;
                            // 只有在内容不同时才更新编辑器
                            const newValue = data.data.content || '';
                            if (beforeValue !== newValue) {
                                editorContent.value = newValue;
                                editorStatus.value = 'updated';
                            } else {
                                editorStatus.value = 'current';
                            }

                            lastUpdatedTimestamp.value = data.data.updateDate;

                            // 如果自动复制开启且内容有变化
                            if (settings.value.autoCopy && beforeValue !== newValue) {
                                copyToClipboard();
                            }
                        } else {
                            showToast(t('clipboard.fetchFailed', { message: translateErrorMessage(data.msg) }), 'error');
                            editorStatus.value = 'fetchFailed';
                        }
                    } catch (error) {
                        const message = translateErrorMessage(error);
                        showToast(`${t('common.error.networkError')}: ${message}`, 'error');
                        editorStatusDetail.value = message;
                        editorStatus.value = 'networkError';
                    } finally {
                        isUpdatingFromServer = false;
                    }
                };

                // 保存剪贴板内容
                const saveContent = async () => {
                    if (!clipboardId.value) {
                        return;
                    }

                    const content = editorContent.value;
                    const contentType = 'text';

                    try {
                        editorStatus.value = 'saving';
                        const response = await fetch('/api/clipboard/save', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                id: clipboardId.value,
                                content: content,
                                contentType: contentType
                            })
                        });

                        const data = await CommonUtils.checkJsonResponseStatus(response);
                        if (data.code === 200) {
                            showToast(t('clipboard.saveSuccess'), 'success');
                            lastUpdatedTimestamp.value = Date.now();
                            editorExist.value = true;
                            editorStatus.value = 'saved';
                            return true;
                        } else {
                            showToast(t('clipboard.saveFailed', { message: translateErrorMessage(data.msg) }), 'error');
                            editorStatus.value = 'saveFailed';
                            return false;
                        }
                    } catch (error) {
                        const message = translateErrorMessage(error);
                        showToast(`${t('common.error.networkError')}: ${message}`, 'error');
                        editorStatusDetail.value = message;
                        editorStatus.value = 'networkError';
                        return false;
                    }
                };

                // 删除剪贴板
                const deleteClipboard = async () => {
                    if (!clipboardId.value) return;

                    if (!confirm(t('clipboard.deleteConfirm'))) {
                        return;
                    }

                    try {
                        editorStatus.value = 'deleting';
                        const response = await fetch(`/api/clipboard/delete?id=${clipboardId.value}`, {
                            method: 'DELETE'
                        });

                        const data = await CommonUtils.checkJsonResponseStatus(response);
                        if (data.code === 200) {
                            showToast(t('clipboard.deleteSuccess'), 'success');
                            editorContent.value = "";
                            editorStatus.value = 'deleted';
                            editorExist.value = false;
                            lastUpdatedTimestamp.value = null;

                            // 禁用自动刷新
                            if (refreshInterval) {
                                clearInterval(refreshInterval);
                                refreshInterval = null;
                            }
                        } else {
                            showToast(t('clipboard.deleteFailed', { message: translateErrorMessage(data.msg) }), 'error');
                            editorStatus.value = 'deleteFailed';
                        }
                    } catch (error) {
                        const message = translateErrorMessage(error);
                        showToast(`${t('common.error.networkError')}: ${message}`, 'error');
                        editorStatusDetail.value = message;
                        editorStatus.value = 'networkError';
                    }
                };

                // 复制内容到剪贴板
                const copyToClipboard = async () => {
                    try {
                        await navigator.clipboard.writeText(editorContent.value);
                        showToast(t('common.copiedToClipboard'), 'success');
                    } catch (error) {
                        console.error('Failed to copy clipboard content:', error);
                        showToast(t('common.copyFailed'), 'error');
                    }
                };

                // 自动刷新变化处理
                const onAutoRefreshChange = () => {
                    if (settings.value.autoRefresh) {
                        startAutoRefresh();
                    } else {
                        stopAutoRefresh();
                    }
                };

                const startAutoRefresh = () => {
                    if (refreshInterval) {
                        clearInterval(refreshInterval);
                    }
                    refreshInterval = setInterval(fetchClipboardContent, 3000);
                };

                const stopAutoRefresh = () => {
                    if (!refreshInterval) {
                        return;
                    }
                    clearInterval(refreshInterval);
                    refreshInterval = null;
                };

                // 防抖自动保存
                const debouncedAutoSave = () => {
                    if (autoSaveTimeout) {
                        clearTimeout(autoSaveTimeout);
                    }

                    if (settings.value.autoSave) {
                        autoSaveTimeout = setTimeout(async () => {
                            if (!editorExist.value && !editorContent.value) {
                                return;
                            }
                            const success = await saveContent();
                            if (success) {
                                showToast(t('clipboard.autoSaveSuccess'), 'success');
                            }
                        }, 1000);
                    }
                };

                const handleEditorInput = () => {
                    if (!isUpdatingFromServer) {
                        lastUserEditTime = Date.now();
                    }

                    if (settings.value.autoSave) {
                        debouncedAutoSave();
                    }
                };

                // 初始化编辑器内容
                const initEditor = () => {
                    if (!clipboardId.value) return;

                    // 初始加载内容
                    fetchClipboardContent();

                    // 设置自动刷新
                    if (settings.value.autoRefresh) {
                        startAutoRefresh();
                    }
                };

                // 首页功能
                const goToClipboard = () => {
                    const id = newClipboardId.value.trim();

                    if (!id) {
                        showToast(t('clipboard.enterId'), 'warning');
                        return;
                    }

                    if (!/^[a-zA-Z0-9\-]+$/.test(id)) {
                        showToast(t('clipboard.invalidId'), 'error');
                        return;
                    }

                    router.push(`/clipboard/${id}`);
                };

                const createRandomClipboard = () => {
                    const randomId = 'clipboard-' + Math.random().toString(36).substring(2, 10);
                    newClipboardId.value = randomId;
                    goToClipboard();
                };

                // 键盘快捷键
                const handleKeyDown = (e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                        e.preventDefault();
                        if (clipboardId.value) {
                            saveContent();
                        }
                    }
                };

                // 生命周期钩子
                onMounted(() => {
                    // 先加载设置
                    loadSettings();

                    if (clipboardId.value) {
                        // 有剪贴板ID，初始化编辑器
                        initEditor();
                    } else {
                        // 首页，聚焦输入框
                        clipboardIdInput.value?.focus();
                    }

                    // 添加键盘事件监听
                    document.addEventListener('keydown', handleKeyDown);
                });

                watch(() => route.params.id, async (newId) => {
                    clipboardId.value = newId || null;
                    editorExist.value = false;
                    lastUpdatedTimestamp.value = null;
                    editorContent.value = '';
                    editorStatus.value = 'ready';
                    editorStatusDetail.value = '';

                    if (refreshInterval) {
                        clearInterval(refreshInterval);
                        refreshInterval = null;
                    }
                    if (autoSaveTimeout) {
                        clearTimeout(autoSaveTimeout);
                        autoSaveTimeout = null;
                    }

                    if (clipboardId.value) {
                        initEditor();
                    }
                });

                onBeforeUnmount(() => {
                    // 清理定时器
                    if (refreshInterval) clearInterval(refreshInterval);
                    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);

                    // 移除事件监听
                    document.removeEventListener('keydown', handleKeyDown);
                });

                return {
                    // 数据
                    clipboardId,
                    newClipboardId,
                    toastRef,
                    clipboardIdInput,
                    editorContent,
                    editorExist,
                    editorStatusInfo,
                    formattedLastUpdated,
                    settings,
                    examples,

                    // 方法
                    goToClipboard,
                    createRandomClipboard,
                    saveContent,
                    deleteClipboard,
                    copyToClipboard,
                    onAutoRefreshChange,
                    handleEditorInput,
                    saveSettings,
                    router
                };
            }
};
</script>

<style>
.clipboard-editor {
            border-radius: 8px;
        }
</style>
