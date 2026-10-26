<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ModeBadge from './ModeBadge.vue'
import { useRobotStore } from '../stores/robot'
import ConnectionIndicator from './ConnectionIndicator.vue'
import ControlIndicator from './ControlIndicator.vue'
import StopButton from './StopButton.vue'
import AppClock from './AppClock.vue'

const { t } = useI18n()
const route = useRoute()
const robot = useRobotStore()
const title = computed(() => (route.meta?.title ? t(route.meta.title) : 'Compass'))
</script>

<template>
  <header
    class="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 lg:px-6 dark:border-slate-800 dark:bg-slate-900"
  >
    <div class="flex min-w-0 items-center gap-4">
      <h1 class="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">{{ title }}</h1>
      <ModeBadge />
    </div>
    <div class="flex items-center gap-3 lg:gap-4">
      <span v-if="robot.info" class="hidden font-mono text-sm text-slate-600 md:inline dark:text-slate-300">{{ robot.info.robotName }}</span>
      <ControlIndicator />
      <ConnectionIndicator />
      <StopButton />
      <AppClock class="border-l border-slate-200 pl-3 lg:pl-4 dark:border-slate-800" />
    </div>
  </header>
</template>
