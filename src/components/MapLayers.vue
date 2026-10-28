<script setup>
import { NCheckbox, NPopover } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useTheme } from '../composables/useTheme'
import { MAP_COLORS } from '../lib/mapColors'
import { MAP_LAYERS, useMapLayers } from '../composables/useMapLayers'

/** Кнопка «Слои» на карте: что показывать; рядом с каждым слоем — его цвет на карте. */
defineProps({ available: { type: Array, default: () => MAP_LAYERS } })

const { t } = useI18n()
const { isDark } = useTheme()
const layers = useMapLayers()

// Ключ цвета слоя в MAP_COLORS.
const COLOR_KEY = { scan: 'scan', camera: 'camera', particles: 'particles', plan: 'plan', localPlan: 'localPlan', goals: 'nav', fmsRoute: 'fms' }

function swatch(key) {
  if (key === 'map') return { background: isDark.value ? '#e2e8f0' : '#1e293b' }
  if (key === 'telemetry') return { background: isDark.value ? '#475569' : '#cbd5e1' }
  // Палитра RViz (lib/mapTint.js): синий → красный, затем голубой (вплотную) и пурпурный (препятствие).
  if (key.endsWith('Costmap')) return { background: 'linear-gradient(90deg, #0000ff, #ff0000 70%, #00ffff 70% 85%, #ff00ff 85%)' }
  return { background: (isDark.value ? MAP_COLORS.dark : MAP_COLORS.light)[COLOR_KEY[key]] }
}
</script>

<template>
  <NPopover trigger="click" placement="left-start">
    <template #trigger>
      <button
        type="button"
        class="grid h-10 w-10 place-items-center rounded-md border border-slate-200 bg-white/90 font-mono text-lg text-slate-700 shadow-sm transition select-none hover:bg-white active:scale-95 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200 dark:hover:bg-slate-800"
        :title="t('map.layers')"
      >
        ☰
      </button>
    </template>
    <div class="flex flex-col gap-1.5 py-1">
      <div class="mb-1 text-xs font-semibold text-slate-500 dark:text-slate-400">{{ t('map.layers') }}</div>
      <NCheckbox v-for="key in available" :key="key" v-model:checked="layers[key]">
        <span class="flex items-center gap-2">
          <span class="inline-block h-2.5 w-5 rounded-sm" :style="swatch(key)"></span>
          {{ t(`map.layer_${key}`) }}
        </span>
      </NCheckbox>
    </div>
  </NPopover>
</template>
