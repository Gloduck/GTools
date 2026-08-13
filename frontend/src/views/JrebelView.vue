<template>
    <common-toast ref="toastRef"></common-toast>

    <div class="min-h-screen flex flex-col">
        <common-header :title="$route.meta.title" :icon="$route.meta.icon" link="/"></common-header>

        <main class="flex-grow container mx-auto px-4 py-8">
            <div class="max-w-4xl mx-auto">
                <div class="bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 shadow-lg rounded-2xl p-6 md:p-8 mb-8">
                    <h2 class="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-3">
                        <i class="fas fa-link text-primary"></i>
                        {{ t('jrebel.generatorTitle') }}
                    </h2>

                    <div class="space-y-4">
                        <div>
                            <label class="block text-sm font-medium text-gray-700 mb-2">{{ t('jrebel.activationLink') }}</label>
                            <div class="flex flex-col md:flex-row gap-4">
                                <div class="flex-1 relative">
                                    <input type="text" :value="activationUrl" readonly
                                        class="w-full px-4 py-3 pr-12 rounded-lg border-2 border-primary bg-white text-gray-700 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                                </div>

                                <div class="flex gap-3">
                                    <button @click="copyToClipboard(activationUrl)"
                                        class="bg-primary hover:bg-primary/90 text-white font-medium px-6 py-3 rounded-lg transition-all flex items-center gap-2 flex-1 md:flex-none min-w-[120px] justify-center">
                                        <i class="fas fa-copy"></i>
                                        <span>{{ t('jrebel.copyLink') }}</span>
                                    </button>
                                    <button @click="generateNewUrl"
                                        class="bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium px-4 py-3 rounded-lg transition-all flex items-center gap-2"
                                        :title="t('jrebel.generateNewLink')" :aria-label="t('jrebel.generateNewLink')">
                                        <i class="fas fa-sync-alt"></i>
                                    </button>
                                </div>
                            </div>
                        </div>

                        <p class="text-sm text-gray-500">{{ t('jrebel.copyHint') }}</p>
                    </div>
                </div>

                <div class="bg-white rounded-xl border border-gray-200 p-6 shadow-lg">
                    <h3 class="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2">
                        <i class="fas fa-info-circle text-primary"></i>
                        {{ t('jrebel.instructions') }}
                    </h3>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div class="space-y-4">
                            <h4 class="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                                <i class="fas fa-exclamation-triangle text-amber-500"></i>
                                {{ t('jrebel.notes') }}
                            </h4>
                            <ul class="space-y-3">
                                <li v-for="noteKey in noteKeys" :key="noteKey" class="flex items-start gap-2">
                                    <i class="fas fa-circle text-gray-400 text-xs mt-2"></i>
                                    <span>{{ t(noteKey) }}</span>
                                </li>
                            </ul>
                        </div>
                    </div>
                    <div class="mt-8 pt-6 border-t border-gray-200">
                        <button @click="showHelpModal = true"
                            class="bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium px-4 py-2 rounded-lg transition-all flex items-center gap-2 self-start">
                            <i class="fas fa-question-circle"></i>
                            {{ t('jrebel.viewHelp') }}
                        </button>
                    </div>
                </div>
            </div>
        </main>

        <common-footer copyright="© 2025 Gloduck"></common-footer>
    </div>

    <common-modal v-model:visible="showHelpModal" :title="t('jrebel.helpTitle')">
        <div class="space-y-6">
            <div>
                <h4 class="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <i class="fas fa-cogs text-primary"></i>
                    {{ t('jrebel.activationSteps') }}
                </h4>
                <ol class="space-y-4">
                    <li v-for="(step, index) in steps" :key="step.titleKey" class="flex items-start gap-3">
                        <span class="flex-shrink-0 w-6 h-6 bg-primary text-white rounded-full flex items-center justify-center text-sm">{{ index + 1 }}</span>
                        <div>
                            <p class="font-medium text-gray-700">{{ t(step.titleKey) }}</p>
                            <p class="text-gray-600 text-sm mt-1">{{ t(step.descriptionKey) }}</p>
                        </div>
                    </li>
                </ol>
            </div>
            <div>
                <h4 class="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <i class="fas fa-exclamation-circle text-amber-500"></i>
                    {{ t('jrebel.troubleshooting') }}
                </h4>
                <div class="space-y-3">
                    <div class="p-3 bg-amber-50 rounded-lg">
                        <p class="font-medium text-amber-800 mb-1">{{ t('jrebel.signatureError') }}</p>
                        <p class="text-amber-700 text-sm">{{ t('jrebel.signatureSolution') }}</p>
                    </div>
                    <div class="p-3 bg-blue-50 rounded-lg">
                        <p class="font-medium text-blue-800 mb-1">{{ t('jrebel.invalidLink') }}</p>
                        <p class="text-blue-700 text-sm">{{ t('jrebel.invalidLinkSolution') }}</p>
                    </div>
                </div>
            </div>
            <div>
                <h4 class="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                    <i class="fas fa-shield-alt text-green-500"></i>
                    {{ t('jrebel.disclaimerTitle') }}
                </h4>
                <p class="text-gray-600 text-sm">{{ t('jrebel.disclaimer') }}</p>
            </div>
        </div>
    </common-modal>
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { CommonUtils } from '@/shared/common-utils.js';
import { CommonComponents } from '@/shared/common-components.js';

const CommonHeader = CommonComponents.Header;
const CommonFooter = CommonComponents.Footer;
const CommonToast = CommonComponents.Toast;
const CommonModal = CommonComponents.Modal;
const { t } = useI18n();

const toastRef = ref(null);
const activationUrl = ref('');
const showHelpModal = ref(false);
const noteKeys = ['jrebel.noteDevelopment', 'jrebel.noteCommercial', 'jrebel.noteHelp'];
const steps = [
    { titleKey: 'jrebel.steps.copyTitle', descriptionKey: 'jrebel.steps.copyDescription' },
    { titleKey: 'jrebel.steps.configureTitle', descriptionKey: 'jrebel.steps.configureDescription' },
    { titleKey: 'jrebel.steps.modeTitle', descriptionKey: 'jrebel.steps.modeDescription' },
    { titleKey: 'jrebel.steps.finishTitle', descriptionKey: 'jrebel.steps.finishDescription' }
];

const showToast = (message, type) => {
    if (toastRef.value) toastRef.value.show(message, type);
    else alert(message);
};

const generateUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.random() * 16 | 0;
    const value = character === 'x' ? random : (random & 0x3 | 0x8);
    return value.toString(16);
});

const updateActivationUrl = () => {
    activationUrl.value = `${window.location.origin}/api/jrebel/${generateUUID()}`;
};

const copyToClipboard = (text) => CommonUtils.copyToClipboard(text, showToast);

const generateNewUrl = () => {
    updateActivationUrl();
    showToast(t('jrebel.newLinkGenerated'), 'success');
};

onMounted(updateActivationUrl);
</script>
