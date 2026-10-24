<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNow } from '@vueuse/core'

const { locale } = useI18n()
const now = useNow({ interval: 1000 })

const time = computed(() =>
  now.value.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
)
const date = computed(() =>
  now.value.toLocaleDateString(locale.value, { day: '2-digit', month: '2-digit', year: 'numeric' }),
)
</script>

<template>
  <!-- Время устройства, на котором открыт UI -->
  <div class="flex flex-col items-end font-mono leading-tight tabular-nums">
    <span class="text-sm font-semibold text-slate-800 dark:text-slate-100">{{ time }}</span>
    <span class="text-[11px] text-slate-500 dark:text-slate-400">{{ date }}</span>
  </div>
</template>
