<script setup>
import { ref, shallowRef, watch } from 'vue'
import { useTheme } from '../composables/useTheme'
import { fetchMapFile } from '../api/maps'
import { gridCanvas, parsePgm, PALETTES } from '../lib/mapTint'

/** Превью карты из библиотеки: map.pgm с робота в цветах темы. */
const props = defineProps({
  mapId: { type: String, required: true },
  version: { type: String, default: '' }, // updatedAt: поменялся — перекачиваем
})

const { isDark } = useTheme()
const grid = shallowRef(null)
const src = ref('')
const failed = ref(false)

watch(
  () => [props.mapId, props.version],
  async () => {
    failed.value = false
    try {
      grid.value = parsePgm(await fetchMapFile(props.mapId, 'map.pgm', props.version))
    } catch (_) {
      grid.value = null
      failed.value = true
    }
  },
  { immediate: true },
)

watch(
  [grid, isDark],
  () => {
    src.value = grid.value ? gridCanvas(grid.value, isDark.value ? PALETTES.dark : PALETTES.light).toDataURL() : ''
  },
)
</script>

<template>
  <div class="grid h-full w-full place-items-center bg-[#e9eef4] dark:bg-slate-950">
    <img v-if="src" :src="src" alt="" class="h-full w-full object-contain [image-rendering:pixelated]" />
    <span v-else-if="failed" class="font-mono text-2xl text-slate-300 dark:text-slate-700">▤</span>
  </div>
</template>
