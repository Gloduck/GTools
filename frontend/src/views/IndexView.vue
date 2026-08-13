<template>
    <div class="min-h-screen flex flex-col">
        <common-header :title="$route.meta.title" :icon="$route.meta.icon" :description="t('pages.index.description')" link="/"></common-header>

        <main class="flex-grow container mx-auto px-4 py-8">
            <div class="max-w-3xl mx-auto mb-12">
                <div class="relative">
                    <i class="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-lg"></i>
                    <input v-model="searchKeyword" type="text" :placeholder="t('home.searchPlaceholder')"
                        class="w-full pl-12 pr-4 py-4 rounded-xl border border-gray-300 focus:border-primary focus:ring-4 focus:ring-primary/20 outline-none transition-all shadow-lg bg-white/80">
                    <div v-if="searchKeyword" class="absolute right-4 top-1/2 -translate-y-1/2">
                        <button :aria-label="t('common.clear')" @click="searchKeyword = ''"
                            class="text-gray-400 hover:text-gray-600 transition-colors">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                </div>
                <p class="text-gray-500 text-sm mt-2 ml-1">
                    {{ t('home.toolCount', { count: filteredTools.length }) }}
                    <span v-if="searchKeyword">({{ t('home.searchResultCount', { count: filteredTools.length }) }})</span>
                </p>
            </div>

            <div class="max-w-6xl mx-auto mb-8">
                <div class="flex flex-wrap gap-2">
                    <button v-for="categoryId in categories" :key="categoryId" @click="toggleCategory(categoryId)" :class="[
                        'px-4 py-2 rounded-full transition-all duration-300 flex items-center gap-2',
                        selectedCategories.includes(categoryId)
                            ? 'bg-primary text-white shadow-md'
                            : 'bg-white text-gray-700 hover:bg-gray-100 shadow'
                    ]">
                        <span>{{ categoryName(categoryId) }}</span>
                        <span v-if="selectedCategories.includes(categoryId)" class="text-xs opacity-90">
                            <i class="fas fa-check"></i>
                        </span>
                    </button>
                </div>
            </div>

            <div class="max-w-7xl mx-auto">
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    <div v-for="tool in filteredTools" :key="tool.id"
                        class="bg-white rounded-2xl overflow-hidden shadow-lg transition-all duration-300 hover:-translate-y-2 hover:shadow-xl animate-fadeIn">
                        <div class="h-2" :style="{ backgroundColor: getCategoryColor(tool.categoryId) }"></div>
                        <div class="p-6 flex flex-col h-full">
                            <div class="flex items-start gap-4 mb-4">
                                <div class="w-12 h-12 rounded-xl flex items-center justify-center text-white text-xl"
                                    :style="{ backgroundColor: getCategoryColor(tool.categoryId) }">
                                    <i :class="tool.icon"></i>
                                </div>
                                <div class="flex-1 min-w-0">
                                    <h3 class="font-bold text-gray-800 text-lg truncate">{{ t(tool.titleKey) }}</h3>
                                    <div class="flex items-center gap-2 mt-1">
                                        <span class="px-3 py-1 rounded-full text-xs font-medium" :style="{
                                            backgroundColor: getCategoryColor(tool.categoryId) + '20',
                                            color: getCategoryColor(tool.categoryId)
                                        }">
                                            {{ categoryName(tool.categoryId) }}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <p class="text-gray-600 mb-6 flex-grow">{{ t(tool.descKey) }}</p>

                            <div class="flex justify-between items-center pt-4 border-t border-gray-100">
                                <a :href="tool.href" @click.prevent="goToTool(tool.href)"
                                    class="text-primary hover:text-secondary font-medium flex items-center gap-2 transition-colors">
                                    <span>{{ t('home.useNow') }}</span>
                                    <i class="fas fa-arrow-right text-sm"></i>
                                </a>
                                <a :href="tool.href" target="_blank" :aria-label="t('home.openInNewWindow')"
                                    class="text-primary hover:text-secondary font-medium flex items-center gap-2 transition-colors">
                                    <span class="text-gray-400 text-sm"><i class="fas fa-external-link-alt"></i></span>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </main>

        <common-footer :description="t('home.footerDescription')" copyright="© 2025 Gloduck"
            :links="[{ icon: 'fab fa-github', url: 'https://github.com/Gloduck', name: 'GitHub' }, { icon: 'fas fa-blog', url: 'https://mxecy.cn', name: t('home.blogLink') }]"></common-footer>
    </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { CommonComponents } from '@/shared/common-components.js';
import { toolCards } from '@/shared/page-config.js';

const CommonHeader = CommonComponents.Header;
const CommonFooter = CommonComponents.Footer;
const router = useRouter();
const { t } = useI18n();
const searchKeyword = ref('');
const selectedCategories = ref([]);

const categoryColors = {
    development: '#249ffd',
    utilities: '#10b981',
    design: '#8b5cf6',
    search: '#f59e0b',
    network: '#ef4444',
    other: '#6b7280'
};

const categories = computed(() => [...new Set(toolCards.map((tool) => tool.categoryId))].sort());
const categoryName = (categoryId) => t(`categories.${categoryId}`);

const filteredTools = computed(() => {
    const keyword = searchKeyword.value.trim().toLocaleLowerCase();
    return toolCards.filter((tool) => {
        const searchableText = [t(tool.titleKey), t(tool.descKey), categoryName(tool.categoryId)]
            .join(' ')
            .toLocaleLowerCase();
        const keywordMatch = !keyword || searchableText.includes(keyword);
        const categoryMatch = selectedCategories.value.length === 0
            || selectedCategories.value.includes(tool.categoryId);
        return keywordMatch && categoryMatch;
    });
});

const getCategoryColor = (categoryId) => categoryColors[categoryId] || categoryColors.other;

const toggleCategory = (categoryId) => {
    const index = selectedCategories.value.indexOf(categoryId);
    if (index === -1) selectedCategories.value.push(categoryId);
    else selectedCategories.value.splice(index, 1);
};

const goToTool = (href) => router.push(href);
</script>

<style>
@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}
.animate-fadeIn { animation: fadeIn 0.5s ease-in-out; }
</style>
