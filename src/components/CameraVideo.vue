<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocalStorage } from '@vueuse/core'
import { useRobotStore } from '../stores/robot'

/**
 * Видео камеры — окно поверх карты: перетаскивается за заголовок, два размера. Место и размер
 * запоминаются в браузере. Подписка на кадры — только пока окно открыто (робот сжимает JPEG по запросу).
 */
const emit = defineEmits(['close'])
const { t } = useI18n()
const robot = useRobotStore()

const WIDTHS = { small: 320, large: 560 }
const box = useLocalStorage('compass.video.box', { x: 12, y: 12, size: 'small' }, { mergeDefaults: true })
const width = computed(() => WIDTHS[box.value.size] ?? WIDTHS.small)

// Нет кадров дольше 2 с — «нет видео» (камера не публикует или выключен цвет).
const now = ref(Date.now())
const timer = setInterval(() => (now.value = Date.now()), 500)
const stale = computed(() => !robot.video || now.value - robot.video.at > 2000)

let off = null
onMounted(() => {
  off = robot.subscribeStreams(['video'])
  place(box.value.x, box.value.y)
})
onBeforeUnmount(() => {
  off?.()
  clearInterval(timer)
})

// Перетаскивание за заголовок; окно не уходит за край карты — и после смены размера тоже.
const el = ref(null)
let drag = null
function place(x, y) {
  const parent = el.value.parentElement.getBoundingClientRect()
  const self = el.value.getBoundingClientRect()
  box.value.x = Math.min(Math.max(0, x), Math.max(0, parent.width - self.width))
  box.value.y = Math.min(Math.max(0, y), Math.max(0, parent.height - self.height))
}
async function toggleSize() {
  box.value.size = box.value.size === 'large' ? 'small' : 'large'
  await nextTick()
  place(box.value.x, box.value.y)
}
function onDown(e) {
  if (e.target.closest('button')) return
  drag = { dx: e.clientX - box.value.x, dy: e.clientY - box.value.y }
  e.currentTarget.setPointerCapture(e.pointerId)
}
function onMove(e) {
  if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy)
}
function onUp() {
  drag = null
}
</script>

<template>
  <div
    ref="el"
    class="absolute z-10 overflow-hidden rounded-md border border-slate-300 bg-slate-900 shadow-lg dark:border-slate-700"
    :style="{ left: `${box.x}px`, top: `${box.y}px`, width: `${width}px` }"
  >
    <div
      class="flex cursor-move items-center gap-2 bg-slate-800 px-2 py-1 text-xs text-slate-200 select-none"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
    >
      <span class="flex-1">{{ t('video.title') }}</span>
      <button
        type="button"
        class="rounded px-1.5 hover:bg-slate-700"
        :title="t(box.size === 'large' ? 'video.smaller' : 'video.larger')"
        @click="toggleSize"
      >
        {{ box.size === 'large' ? '–' : '+' }}
      </button>
      <button type="button" class="rounded px-1.5 hover:bg-slate-700" :title="t('video.close')" @click="emit('close')">
        ✕
      </button>
    </div>
    <div class="relative aspect-[4/3] bg-black">
      <img v-if="robot.video" :src="robot.video.url" class="h-full w-full object-contain" alt="" />
      <div v-if="stale" class="absolute inset-0 grid place-items-center text-xs text-slate-400">
        {{ t('video.noSignal') }}
      </div>
    </div>
  </div>
</template>
