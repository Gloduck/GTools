<template>
<!-- Toast提示 -->
        <common-toast ref="toastRef"></common-toast>

        <!-- 页面容器 -->
        <div class="min-h-screen flex flex-col">
            <!-- 头部 -->
            <common-header :title="$route.meta.title" :icon="$route.meta.icon" link="/"></common-header>

            <!-- 主内容区 -->
            <main class="flex-grow container mx-auto px-4 py-8 md:py-16">
                <div class="max-w-3xl mx-auto">
                    <!-- 介绍卡片 -->
                    <div class="bg-white rounded-xl shadow-lg p-6 mb-8">
                        <h2 class="text-xl font-semibold text-gray-800 mb-3">{{ $t('forward.title') }}</h2>
                        <p class="text-gray-600 mb-4">
                            {{ $t('forward.description') }}
                        </p>

                        <!-- 输入区域 -->
                        <div class="relative mt-6">
                            <div class="flex">
                                <input type="url" v-model="fileUrl" :placeholder="$t('forward.urlPlaceholder')"
                                    class="flex-1 px-4 py-3 rounded-l-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all duration-300"
                                    @keyup.enter="startDownload">
                                <button @click="startDownload" :disabled="isDownloading" :class="[
                                        'text-white px-6 py-3 rounded-r-lg font-medium transition-all duration-300 flex items-center',
                                        isDownloading ? 'bg-gray-400 cursor-not-allowed' : 'bg-primary hover:bg-primary/90'
                                    ]">
                                    <i class="fas fa-download mr-2"></i>
                                    {{ isDownloading ? $t('forward.downloading') : $t('forward.startDownload') }}
                                </button>
                            </div>
                            <p v-if="urlError" class="text-red-500 text-sm mt-2">{{ urlError }}</p>
                        </div>
                    </div>

                    <!-- 下载状态卡片 -->
                    <div v-if="showDownloadStatus" class="bg-white rounded-xl shadow-lg p-6 mb-8">
                        <h2 class="text-xl font-semibold text-gray-800 mb-4 flex items-center">
                            <i :class="['mr-2', downloadStatusIcon]"></i>
                            <span>{{ statusText }}</span>
                        </h2>

                        <!-- 文件名 -->
                        <div class="mb-4">
                            <p class="text-sm text-gray-500">{{ $t('forward.fileName') }}</p>
                            <p class="text-gray-800 font-medium break-all">{{ fileName }}</p>
                        </div>

                        <!-- 进度条 -->
                        <div v-if="showProgress" class="mb-4">
                            <div class="flex justify-between text-sm mb-1">
                                <span class="text-gray-600">{{ $t('forward.progress') }}</span>
                                <span class="text-primary font-medium">{{ progressPercent }}%</span>
                            </div>
                            <div class="h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div class="h-full bg-primary rounded-full transition-all duration-300"
                                    :style="{ width: progressPercent + '%' }"></div>
                            </div>
                        </div>

                        <!-- 下载信息 -->
                        <div class="grid grid-cols-2 gap-4 text-sm">
                            <div>
                                <p class="text-gray-500">{{ $t('forward.downloaded') }}</p>
                                <p class="text-gray-800 font-medium">{{ downloadedSize }}</p>
                            </div>
                            <div>
                                <p class="text-gray-500">{{ $t('forward.speed') }}</p>
                                <p class="text-gray-800 font-medium">{{ downloadSpeed }}</p>
                            </div>
                        </div>

                        <!-- 取消按钮 -->
                        <div class="mt-6">
                            <button @click="cancelDownload"
                                class="bg-gray-200 hover:bg-gray-300 text-gray-700 px-6 py-2 rounded-lg font-medium transition-all duration-300">
                                <i class="fas fa-times mr-2"></i>{{ $t('common.cancel') }}
                            </button>
                        </div>
                    </div>

                    <!-- 下载历史 -->
                    <div class="bg-white rounded-xl shadow-lg p-6">
                        <!-- 修改点1：添加清除按钮的标题栏 -->
                        <div class="flex justify-between items-center mb-4">
                            <h2 class="text-xl font-semibold text-gray-800 flex items-center">
                                <i class="fas fa-history mr-2 text-primary"></i>
                                <span>{{ $t('forward.history') }}</span>
                            </h2>
                            <!-- 清除下载历史按钮：仅当有历史记录时显示 -->
                            <button v-if="downloadHistory.length > 0" @click="clearDownloadHistory"
                                class="text-sm text-red-500 hover:text-red-600 flex items-center transition-all duration-300">
                                <i class="fas fa-trash-alt mr-1"></i>
                                {{ $t('common.clear') }}
                            </button>
                        </div>

                        <div class="space-y-3">
                            <div v-if="downloadHistory.length === 0"
                                class="text-center text-gray-500 py-8 border border-dashed border-gray-200 rounded-lg">
                                <i class="fas fa-file-download text-3xl mb-2 text-gray-300"></i>
                                <p>{{ $t('forward.emptyHistory') }}</p>
                            </div>

                            <div v-for="item in downloadHistory" :key="item.id"
                                class="flex items-center justify-between p-3 border border-gray-100 rounded-lg hover:bg-gray-50 transition-all duration-300">
                                <div class="flex items-center">
                                    <i class="fas fa-file mr-3 text-primary"></i>
                                    <div>
                                        <p class="font-medium text-gray-800 break-all">{{ item.fileName }}</p>
                                        <p class="text-xs text-gray-500 mt-0.5">{{ formatTime(item.timestamp) }}</p>
                                    </div>
                                </div>
                                <div class="flex items-center">
                                    <span :class="['text-xs mr-3', 
                                                  item.status === 'success' ? 'text-green-500' : 'text-red-500']">
                                        <i
                                            :class="[item.status === 'success' ? 'fas fa-check-circle' : 'fas fa-times-circle']"></i>
                                        {{ $t(`forward.historyStatus.${item.status}`) }}
                                    </span>
                                    <button @click="copyUrl(item.url)"
                                        class="text-gray-400 hover:text-primary transition-all duration-300">
                                        <i class="fas fa-link"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </main>

            <!-- 页脚 -->
            <common-footer copyright="© 2025 Gloduck"></common-footer>
        </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { CommonUtils } from '@/shared/common-utils.js';
import { CommonComponents } from '@/shared/common-components.js';
import { downloadFile } from '@/shared/file-downloader.js';
import { t, translateErrorMessage } from '@/i18n/index.js';

export default {
    name: 'ForwardView',
            components: {
                'common-header': CommonComponents.Header,
                'common-footer': CommonComponents.Footer,
                'common-toast': CommonComponents.Toast,
            },

            setup() {
                // 公共工具函数
                const formatFileSize = CommonUtils.formatFileSize;
                const showToast = (message, type) => {
                    if (toastRef.value) {
                        toastRef.value.show(message, type);
                    } else {
                        alert(message);
                    }
                };

                // 响应式数据
                const toastRef = ref(null);
                const fileUrl = ref('');
                const urlError = ref('');
                const isDownloading = ref(false);
                const showDownloadStatus = ref(false);
                const showProgress = ref(false);

                // 下载状态
                const downloadStatus = ref('preparing');
                const statusErrorMessage = ref('');
                const fileName = ref('-');
                const progressPercent = ref(0);
                const downloadedBytes = ref(0);
                const downloadedSize = computed(() => formatFileSize(downloadedBytes.value));
                const downloadSpeed = ref('-');

                // 下载控制
                let abortController = null;
                let downloadStartTime = 0;
                let lastDownloadedBytes = 0;
                let speedInterval = null;

                // 下载历史
                const downloadHistory = ref([]);

                const statusText = computed(() => t(`forward.status.${downloadStatus.value}`, {
                    message: statusErrorMessage.value
                }));

                // 计算下载状态图标
                const downloadStatusIcon = computed(() => {
                    if (downloadStatus.value === 'connecting' || downloadStatus.value === 'downloading') {
                        return 'fas fa-circle-notch fa-spin text-primary';
                    } else if (downloadStatus.value === 'completed') {
                        return 'fas fa-check-circle text-green-500';
                    } else if (downloadStatus.value === 'failed' || downloadStatus.value === 'cancelled') {
                        return 'fas fa-times-circle text-red-500';
                    }
                    return 'fas fa-circle-notch text-primary';
                });

                const formatTime = (timestamp) => {
                    if (!timestamp) return t('common.unknown');
                    return CommonUtils.formatTime(timestamp) || t('common.unknown');
                };

                // 从URL解析文件名
                const getFileNameFromUrl = (url) => {
                    try {
                        const urlObj = new URL(url);
                        const pathname = urlObj.pathname;
                        const fileName = pathname.split('/').pop();
                        return fileName || t('forward.defaultFileName');
                    } catch (e) {
                        return t('forward.defaultFileName');
                    }
                };

                // 验证URL
                const isValidUrl = (url) => {
                    try {
                        new URL(url);
                        return true;
                    } catch (e) {
                        return false;
                    }
                };

                // 添加到下载历史
                const addToHistory = (fileName, status, url) => {
                    const historyItem = {
                        id: Date.now(),
                        fileName: fileName,
                        status: status,
                        url: url,
                        timestamp: new Date().toISOString()
                    };

                    downloadHistory.value.unshift(historyItem);

                    // 限制历史记录数量
                    if (downloadHistory.value.length > 20) {
                        downloadHistory.value = downloadHistory.value.slice(0, 20);
                    }

                    // 保存到localStorage
                    try {
                        localStorage.setItem('downloadHistory', JSON.stringify(downloadHistory.value.slice(0, 10)));
                    } catch (e) {
                        console.error('保存历史记录失败:', e);
                    }
                };

                // 复制URL
                const copyUrl = async (url) => {
                    try {
                        await navigator.clipboard.writeText(url);
                        showToast(t('common.copiedToClipboard'), 'success');
                    } catch (error) {
                        console.error('Failed to copy download URL:', error);
                        showToast(t('common.copyFailed'), 'error');
                    }
                };

                // 计算下载速度
                const calculateSpeed = () => {
                    if (!isDownloading.value) return;

                    const currentTime = Date.now();
                    const elapsedTime = (currentTime - downloadStartTime) / 1000;

                    if (elapsedTime > 0) {
                        const bytesSinceLastCheck = downloadedBytes.value - lastDownloadedBytes;
                        lastDownloadedBytes = downloadedBytes.value;
                        downloadSpeed.value = formatFileSize(bytesSinceLastCheck) + '/s';
                    }
                };

                // 开始下载
                const startDownload = async () => {
                    const url = fileUrl.value.trim();

                    // 验证输入
                    if (!url || !isValidUrl(url)) {
                        urlError.value = t('forward.invalidUrl');
                        return;
                    }

                    urlError.value = '';

                    const targetUrl = new URL(url);
                    const proxyUrl = `/api/requestProxy${targetUrl.pathname}${targetUrl.search}${targetUrl.search ? '&' : '?'}X-Proxy-Host=${encodeURIComponent(`${targetUrl.protocol}//${targetUrl.host}`)}&X-Proxy-Cors=true&X-Proxy-Follow-Redirect=true`;

                    // 显示下载状态面板
                    isDownloading.value = true;
                    showDownloadStatus.value = true;
                    showProgress.value = true;
                    downloadStatus.value = 'connecting';
                    statusErrorMessage.value = '';
                    fileName.value = getFileNameFromUrl(url);
                    progressPercent.value = 0;
                    downloadedBytes.value = 0;
                    downloadSpeed.value = '-';

                    // 创建AbortController用于取消请求
                    abortController = new AbortController();

                    // 记录开始时间
                    downloadStartTime = Date.now();
                    lastDownloadedBytes = 0;

                    // 启动速度计算定时器
                    clearInterval(speedInterval);
                    speedInterval = setInterval(calculateSpeed, 1000);

                    try {
                        const initialFileName = getFileNameFromUrl(url);
                        await downloadFile({
                            fileName: initialFileName,
                            signal: abortController.signal,
                            openStream: async () => {
                                const response = await fetch(proxyUrl, {
                                    method: 'GET',
                                    signal: abortController.signal,
                                    headers: {
                                        'Accept': '*/*'
                                    }
                                });

                                if (!response.ok) {
                                    const errorBody = (await response.text()).trim();
                                    let translatedError = errorBody;
                                    try {
                                        translatedError = translateErrorMessage(JSON.parse(errorBody));
                                    } catch {
                                        translatedError = translateErrorMessage(errorBody);
                                    }
                                    const detail = translatedError ? `: ${translatedError}` : '';
                                    throw new Error(t('forward.httpError', { status: response.status, detail }));
                                }
                                if (!response.body) throw new Error('Streaming response body is unavailable');

                                fileName.value = initialFileName;
                                downloadStatus.value = 'downloading';
                                const contentLength = response.headers.get('Content-Length');
                                const totalBytes = contentLength == null ? null : Number(contentLength);
                                return {
                                    stream: response.body,
                                    size: Number.isFinite(totalBytes) && totalBytes >= 0 ? totalBytes : null,
                                };
                            },
                            onProgress: (loaded, total) => {
                                downloadedBytes.value = loaded;
                                if (total) progressPercent.value = Math.round((loaded / total) * 100);
                            }
                        });

                        downloadStatus.value = 'completed';
                        progressPercent.value = 100;
                        downloadSpeed.value = '-';
                        addToHistory(fileName.value, 'success', fileUrl.value);
                        showToast(t('forward.downloadComplete'), 'success');
                    } catch (error) {
                        if (error.name !== 'AbortError') {
                            console.error('下载错误:', error);
                            downloadStatus.value = 'failed';
                            statusErrorMessage.value = translateErrorMessage(error);
                            downloadSpeed.value = '-';
                            showToast(t('forward.downloadFailed', { message: statusErrorMessage.value }), 'error');

                            // 添加到历史记录
                            addToHistory(fileName.value, 'failed', fileUrl.value);
                        } else {
                            downloadStatus.value = 'cancelled';
                            showToast(t('forward.downloadCancelled'), 'warning');
                        }
                    } finally {
                        // 清理
                        clearInterval(speedInterval);
                        isDownloading.value = false;
                        showProgress.value = false;
                        abortController = null;

                        // 3秒后自动隐藏下载状态
                        setTimeout(() => {
                            if (!isDownloading.value) {
                                showDownloadStatus.value = false;
                            }
                        }, 3000);
                    }
                };

                // 取消下载
                const cancelDownload = () => {
                    if (abortController) {
                        abortController.abort();
                        downloadStatus.value = 'cancelled';
                        downloadSpeed.value = '-';

                        // 添加到历史记录
                        addToHistory(fileName.value, 'cancelled', fileUrl.value);
                        showToast(t('forward.downloadCancelled'), 'warning');
                    }
                };

                // 加载历史记录
                const loadHistory = () => {
                    try {
                        const savedHistory = localStorage.getItem('downloadHistory');
                        if (savedHistory) {
                            downloadHistory.value = JSON.parse(savedHistory);
                        }
                    } catch (e) {
                        console.error('加载历史记录失败:', e);
                    }
                };

                // 修改点2：添加清除下载历史的方法
                const clearDownloadHistory = () => {
                    // 确认是否清除（可选：增加确认提示提升用户体验）
                    if (confirm(t('forward.clearHistoryConfirm'))) {
                        // 清空内存中的历史记录
                        downloadHistory.value = [];
                        // 删除本地存储中的历史记录
                        try {
                            localStorage.removeItem('downloadHistory');
                            showToast(t('forward.historyCleared'), 'success');
                        } catch (e) {
                            console.error('清除本地历史记录失败:', e);
                            showToast(t('forward.clearHistoryFailed'), 'error');
                        }
                    }
                };

                // 页面加载时初始化
                onMounted(() => {
                    loadHistory();
                });

                onBeforeUnmount(() => {
                    clearInterval(speedInterval);
                    if (abortController) {
                        abortController.abort();
                    }
                });

                return {
                    // 数据
                    toastRef,
                    fileUrl,
                    urlError,
                    isDownloading,
                    showDownloadStatus,
                    showProgress,
                    statusText,
                    fileName,
                    progressPercent,
                    downloadedSize,
                    downloadSpeed,
                    downloadHistory,

                    // 计算属性
                    downloadStatusIcon,

                    // 方法
                    formatTime,
                    startDownload,
                    cancelDownload,
                    copyUrl,
                    // 修改点3：暴露清除历史的方法
                    clearDownloadHistory
                };
            }
};
</script>

<style>
.content-auto { content-visibility: auto; }
</style>
