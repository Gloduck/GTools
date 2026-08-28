<template>
  <common-modal v-if="isDemoMode" v-model:visible="demoNoticeVisible" :title="t('common.demoTitle')" max-width="max-w-lg">
    <p class="text-gray-700">{{ t('common.demoNotice') }}</p>
  </common-modal>
  <router-view />
</template>

<script setup>
import {onMounted, ref} from 'vue';
import {useI18n} from 'vue-i18n';
import {CommonComponents} from './shared/common-components.js';

const {t} = useI18n();
const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
const demoNoticeVisible = ref(false);
const CommonModal = CommonComponents.Modal;

onMounted(() => {
  if (isDemoMode) demoNoticeVisible.value = true;
});
</script>
