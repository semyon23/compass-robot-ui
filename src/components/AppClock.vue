<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useNow } from '@vueuse/core'

const { locale } = useI18n()
const now = useNow({ interval: 1000 })

const time = computed(() =>
  now.value.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
)
// Дата одним форматом для всех языков: 26.10.2026.
const date = computed(() => {
  const d = now.value
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
})
</script>

<template>
  <!-- Время устройства, на котором открыт UI -->
  <div class="flex flex-col items-end font-mono leading-tight tabular-nums">
    <span class="text-sm font-semibold text-slate-800 dark:text-slate-100">{{ time }}</span>
    <span class="text-[11px] text-slate-500 dark:text-slate-400">{{ date }}</span>
  </div>
</template>
