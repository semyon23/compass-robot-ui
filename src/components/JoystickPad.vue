<script setup>
import { ref, computed } from 'vue'

/**
 * Виртуальный джойстик: мышь и тач, один палец. Отдаёт вектор { x, y } в [-1, 1],
 * x — вправо, y — вперёд. Отпустили — сразу { 0, 0 }.
 */
const props = defineProps({
  disabled: Boolean,
  size: { type: Number, default: 200 },
})
const emit = defineEmits(['change'])

const DEADZONE = 0.08

const base = ref(null)
const knob = ref({ x: 0, y: 0 })
const active = ref(false)
let pointerId = null

const knobSize = computed(() => props.size * 0.38)
const travel = computed(() => (props.size - knobSize.value) / 2)

function update(e) {
  const rect = base.value.getBoundingClientRect()
  let dx = (e.clientX - (rect.left + rect.width / 2)) / travel.value
  let dy = (e.clientY - (rect.top + rect.height / 2)) / travel.value
  const len = Math.hypot(dx, dy)
  if (len > 1) {
    dx /= len
    dy /= len
  }
  knob.value = { x: dx, y: dy }
  const out = Math.hypot(dx, dy) < DEADZONE ? { x: 0, y: 0 } : { x: dx, y: -dy }
  emit('change', out)
}

function onDown(e) {
  if (props.disabled || pointerId !== null) return
  pointerId = e.pointerId
  // Захват — чтобы палец мог уйти за край джойстика и не «отпустить» его.
  try {
    base.value.setPointerCapture(e.pointerId)
  } catch (_) {}
  active.value = true
  update(e)
}

function onMove(e) {
  if (e.pointerId === pointerId) update(e)
}

function onUp(e) {
  if (e.pointerId !== pointerId) return
  pointerId = null
  active.value = false
  knob.value = { x: 0, y: 0 }
  emit('change', { x: 0, y: 0 })
}
</script>

<template>
  <div
    ref="base"
    class="relative touch-none rounded-full border-2 select-none"
    :class="
      disabled
        ? 'cursor-not-allowed border-slate-200 bg-slate-100 opacity-60 dark:border-slate-800 dark:bg-slate-900'
        : 'cursor-grab border-slate-300 bg-slate-100 dark:border-slate-700 dark:bg-slate-800'
    "
    :style="{ width: `${size}px`, height: `${size}px` }"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onUp"
    @lostpointercapture="onUp"
  >
    <!-- Перекрестие: вперёд/назад, влево/вправо -->
    <span class="absolute top-2 left-1/2 -translate-x-1/2 font-mono text-xs text-slate-400">▲</span>
    <span class="absolute bottom-2 left-1/2 -translate-x-1/2 font-mono text-xs text-slate-400">▼</span>
    <span class="absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-xs text-slate-400">◀</span>
    <span class="absolute top-1/2 right-2.5 -translate-y-1/2 font-mono text-xs text-slate-400">▶</span>
    <div
      class="absolute top-1/2 left-1/2 rounded-full shadow-md"
      :class="[
        disabled ? 'bg-slate-300 dark:bg-slate-700' : 'bg-brand-800 dark:bg-brand-600',
        active ? '' : 'transition-transform duration-150',
      ]"
      :style="{
        width: `${knobSize}px`,
        height: `${knobSize}px`,
        transform: `translate(calc(-50% + ${knob.x * travel}px), calc(-50% + ${knob.y * travel}px))`,
      }"
    ></div>
  </div>
</template>
