<script setup>
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'

const { t } = useI18n()
const route = useRoute()
</script>

<template>
  <div class="grid h-full place-items-center">
    <div class="text-center">
      <div class="mb-3 font-mono text-4xl text-slate-300 dark:text-slate-700">{{ route.meta.icon }}</div>
      <div class="text-sm text-slate-500 dark:text-slate-400">{{ t('placeholder.soon') }}</div>
    </div>
  </div>
</template>
