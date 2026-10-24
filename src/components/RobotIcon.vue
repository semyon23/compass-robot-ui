<script setup>
import { onMounted, ref, watch } from 'vue'
import { drawRobotShape } from '../lib/robotShapes'

/** Робот в миниатюре — для выбора внешнего вида в настройках. */
const props = defineProps({
  kind: { type: String, required: true },
  color: { type: String, required: true },
  size: { type: Number, default: 64 },
})

const canvas = ref(null)

function draw() {
  const el = canvas.value
  if (!el) return
  const dpr = window.devicePixelRatio || 1
  el.width = props.size * dpr
  el.height = props.size * dpr
  const ctx = el.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, props.size, props.size)
  // «Вперёд» — вверх, как привычно на картинке; стрелка выходит за корпус на 0.35 r.
  ctx.translate(props.size / 2, props.size / 2 + props.size * 0.06)
  ctx.rotate(-Math.PI / 2)
  drawRobotShape(ctx, props.kind, props.size * 0.32, props.color)
}

onMounted(draw)
watch(() => [props.kind, props.color, props.size], draw)
</script>

<template>
  <canvas ref="canvas" :style="{ width: `${size}px`, height: `${size}px` }"></canvas>
</template>
