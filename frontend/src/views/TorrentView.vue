<template>
<!-- Toast提示 -->
        <common-toast ref="toastRef"></common-toast>

        <!-- 页面容器 -->
        <div class="min-h-screen flex flex-col">
            <!-- 头部 -->
            <common-header :title="$route.meta.title" :icon="$route.meta.icon" link="/"></common-header>

            <!-- 主内容区 -->
            <main class="flex-grow container mx-auto px-4 py-8">
                <!-- 搜索区域 -->
                <section
                    class="bg-white rounded-xl shadow-lg p-6 mb-8 transform transition-all duration-300 hover:shadow-xl">
                    <form @submit.prevent="searchTorrents" class="flex flex-col md:flex-row gap-4">
                        <div class="flex-grow relative">
                            <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                            <input type="text" v-model="keyword" :placeholder="$t('torrent.searchPlaceholder')"
                                class="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                                required>
                        </div>

                        <div class="w-full md:w-auto">
                            <select v-model="selectedHandler"
                                class="w-full md:w-48 bg-white border border-gray-300 text-gray-700 py-3 px-4 pr-8 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-no-repeat bg-right">
                                <option value="" disabled>{{ $t('torrent.selectSearchSource') }}</option>
                                <option v-for="handler in handlers" :key="handler.code" :value="handler.code"
                                    :disabled="!handler.available">
                                    {{ handler.code }} {{ handler.tags && handler.tags.length > 0 ?
                                    `(${handler.tags.join(',')})` : '' }}
                                </option>
                            </select>
                        </div>

                        <!-- 排序选择器 -->
                        <div v-if="currentHandlerInfo && currentHandlerInfo.supportSortFields && currentHandlerInfo.supportSortFields.length > 0"
                            class="w-full md:w-auto">
                            <select v-model="currentSort"
                                class="w-full md:w-48 bg-white border border-gray-300 text-gray-700 py-3 px-4 pr-8 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-no-repeat bg-right">
                                <option value="">{{ $t('torrent.defaultSort') }}</option>
                                <option
                                    v-for="option in availableSortOptions"
                                    :key="option.value"
                                    :value="option.value">
                                    {{ option.label }}
                                </option>
                            </select>
                        </div>

                        <button type="submit" :disabled="isLoading"
                            :class="['w-full md:w-auto text-white font-medium py-3 px-6 rounded-lg transition-all duration-300 transform hover:scale-105 flex items-center justify-center gap-2',
                                         isLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-primary hover:bg-secondary']">
                            <i class="fas fa-search"></i>
                            <span>{{ $t('common.search') }}</span>
                        </button>
                    </form>

                    <div class="mt-4 flex flex-wrap gap-2">
                        <span class="text-sm text-gray-500">{{ $t('torrent.availableSearchSources') }}</span>
                        <div class="flex flex-wrap gap-2">
                            <span v-for="handler in handlers" :key="handler.code"
                                :class="['px-2 py-1 rounded-full text-xs', 
                                         handler.available ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-500']">
                                {{ handler.code }}
                                <i v-if="handler.supportSortFields && handler.supportSortFields.length > 0"
                                    class="fas fa-sort ml-1 text-xs"></i>
                            </span>
                        </div>
                    </div>
                </section>

                <!-- 搜索结果区域 -->
                <section v-if="showResults" class="mb-8">
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
                        <h2 class="text-xl font-bold text-gray-800">
                            {{ $t('torrent.searchResults') }}
                            <span v-if="results.length > 0" class="text-primary font-normal text-base">
                                {{ $t('torrent.currentPageResultCount', { count: formatNumber(results.length) }) }}
                            </span>
                        </h2>
                        <div class="text-sm text-gray-500 w-full sm:w-auto flex justify-between items-center gap-4">
                            <span v-if="currentHandlerInfo">{{ $t('torrent.currentSearchSource', { code: currentHandlerInfo.code, url: currentHandlerInfo.url }) }}</span>
                            <span v-if="sortInfo" class="italic">{{ sortInfo }}</span>
                        </div>
                    </div>

                    <!-- 加载动画 -->
                    <common-loading-spinner v-if="isLoading"></common-loading-spinner>

                    <!-- 结果列表 -->
                    <div v-else>
                        <!-- 无结果提示 -->
                        <div v-if="results.length === 0" class="py-16 text-center">
                            <i class="fas fa-search-minus text-5xl text-gray-300 mb-4"></i>
                            <p class="text-gray-500 text-lg">{{ $t('torrent.noMatchingResults') }}</p>
                        </div>

                        <!-- 结果项 -->
                        <div v-else class="space-y-4">
                            <div v-for="item in results" :key="item.id" @click="showDetailModal(item)"
                                class="bg-white rounded-lg shadow p-4 hover:shadow-md transition-all cursor-pointer transform hover:-translate-y-1 duration-200 border-l-4 border-primary">
                                <div class="flex flex-col md:flex-row md:items-start justify-between gap-3">
                                    <div class="flex-grow min-w-0">
                                        <h3 class="font-semibold text-gray-800 mb-2 break-all"
                                            :title="item.name">
                                            {{ item.name }}
                                        </h3>
                                        <div class="flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-500">
                                            <div class="flex items-center gap-1">
                                                <i class="fas fa-hashtag text-primary/70"></i>
                                                <span class="truncate max-w-[180px] md:max-w-[250px]"
                                                    :title="item.hash">{{ item.hash }}</span>
                                            </div>
                                            <div class="flex items-center gap-1">
                                                <i class="fas fa-file-size text-primary/70"></i>
                                                <span>{{ formatFileSize(item.size) }}</span>
                                            </div>
                                            <div class="flex items-center gap-1">
                                                <i class="fas fa-clock text-primary/70"></i>
                                                <span>{{ formatTime(item.uploadTime) }}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        class="text-primary hover:text-secondary transition-colors px-3 py-1 rounded flex items-center gap-1 mt-2 md:mt-0">
                                        <span>{{ $t('common.details') }}</span>
                                        <i class="fas fa-chevron-right text-xs"></i>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- 分页控制 -->
                        <common-pagination v-if="results.length > 0" :current-page="currentPage" :has-next="hasNextPage"
                            @prev-page="prevPage" @next-page="nextPage">
                        </common-pagination>
                    </div>
                </section>
            </main>

            <!-- 页脚 -->
            <common-footer copyright="© 2025 Gloduck"></common-footer>
        </div>

        <!-- 详情弹窗 -->
        <common-modal v-model:visible="showDetailModalVisible" :title="selectedItem ? selectedItem.name : ''">
            <div v-if="selectedItem">
                <common-loading-spinner v-if="loadingDetail"></common-loading-spinner>
                <div v-else class="space-y-6">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="bg-neutral p-4 rounded-lg">
                            <h4 class="text-sm text-gray-500 mb-1">{{ $t('torrent.hash') }}</h4>
                            <p id="detailHash" class="font-mono text-sm break-all">{{ detailData?.hash || $t('common.unknown') }}</p>
                        </div>
                        <div class="bg-neutral p-4 rounded-lg">
                            <h4 class="text-sm text-gray-500 mb-1">{{ $t('torrent.size') }}</h4>
                            <p>{{ formatFileSize(detailData?.size || 0) }}</p>
                        </div>
                        <div class="bg-neutral p-4 rounded-lg">
                            <h4 class="text-sm text-gray-500 mb-1">{{ $t('torrent.uploadTime') }}</h4>
                            <p>{{ formatTime(detailData?.uploadTime) }}</p>
                        </div>
                        <div class="bg-neutral p-4 rounded-lg">
                            <h4 class="text-sm text-gray-500 mb-1">{{ $t('torrent.fileCount') }}</h4>
                            <p>{{ detailData?.fileCount !== null && detailData?.fileCount !== undefined ? formatNumber(detailData.fileCount) : $t('common.unknown') }}</p>
                        </div>
                    </div>

                    <div>
                        <h4 class="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                            <i class="fas fa-file-alt text-primary"></i>
                             {{ $t('torrent.includedFiles') }}
                        </h4>
                        <div v-if="!detailData?.files || detailData.files.length === 0"
                            class="text-center py-4 text-gray-500">
                             <i class="fas fa-file-excel-o mr-2"></i>{{ $t('torrent.fileListUnavailable') }}
                        </div>
                        <ul v-else class="space-y-2 max-h-60 overflow-y-auto pr-2">
                            <li v-for="file in detailData.files" :key="file.name"
                                class="flex justify-between items-center p-2 bg-neutral rounded hover:bg-gray-100 transition-colors">
                                <span class="truncate max-w-[80%]" :title="file.name">{{ file.name }}</span>
                                <span class="text-sm text-gray-500 whitespace-nowrap">{{ formatFileSize(file.size)
                                    }}</span>
                            </li>
                        </ul>
                    </div>

                    <div class="pt-4 border-t border-gray-200">
                        <button @click="copyMagnetLink" v-if="detailData?.hash"
                            class="bg-primary hover:bg-secondary text-white font-medium py-2 px-4 rounded-lg transition-all duration-300 flex items-center gap-2">
                            <i class="fas fa-magnet"></i>
                             <span>{{ $t('torrent.copyMagnetLink') }}</span>
                        </button>
                    </div>
                </div>
            </div>
        </common-modal>
</template>

<script>
import { ref, computed, onMounted, watch } from 'vue';
import { CommonUtils } from '@/shared/common-utils.js';
import { CommonComponents } from '@/shared/common-components.js';
import { t, currentLocale, translateErrorMessage } from '@/i18n/index.js';

export default {
    name: 'TorrentView',
            components: {
                'common-header': CommonComponents.Header,
                'common-footer': CommonComponents.Footer,
                'common-toast': CommonComponents.Toast,
                'common-loading-spinner': CommonComponents.LoadingSpinner,
                'common-pagination': CommonComponents.Pagination,
                'common-modal': CommonComponents.Modal
            },

            setup() {
                // 排序字段显示名称映射
                const sortFieldKeys = {
                    'name': 'torrent.sortFields.name',
                    'uploadTime': 'torrent.sortFields.uploadTime',
                    'size': 'torrent.sortFields.size',
                    'relevance': 'torrent.sortFields.relevance',
                    'fileCount': 'torrent.sortFields.fileCount'
                };

                const sortOrderKeys = {
                    'asc': 'torrent.sortOrders.asc',
                    'desc': 'torrent.sortOrders.desc'
                };

                // 搜索相关
                const toastRef = ref(null);
                const keyword = ref('');
                const selectedHandler = ref('');
                const currentSort = ref('');
                const results = ref([]);
                const isLoading = ref(false);
                const showResults = ref(false);
                const currentPage = ref(1);
                const pageSize = 50;
                const hasNextPage = ref(false);

                // 弹窗相关
                const showDetailModalVisible = ref(false);
                const loadingDetail = ref(false);

                // 选中的数据
                const selectedItem = ref(null);
                const detailData = ref(null);

                // 搜索源数据
                const handlers = ref([]);
                const currentHandlerInfo = ref(null);

                // 公共工具函数
                const formatFileSize = CommonUtils.formatFileSize;
                const checkJsonResponseStatus = CommonUtils.checkJsonResponseStatus;
                const locale = () => currentLocale.value || currentLocale;
                const formatNumber = (value) => Number(value || 0).toLocaleString(locale());
                const formatTime = (timeString) => {
                    if (!timeString) return t('common.unknown');
                    return CommonUtils.formatTime(timeString) || t('common.unknown');
                };
                const copyToClipboard = (text) => {
                    navigator.clipboard.writeText(text)
                        .then(() => showToast(t('torrent.magnetLinkCopied'), 'success'))
                        .catch((error) => {
                            console.error('Copy failed:', error);
                            showToast(t('common.copyFailed'), 'error');
                        });
                };
                const handleApiError = (error) => {
                    console.error('API request failed:', error);
                    showToast(translateErrorMessage(error || t('torrent.requestFailed')), 'error');
                };

                // 排序信息
                const sortInfo = computed(() => {
                    if (!currentSort.value) return '';
                    const [field, order] = currentSort.value.split('-');
                    const fieldLabel = sortFieldKeys[field] ? t(sortFieldKeys[field]) : field;
                    const orderLabel = sortOrderKeys[order] ? t(sortOrderKeys[order]) : order;
                    return t('torrent.sortInfo', { field: fieldLabel, order: orderLabel });
                });

                // 生成可用的排序选项
                // 格式: "+field" = 只支持升序, "-field" = 只支持降序, "field" = 支持两种排序
                const availableSortOptions = computed(() => {
                    if (!currentHandlerInfo.value || !currentHandlerInfo.value.supportSortFields) {
                        return [];
                    }
                    const options = [];
                    for (const field of currentHandlerInfo.value.supportSortFields) {
                        if (!field) continue;
                        let fieldName = field;
                        let orders = [];

                        // 解析字段格式
                        if (field.startsWith('+')) {
                            fieldName = field.substring(1);
                            orders = ['asc'];
                        } else if (field.startsWith('-')) {
                            fieldName = field.substring(1);
                            orders = ['desc'];
                        } else {
                            fieldName = field;
                            orders = [
                                'asc',
                                'desc'
                            ];
                        }

                        const nameLabel = sortFieldKeys[fieldName] ? t(sortFieldKeys[fieldName]) : fieldName;
                        for (const order of orders) {
                            const orderLabel = sortOrderKeys[order] ? t(sortOrderKeys[order]) : order;
                            options.push({
                                value: `${fieldName}-${order}`,
                                label: `${nameLabel}-${orderLabel}`
                            });
                        }
                    }
                    return options;
                });

                // 获取排序字段标签
                const getSortFieldLabel = (field) => {
                    return sortFieldKeys[field] ? t(sortFieldKeys[field]) : field;
                };

                // 获取排序顺序标签
                const getSortOrderLabel = (order) => {
                    return sortOrderKeys[order] ? t(sortOrderKeys[order]) : order;
                };

                // 显示提示
                const showToast = (message, type) => {
                    if (toastRef.value) {
                        toastRef.value.show(message, type);
                    } else {
                        alert(message);
                    }
                };

                // 加载搜索源
                const loadHandlers = async () => {
                    try {
                        const response = await fetch(`/api/torrent/listHandlers`);
                        const data = await checkJsonResponseStatus(response);

                        if (data.code === 200 && Array.isArray(data.data)) {
                            handlers.value = data.data;
                            if (handlers.value.length > 0) {
                                selectedHandler.value = handlers.value[0].available ? handlers.value[0].code : '';
                            }
                        } else {
                            throw new Error(data?.msg || t('torrent.loadSourcesFailed'));
                        }
                    } catch (error) {
                        handleApiError(error, showToast);
                        handlers.value = [];
                    }
                };

                const updateCurrentHandlerInfo = () => {
                    currentHandlerInfo.value = handlers.value.find(h => h.code === selectedHandler.value);
                    // 如果当前handler不支持排序，清空排序选择
                    if (!currentHandlerInfo.value || !currentHandlerInfo.value.supportSortFields || currentHandlerInfo.value.supportSortFields.length === 0) {
                        currentSort.value = '';
                    }
                };

                // 搜索磁力资源
                const searchTorrents = async () => {
                    if (!keyword.value.trim()) {
                        showToast(t('common.searchKeywordRequired'), 'warning');
                        return;
                    }

                    if (!selectedHandler.value) {
                        showToast(t('torrent.searchSourceRequired'), 'warning');
                        return;
                    }

                    isLoading.value = true;
                    showResults.value = true;

                    try {
                        const url = new URL(`/api/torrent/search`, window.location.origin);
                        url.searchParams.append('pageIndex', currentPage.value);
                        url.searchParams.append('pageSize', pageSize);
                        url.searchParams.append('code', selectedHandler.value);
                        url.searchParams.append('keyword', keyword.value);

                        // 添加排序参数
                        if (currentSort.value) {
                            const [sortField, sortOrder] = currentSort.value.split('-');
                            if (sortField) {
                                url.searchParams.append('sortField', sortField);
                                url.searchParams.append('sortOrder', sortOrder);
                            }
                        }

                        const response = await fetch(url.toString());
                        const data = await checkJsonResponseStatus(response);

                        if (data.code === 200 && data.data) {
                            results.value = data.data.items || [];
                            hasNextPage.value = data.data.hasNext || false;
                        } else {
                            throw new Error(data?.msg || t('torrent.searchFailed'));
                        }
                    } catch (error) {
                        handleApiError(error, showToast);
                        results.value = [];
                        hasNextPage.value = false;
                    } finally {
                        isLoading.value = false;
                    }
                };

                // 分页
                const prevPage = () => {
                    if (currentPage.value > 1) {
                        currentPage.value--;
                        searchTorrents();
                    }
                };

                const nextPage = () => {
                    if (hasNextPage.value) {
                        currentPage.value++;
                        searchTorrents();
                    }
                };

                // 显示详情弹窗
                const showDetailModal = async (item) => {
                    selectedItem.value = item;
                    detailData.value = null;
                    showDetailModalVisible.value = true;
                    loadingDetail.value = true;

                    try {
                        const url = new URL(`/api/torrent/queryDetail`, window.location.origin);
                        url.searchParams.append('code', selectedHandler.value);
                        url.searchParams.append('id', item.id);

                        const response = await fetch(url.toString());
                        const data = await checkJsonResponseStatus(response);

                        if (data.code === 200 && data.data) {
                            detailData.value = data.data;
                        } else {
                            throw new Error(data?.msg || t('torrent.loadDetailsFailed'));
                        }
                    } catch (error) {
                        handleApiError(error, showToast);
                        detailData.value = null;
                    } finally {
                        loadingDetail.value = false;
                    }
                };

                // 复制磁力链接
                const copyMagnetLink = () => {
                    if (!detailData.value?.hash) {
                        showToast(t('torrent.noMagnetLink'), 'warning');
                        return;
                    }

                    const magnetLink = `magnet:?xt=urn:btih:${detailData.value.hash}`;
                    copyToClipboard(magnetLink);
                };

                const searchTorrentsIfNecessary = () => {
                    if (keyword.value.trim() && selectedHandler.value) {
                        currentPage.value = 1;
                        searchTorrents();
                    }
                }

                // 页面加载时初始化
                onMounted(async () => {
                    await loadHandlers();
                    updateCurrentHandlerInfo(); // 初始加载后更新handler信息

                });

                // 监听搜索源变化，更新handler信息并清空不支持的排序
                watch(selectedHandler, () => {
                    updateCurrentHandlerInfo();
                    searchTorrentsIfNecessary();
                });

                // 监听排序方式变化，自动执行搜索（重置页码）
                watch(currentSort, () => {
                    searchTorrentsIfNecessary();
                });



                return {
                    // 数据
                    toastRef,
                    keyword,
                    selectedHandler,
                    currentSort,
                    results,
                    isLoading,
                    showResults,
                    currentPage,
                    hasNextPage,
                    handlers,
                    availableSortOptions,
                    currentHandlerInfo,
                    sortInfo,

                    // 弹窗
                    showDetailModalVisible,
                    loadingDetail,
                    selectedItem,
                    detailData,

                    // 方法
                    searchTorrents,
                    prevPage,
                    nextPage,
                    showDetailModal,
                    copyMagnetLink,
                    getSortFieldLabel,
                    getSortOrderLabel,

                    // 工具函数
                    formatTime,
                    formatFileSize,
                    formatNumber
                };
            }
};
</script>

<style>
.content-auto { content-visibility: auto; }
</style>
