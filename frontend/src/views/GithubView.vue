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
                    <form @submit.prevent="searchRepositories" class="flex flex-col md:flex-row gap-4">
                        <div class="flex-grow relative">
                            <i class="fab fa-github absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
                            <input type="text" v-model="keyword" :placeholder="$t('github.searchPlaceholder')"
                                class="w-full pl-10 pr-4 py-3 rounded-lg border border-gray-300 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all">
                        </div>

                        <div class="w-full md:w-auto">
                            <select v-model="sortBy"
                                class="w-full md:w-48 bg-white border border-gray-300 text-gray-700 py-3 px-4 pr-8 rounded-lg appearance-none focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all bg-no-repeat bg-right">
                                <option value="stars">{{ $t('github.sort.stars') }}</option>
                                <option value="updated">{{ $t('github.sort.updated') }}</option>
                                <option value="forks">{{ $t('github.sort.forks') }}</option>
                                <option value="help-wanted-issues">{{ $t('github.sort.helpWanted') }}</option>
                            </select>
                        </div>

                        <button type="submit" :disabled="isLoading"
                            :class="['w-full md:w-auto text-white font-medium py-3 px-6 rounded-lg transition-all duration-300 transform hover:scale-105 flex items-center justify-center gap-2',
                                         isLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-primary hover:bg-secondary']">
                            <i class="fas fa-search"></i>
                            <span>{{ $t('common.search') }}</span>
                        </button>
                    </form>

                    <div class="mt-4">
                        <p class="text-sm text-gray-500 mb-2">{{ $t('github.searchTip') }}</p>
                        <div class="flex flex-wrap gap-2">
                            <span class="text-sm text-gray-500">{{ $t('github.popularSearches') }}</span>
                            <button v-for="example in examples" :key="example"
                                @click="keyword = example; searchRepositories()"
                                class="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full transition-colors">
                                {{ example }}
                            </button>
                        </div>
                    </div>
                </section>

                <!-- 搜索结果区域 -->
                <section v-if="showResults" class="mb-8">
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-3">
                        <h2 class="text-xl font-bold text-gray-800">
                            {{ $t('github.searchResults') }}
                            <span v-if="results.length > 0" class="text-primary font-normal text-base">
                                {{ $t('github.resultSummary', { total: formatNumber(totalCount), shown: formatNumber(Math.min(pageSize, results.length)) }) }}
                            </span>
                        </h2>
                        <div class="text-sm text-gray-500 w-full sm:w-auto flex justify-between items-center gap-4">
                            <span v-if="totalCount > 0">{{ $t('github.totalRepositories', { count: formatNumber(totalCount) }) }}</span>
                        </div>
                    </div>

                    <!-- 加载动画 -->
                    <common-loading-spinner v-if="isLoading"></common-loading-spinner>

                    <!-- 结果列表 -->
                    <div v-else>
                        <!-- 无结果提示 -->
                        <div v-if="results.length === 0" class="py-16 text-center">
                            <i class="fab fa-github text-5xl text-gray-300 mb-4"></i>
                            <p class="text-gray-500 text-lg">{{ $t('github.noMatchingRepositories') }}</p>
                            <p class="text-gray-400 text-sm mt-2">{{ $t('github.tryAnotherKeyword') }}</p>
                        </div>

                        <!-- 结果项 -->
                        <div v-else class="space-y-4">
                            <div v-for="repo in results" :key="repo.id" @click="showRepoDetail(repo)"
                                class="bg-white rounded-lg shadow p-4 hover:shadow-md transition-all cursor-pointer transform hover:-translate-y-1 duration-200 border-l-4 border-githubBlue">
                                <div class="flex flex-col md:flex-row md:items-start justify-between gap-3">
                                    <div class="flex-grow min-w-0">
                                        <div class="flex items-center gap-2 mb-2">
                                            <i class="fab fa-github text-gray-500"></i>
                                            <h3 class="font-semibold text-gray-800 text-lg" :title="repo.fullName">{{
                                                repo.fullName }}</h3>
                                            <span v-if="repo.isPrivate"
                                                class="px-2 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded-full">{{ $t('github.private') }}</span>
                                        </div>
                                        <p class="text-gray-600 mb-3 break-all"
                                            :title="truncateText(repo.description) || $t('github.noDescription')">
                                            {{ truncateText(repo.description) || $t('github.repositoryHasNoDescription') }}
                                        </p>
                                        <div class="flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-500">
                                            <div v-if="repo.language" class="flex items-center gap-1">
                                                <span class="w-3 h-3 rounded-full"
                                                    :style="{ backgroundColor: getLanguageColor(repo.language) }"></span>
                                                <span>{{ repo.language }}</span>
                                            </div>
                                            <div class="flex items-center gap-1">
                                                <i class="fas fa-star text-yellow-500"></i>
                                                 <span>{{ formatNumber(repo.stargazersCount) }}</span>
                                            </div>
                                            <div class="flex items-center gap-1">
                                                <i class="fas fa-code-branch text-blue-500"></i>
                                                 <span>{{ formatNumber(repo.forksCount) }}</span>
                                            </div>
                                            <div class="flex items-center gap-1">
                                                <i class="fas fa-circle text-gray-400"></i>
                                                <span>{{ $t('github.updatedAt', { time: formatRelativeTime(repo.updatedAt) }) }}</span>
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

        <!-- 仓库详情弹窗 -->
        <common-modal v-model:visible="showRepoModal"
            :title="selectedRepo ? `${selectedRepo.ownerLogin}/${selectedRepo.repoName}` : ''">
            <div v-if="selectedRepo">
                <!-- 标签页导航 -->
                <div class="border-b border-gray-200 mb-6">
                    <nav class="flex space-x-4">
                        <button @click="activeTab = 'info'"
                            :class="['px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                                         activeTab === 'info' ? 'text-primary border-primary' : 'text-gray-500 hover:text-gray-700 border-transparent']">
                            <i class="fas fa-info-circle mr-2"></i>{{ $t('github.repositoryInfo') }}
                        </button>
                        <button @click="activeTab = 'releases'; loadReleases()"
                            :class="['px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                                         activeTab === 'releases' ? 'text-primary border-primary' : 'text-gray-500 hover:text-gray-700 border-transparent']">
                            <i class="fas fa-tag mr-2"></i>{{ $t('github.releases') }}
                        </button>
                        <button @click="activeTab = 'readme'; loadReadme()"
                            :class="['px-4 py-2 text-sm font-medium border-b-2 transition-colors',
                                         activeTab === 'readme' ? 'text-primary border-primary' : 'text-gray-500 hover:text-gray-700 border-transparent']">
                            <i class="fas fa-book mr-2"></i>{{ $t('github.readme') }}
                        </button>
                    </nav>
                </div>

                <!-- 仓库信息标签页内容 -->
                <div v-if="activeTab === 'info'" class="space-y-6">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="bg-neutral p-4 rounded-lg">
                            <h4 class="text-sm text-gray-500 mb-1">{{ $t('github.repositoryName') }}</h4>
                            <p class="font-medium">{{ selectedRepo.fullName }}</p>
                        </div>
                        <div class="bg-neutral p-4 rounded-lg">
                            <h4 class="text-sm text-gray-500 mb-1">{{ $t('github.description') }}</h4>
                            <p>{{ selectedRepo.description || $t('github.noDescription') }}</p>
                        </div>
                        <div class="bg-neutral p-4 rounded-lg">
                            <h4 class="text-sm text-gray-500 mb-1">{{ $t('github.starCount') }}</h4>
                            <div class="flex items-center gap-1">
                                <i class="fas fa-star text-yellow-500"></i>
                                <p>{{ formatNumber(selectedRepo.stargazersCount) }}</p>
                            </div>
                        </div>
                        <div class="bg-neutral p-4 rounded-lg">
                            <h4 class="text-sm text-gray-500 mb-1">{{ $t('github.forkCount') }}</h4>
                            <div class="flex items-center gap-1">
                                <i class="fas fa-code-branch text-blue-500"></i>
                                <p>{{ formatNumber(selectedRepo.forksCount) }}</p>
                            </div>
                        </div>
                        <div class="bg-neutral p-4 rounded-lg">
                            <h4 class="text-sm text-gray-500 mb-1">{{ $t('github.language') }}</h4>
                            <p>{{ selectedRepo.language || $t('common.unknown') }}</p>
                        </div>
                        <div class="bg-neutral p-4 rounded-lg">
                            <h4 class="text-sm text-gray-500 mb-1">{{ $t('github.lastUpdated') }}</h4>
                            <p>{{ formatTime(selectedRepo.updatedAt) }}</p>
                        </div>
                        <div class="bg-neutral p-4 rounded-lg md:col-span-2">
                            <h4 class="text-sm text-gray-500 mb-1">{{ $t('github.repositoryUrl') }}</h4>
                            <a :href="selectedRepo.htmlUrl" target="_blank"
                                class="text-primary hover:underline break-all">{{ selectedRepo.htmlUrl }}</a>
                        </div>
                    </div>
                </div>

                <!-- 发布版本标签页内容 -->
                <div v-if="activeTab === 'releases'" class="space-y-6">
                    <common-loading-spinner v-if="loadingReleases"></common-loading-spinner>

                    <div v-else>
                        <div v-if="releases.length === 0" class="py-8 text-center">
                            <i class="fas fa-tag text-4xl text-gray-300 mb-4"></i>
                            <p class="text-gray-500">{{ $t('github.noReleases') }}</p>
                        </div>

                        <div v-else class="space-y-4">
                            <div v-for="release in releases" :key="release.id" @click="showReleaseDetail(release)"
                                class="bg-white rounded-lg border border-gray-200 p-4 hover:shadow transition-all cursor-pointer">
                                <div class="flex flex-col md:flex-row md:items-start justify-between gap-3">
                                    <div class="flex-grow min-w-0">
                                        <div class="flex items-center gap-2 mb-1">
                                            <h4 class="font-semibold text-gray-800">{{ release.tagName }}</h4>
                                            <span v-if="release.name && release.name !== release.tagName"
                                                class="text-gray-600">{{ release.name }}</span>
                                            <span
                                                :class="['px-2 py-0.5 text-xs rounded-full', 
                                                         release.isPrerelease ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800']">
                                                 {{ release.isPrerelease ? $t('github.prerelease') : $t('github.stableRelease') }}
                                            </span>
                                        </div>
                                        <p class="text-gray-600 text-sm mb-2 line-clamp-2">
                                            {{ release.body ? release.body.substring(0, 100) + (release.body.length >
                                             100 ? '...' : '') : $t('github.noReleaseNotes') }}
                                        </p>
                                        <div class="flex flex-wrap gap-x-4 gap-y-2 text-xs text-gray-500">
                                            <div class="flex items-center gap-1">
                                                <i class="fas fa-calendar-alt"></i>
                                                <span>{{ formatTime(release.publishedAt) }}</span>
                                            </div>
                                            <div class="flex items-center gap-1">
                                                <i class="fas fa-download"></i>
                                                 <span>{{ $t('github.fileCount', { count: formatNumber(release.assets ? release.assets.length : 0) }) }}</span>
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
                    </div>
                </div>

                <!-- README标签页内容 -->
                <div v-if="activeTab === 'readme'" class="space-y-6">
                    <common-loading-spinner v-if="loadingReadme"></common-loading-spinner>

                    <div v-else>
                        <div v-if="!readmeContent" class="py-8 text-center">
                            <i class="fas fa-file-alt text-4xl text-gray-300 mb-4"></i>
                             <p class="text-gray-500">{{ $t('github.noReadme') }}</p>
                        </div>

                        <div v-else v-html="renderMarkdown(readmeContent)"></div>
                    </div>
                </div>
            </div>
        </common-modal>

        <!-- 发布版本详情弹窗 -->
        <common-modal v-model:visible="showReleaseModal"
            :title="selectedRelease ? `${selectedRepo.ownerLogin}/${selectedRepo.repoName} - ${selectedRelease.tagName}` : ''"
            max-width="max-w-3xl">
            <div v-if="selectedRelease">
                <div class="space-y-6">
                    <div class="bg-neutral p-4 rounded-lg">
                         <h4 class="text-sm text-gray-500 mb-1">{{ $t('github.releaseNotes') }}</h4>
                        <div v-if="selectedRelease.body" class="text-sm"
                            v-html="renderMarkdown(selectedRelease.body)"></div>
                         <div v-else class="text-gray-500 italic">{{ $t('github.releaseHasNoNotes') }}</div>
                    </div>

                    <div>
                        <h4 class="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                            <i class="fas fa-download text-primary"></i>
                             {{ $t('github.releaseAssets') }}
                        </h4>

                        <common-loading-spinner v-if="loadingAssets"></common-loading-spinner>

                        <div v-else>
                            <div v-if="selectedRelease.assets.length === 0" class="py-4 text-center">
                                <i class="fas fa-file-archive text-3xl text-gray-300 mb-2"></i>
                                 <p class="text-gray-500">{{ $t('github.noReleaseAssets') }}</p>
                            </div>

                            <ul v-else class="space-y-2 max-h-60 overflow-y-auto pr-2">
                                <li v-for="asset in selectedRelease.assets" :key="asset.id"
                                    @click="showDownloadModal(asset.browserDownloadUrl, asset.name)"
                                    class="flex justify-between items-center p-3 bg-neutral rounded hover:bg-gray-100 transition-colors cursor-pointer">
                                    <div class="flex items-center gap-3">
                                        <i class="fas fa-file-archive text-primary"></i>
                                        <div>
                                            <span class="font-medium block">{{ asset.name }}</span>
                                            <span class="text-xs text-gray-500">{{ formatFileSize(asset.fileSize)
                                                }}</span>
                                        </div>
                                    </div>
                                    <i class="fas fa-download text-gray-400"></i>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </common-modal>

        <!-- 下载链接弹窗 -->
         <common-modal v-model:visible="showDownloadModalVisible" :title="$t('github.downloadLinks')" max-width="max-w-2xl">
            <div class="space-y-6">
                <div class="bg-neutral p-4 rounded-lg">
                     <h4 class="text-sm text-gray-500 mb-1">{{ $t('github.fileName') }}</h4>
                    <p class="font-medium break-all">{{ downloadFileName }}</p>
                </div>

                <div>
                    <h4 class="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                        <i class="fas fa-link text-primary"></i>
                         {{ $t('github.originalDownloadLink') }}
                    </h4>
                    <div class="flex items-center gap-2">
                        <input type="text" :value="downloadUrl" readonly
                            class="flex-grow p-3 rounded-lg border border-gray-300 bg-gray-50 font-mono text-sm break-all">
                        <button @click="copyToClipboard(downloadUrl)"
                            class="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-3 rounded-lg transition-colors flex items-center gap-2"
                             :title="$t('github.copyLink')">
                            <i class="fas fa-copy"></i>
                        </button>
                        <button @click="downloadFile(downloadUrl)"
                            class="bg-primary hover:bg-secondary text-white px-4 py-3 rounded-lg transition-colors flex items-center gap-2"
                             :title="$t('github.downloadDirectly')">
                            <i class="fas fa-download"></i>
                        </button>
                    </div>
                </div>

                <div>
                    <h4 class="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                        <i class="fas fa-bolt text-primary"></i>
                         {{ $t('github.proxyDownloadLinks') }}
                    </h4>
                    <div class="space-y-3">
                        <div v-for="proxy in proxyPrefixes" :key="proxy.name" class="flex items-center gap-2">
                            <div class="flex items-center gap-1 w-36">
                                <i class="fas fa-server text-gray-400"></i>
                                <span class="text-sm text-gray-600 truncate" :title="proxy.name">{{ proxy.name }}</span>
                            </div>
                            <input type="text" :value="`${proxy.url}/${downloadUrl}`" readonly
                                class="flex-grow p-3 rounded-lg border border-gray-300 bg-gray-50 font-mono text-sm break-all">
                            <button @click="copyToClipboard(`${proxy.url}/${downloadUrl}`)"
                                class="bg-gray-200 hover:bg-gray-300 text-gray-800 px-3 py-3 rounded-lg transition-colors flex items-center gap-2"
                                 :title="$t('github.copyLink')">
                                <i class="fas fa-copy"></i>
                            </button>
                            <button @click="downloadFile(`${proxy.url}/${downloadUrl}`)"
                                class="bg-green-500 hover:bg-green-600 text-white px-3 py-3 rounded-lg transition-colors flex items-center gap-2"
                                 :title="$t('github.downloadDirectly')">
                                <i class="fas fa-download"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </common-modal>
</template>

<script>
import { ref, onMounted } from 'vue';
import { CommonUtils } from '@/shared/common-utils.js';
import { MarkdownUtils } from '@/shared/markdown-utils.js';
import { CommonComponents } from '@/shared/common-components.js';
import { t, currentLocale, translateErrorMessage } from '@/i18n/index.js';

export default {
    name: 'GithubView',
            components: {
                'common-header': CommonComponents.Header,
                'common-footer': CommonComponents.Footer,
                'common-toast': CommonComponents.Toast,
                'common-loading-spinner': CommonComponents.LoadingSpinner,
                'common-pagination': CommonComponents.Pagination,
                'common-modal': CommonComponents.Modal
            },

            setup() {
                // GitHub API基础URL
                const GITHUB_API_BASE = 'https://api.github.com';
                const GITHUB_RAW_API = 'https://raw.githubusercontent.com';

                // 代理链接前缀
                const proxyPrefixes = ref([
                    { name: 'gh-proxy', url: 'https://gh-proxy.org' },
                    { name: 'hk-proxy', url: 'https://hk.gh-proxy.org' },
                    { name: 'cdn-proxy', url: 'https://cdn.gh-proxy.org' },
                    { name: 'edgeone-proxy', url: 'https://edgeone.gh-proxy.org' }
                ]);

                // 搜索相关
                const toastRef = ref(null);
                const keyword = ref('');
                const sortBy = ref('stars');
                const results = ref([]);
                const isLoading = ref(false);
                const showResults = ref(false);
                const totalCount = ref(0);
                const currentPage = ref(1);
                const pageSize = ref(10);
                const hasNextPage = ref(false);

                // 弹窗相关
                const showRepoModal = ref(false);
                const showReleaseModal = ref(false);
                const showDownloadModalVisible = ref(false);
                const activeTab = ref('info');

                // 选中的数据
                const selectedRepo = ref(null);
                const selectedRelease = ref(null);
                const releases = ref([]);
                const readmeContent = ref('');
                const loadingReleases = ref(false);
                const loadingReadme = ref(false);
                const loadingAssets = ref(false);

                // 下载相关
                const downloadUrl = ref('');
                const downloadFileName = ref('');

                // 热门搜索示例
                const examples = ref([]);

                // 加载热门搜索
                const loadHotSearches = async () => {
                    try {
                        const response = await fetch('/api/github/hotSearches');
                        const data = await response.json();
                        if (data.code === 200 && data.data) {
                            examples.value = data.data;
                        } else if (data.code !== 200) {
                            throw new Error(translateErrorMessage(data.msg || t('github.loadHotSearchesFailed')));
                        }
                    } catch (error) {
                        console.error('Failed to load popular searches:', error);
                    }
                };

                // 初始化
                onMounted(() => {
                    loadHotSearches();
                });

                // 语言颜色映射
                const languageColors = {
                    'JavaScript': '#f1e05a',
                    'TypeScript': '#2b7489',
                    'Python': '#3572A5',
                    'Java': '#b07219',
                    'HTML': '#e34c26',
                    'CSS': '#563d7c',
                    'Go': '#00ADD8',
                    'Rust': '#dea584',
                    'C++': '#f34b7d'
                };

                // 公共工具函数
                const formatFileSize = CommonUtils.formatFileSize;
                const truncateText = CommonUtils.truncateText;
                const locale = () => currentLocale.value || currentLocale;
                const formatNumber = (value) => Number(value || 0).toLocaleString(locale());
                const formatTime = (timeString) => {
                    if (!timeString) return t('common.unknown');
                    return new Date(timeString).toLocaleString(locale(), {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                };
                const formatRelativeTime = (timeString) => {
                    if (!timeString) return t('common.unknown');
                    const diffSeconds = (new Date(timeString).getTime() - Date.now()) / 1000;
                    const ranges = [
                        ['year', 60 * 60 * 24 * 365],
                        ['month', 60 * 60 * 24 * 30],
                        ['week', 60 * 60 * 24 * 7],
                        ['day', 60 * 60 * 24],
                        ['hour', 60 * 60],
                        ['minute', 60]
                    ];
                    const formatter = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
                    for (const [unit, seconds] of ranges) {
                        if (Math.abs(diffSeconds) >= seconds) {
                            return formatter.format(Math.round(diffSeconds / seconds), unit);
                        }
                    }
                    return formatter.format(Math.round(diffSeconds), 'second');
                };
                const copyToClipboard = (text) => {
                    navigator.clipboard.writeText(text)
                        .then(() => showToast(t('common.copiedToClipboard'), 'success'))
                        .catch((error) => {
                            console.error('Copy failed:', error);
                            showToast(t('common.copyFailed'), 'error');
                        });
                };

                const formatRepository = (rawRepo) => {
                    return {
                        id: rawRepo.id,
                        fullName: rawRepo.full_name || '',
                        isPrivate: rawRepo.private || false,
                        description: rawRepo.description || '',
                        language: rawRepo.language || '',
                        stargazersCount: rawRepo.stargazers_count || 0,
                        forksCount: rawRepo.forks_count || 0,
                        updatedAt: rawRepo.updated_at || '',
                        htmlUrl: rawRepo.html_url || '',
                        ownerLogin: rawRepo.owner?.login || '',
                        repoName: rawRepo.name || ''
                    };
                };

                const formatRelease = (rawRelease) => {
                    const formatAsset = (rawAsset) => ({
                        id: rawAsset.id,
                        browserDownloadUrl: rawAsset.browser_download_url || '',
                        name: rawAsset.name || '',
                        fileSize: rawAsset.size || 0
                    });

                    return {
                        id: rawRelease.id,
                        tagName: rawRelease.tag_name || '',
                        name: rawRelease.name || '',
                        body: rawRelease.body || '',
                        publishedAt: rawRelease.published_at || '',
                        isPrerelease: rawRelease.prerelease || false,
                        assets: (rawRelease.assets || []).map(formatAsset)
                    };
                };

                // 获取语言颜色
                const getLanguageColor = (language) => {
                    return languageColors[language] || '#ccc';
                };

                // 显示提示
                const showToast = (message, type) => {
                    if (toastRef.value) {
                        toastRef.value.show(message, type);
                    } else {
                        alert(message);
                    }
                };

                // 搜索仓库
                const searchRepositories = async () => {
                    if (!keyword.value.trim()) {
                        showToast(t('common.searchKeywordRequired'), 'warning');
                        return;
                    }

                    isLoading.value = true;
                    showResults.value = true;

                    try {
                        const url = new URL(`${GITHUB_API_BASE}/search/repositories`);
                        url.searchParams.append('q', keyword.value);
                        url.searchParams.append('page', currentPage.value);
                        url.searchParams.append('per_page', pageSize.value);
                        url.searchParams.append('sort', sortBy.value);

                        const response = await fetch(url.toString());
                        const data = await CommonUtils.checkJsonResponseStatus(response);

                        results.value = (data.items || []).map(formatRepository);
                        totalCount.value = data.total_count || 0;
                        hasNextPage.value = totalCount.value > pageSize.value * currentPage.value;
                    } catch (error) {
                        handleGithubApiError(error);
                        results.value = [];
                        totalCount.value = 0;
                        hasNextPage.value = false;
                    } finally {
                        isLoading.value = false;
                    }
                };

                // 分页
                const prevPage = () => {
                    if (currentPage.value > 1) {
                        currentPage.value--;
                        searchRepositories();
                    }
                };

                const nextPage = () => {
                    if (hasNextPage.value) {
                        currentPage.value++;
                        searchRepositories();
                    }
                };

                // 显示仓库详情
                const showRepoDetail = (repo) => {
                    selectedRepo.value = repo;
                    activeTab.value = 'info';
                    releases.value = [];
                    readmeContent.value = '';
                    showRepoModal.value = true;
                };

                // 加载发布版本
                const loadReleases = async () => {
                    if (!selectedRepo.value || releases.value.length > 0) return;

                    loadingReleases.value = true;
                    try {
                        const response = await fetch(`${GITHUB_API_BASE}/repos/${selectedRepo.value.ownerLogin}/${selectedRepo.value.repoName}/releases`);
                        const rawReleases = await CommonUtils.checkJsonResponseStatus(response);
                        releases.value = rawReleases.map(formatRelease);
                    } catch (error) {
                        handleGithubApiError(error);
                        releases.value = [];
                    } finally {
                        loadingReleases.value = false;
                    }
                };

                // 加载README
                const loadReadme = async () => {
                    if (!selectedRepo.value || readmeContent.value) return;

                    loadingReadme.value = true;
                    try {
                        const response = await fetch(`${GITHUB_RAW_API}/${selectedRepo.value.ownerLogin}/${selectedRepo.value.repoName}/refs/heads/main/README.md`, {
                            headers: {
                                'Accept': 'application/vnd.github.v3.html+json'
                            }
                        });

                        if (response.status === 404) {
                            readmeContent.value = null;
                        } else {
                            readmeContent.value = await response.text();
                        }
                    } catch (error) {
                        handleGithubApiError(error);
                        readmeContent.value = null;
                    } finally {
                        loadingReadme.value = false;
                    }
                };

                const renderMarkdown = MarkdownUtils.renderMarkdown;

                // 显示发布版本详情
                const showReleaseDetail = (release) => {
                    selectedRelease.value = release;
                    showReleaseModal.value = true;
                };

                // 显示下载链接弹窗
                const showDownloadModal = (url, fileName) => {
                    downloadUrl.value = url;
                    downloadFileName.value = fileName;
                    showDownloadModalVisible.value = true;
                };

                // 下载文件
                const downloadFile = (url) => {
                    window.open(url, '_blank');
                    showToast(t('github.downloadingFile'), 'info');
                };

                const handleGithubApiError = (error) => {
                    console.error('GitHub API request failed:', error);
                    const message = error?.message?.includes('API rate limit exceeded')
                        ? t('common.error.githubRateLimit')
                        : t('github.requestFailed', { message: translateErrorMessage(error?.message || t('common.unknown')) });
                    showToast(message, 'error');
                };

                return {
                    // 数据
                    toastRef,
                    keyword,
                    sortBy,
                    pageSize,
                    results,
                    isLoading,
                    showResults,
                    totalCount,
                    currentPage,
                    hasNextPage,
                    examples,

                    // 弹窗
                    showRepoModal,
                    showReleaseModal,
                    showDownloadModalVisible,
                    activeTab,

                    // 选中的数据
                    selectedRepo,
                    selectedRelease,
                    releases,
                    readmeContent,
                    loadingReleases,
                    loadingReadme,
                    loadingAssets,

                    // 下载相关
                    downloadUrl,
                    downloadFileName,
                    proxyPrefixes,

                    // 方法
                    searchRepositories,
                    prevPage,
                    nextPage,
                    showRepoDetail,
                    loadReleases,
                    loadReadme,
                    showReleaseDetail,
                    showDownloadModal,
                    downloadFile,
                    copyToClipboard,

                    // 工具函数
                    formatTime,
                    formatRelativeTime,
                    formatFileSize,
                    formatNumber,
                    truncateText,
                    getLanguageColor,
                    renderMarkdown
                };
            }
};
</script>
