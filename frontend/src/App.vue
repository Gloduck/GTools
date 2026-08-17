<template>
  <div v-if="isDemoMode" role="status" class="pointer-events-none fixed left-1/2 top-3 z-[10000] -translate-x-1/2 rounded-full border border-amber-300 bg-amber-50/95 px-4 py-2 text-center text-sm font-medium text-amber-900 shadow-lg backdrop-blur">
    <i class="fas fa-flask mr-2"></i>{{ t('common.demoNotice') }}
  </div>
  <router-view />
</template>

<script setup>
import {useI18n} from 'vue-i18n';

const {t} = useI18n();
const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true';
</script>
