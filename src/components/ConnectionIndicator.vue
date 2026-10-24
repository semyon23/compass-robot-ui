<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useRosbridge } from '../api/rosbridge'
import { useRobotStore } from '../stores/robot'

const { t } = useI18n()
const { state } = useRosbridge()
const { latencyMs } = storeToRefs(useRobotStore())

const COLORS = { online: '#22c55e', connecting: '#eab308', offline: '#ef4444' }
const color = computed(() => {
  if (state.value === 'online' && latencyMs.value != null && latencyMs.value > 500) return COLORS.connecting
  return COLORS[state.value]
})
</script>

<template>
  <div class="flex items-center gap-2 font-mono text-xs text-slate-500 dark:text-slate-400" :title="t(`connection.${state}`)">
    <span class="relative inline-block h-2.5 w-2.5 rounded-full" :style="{ backgroundColor: color }">
      <span
        v-if="state !== 'online'"
        class="absolute inset-0 animate-ping rounded-full"
        :style="{ backgroundColor: color, opacity: 0.55 }"
      ></span>
    </span>
    <span v-if="latencyMs != null" class="w-12">{{ latencyMs }} ms</span>
    <span v-else class="w-12">—</span>
  </div>
</template>
