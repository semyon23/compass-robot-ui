<script setup>
import { useI18n } from 'vue-i18n'
import { useRosbridge } from '../api/rosbridge'

const { t } = useI18n()
const { state } = useRosbridge()
</script>

<template>
  <div
    v-if="state === 'offline'"
    class="flex shrink-0 items-center gap-3 border-b border-red-200 bg-red-50 px-6 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
  >
    <span class="font-semibold">{{ t('offline.title') }}.</span>
    <span>{{ t('offline.text') }}</span>
  </div>
</template>
