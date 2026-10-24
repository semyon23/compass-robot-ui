<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme } from '../composables/useTheme'
import { worldToScreen, screenToWorld, zoomAt, pan, niceStep, heading } from '../lib/view2d'
import { gridCanvas, PALETTES } from '../lib/mapTint'
import { useRobotLook } from '../composables/useRobotLook'
import { drawRobotShape } from '../lib/robotShapes'

/**
 * 2D-вид вокруг робота: сетка в метрах, карта, путь Nav2, цели, скан, робот.
 *
 * Без инструмента: перетаскивание — двигать карту, колесо / щипок — масштаб.
 * С инструментом (tool = 'pose' | 'goal' | 'route'), как в RViz: нажать на карту
 * и потянуть — стрелка задаёт направление; отпустить — событие pick { x, y, theta }.
 * Карту при этом можно двигать двумя пальцами, правой или средней кнопкой мыши.
 * follow — вид едет за роботом; любое ручное перемещение его выключает.
 */
const props = defineProps({
  pose: { type: Object, default: null }, // { x, y, theta }
  scan: { type: Array, default: null }, // [[x, y], ...] в том же фрейме, что поза
  // { width, height, resolution, origin: [x, y, theta], data } — как nav_msgs/OccupancyGrid
  map: { type: Object, default: null },
  robotRadius: { type: Number, default: 0.3 },
  tool: { type: String, default: null },
  path: { type: Array, default: null }, // путь Nav2 [[x, y], ...]
  // Текущая цель/маршрут из nav_status: { kind, poses, index, state }
  nav: { type: Object, default: null },
  draft: { type: Array, default: null }, // маршрут в редактировании [{ x, y, theta }]
})
const follow = defineModel('follow', { type: Boolean, default: true })
const emit = defineEmits(['pick'])

const { t } = useI18n()
const { isDark, brand } = useTheme()
const robotLook = useRobotLook()

const wrap = ref(null)
const canvas = ref(null)
let ctx = null
let width = 0
let height = 0
let view = { cx: 0, cy: 0, scale: 40 }
let frame = 0
// Показанная карта и её картинка в цветах темы (строится при первой отрисовке).
let shown = null // { meta, tinted, dark }
// Жест инструмента: { pointerId, start: {x,y} мир, end: {x,y} мир, startPx: {x,y} экран, dragged }
let pick = null

// Цвета — docs/DESIGN.md. Цель и путь — цвет режима навигации, черновик маршрута — акцент,
// начальная поза — янтарный.
const COLORS = {
  light: {
    bg: '#e9eef4', minor: '#dbe2ea', major: '#c3ccd8', axisX: '#ef4444', axisY: '#22c55e',
    scan: '#ea580c', text: '#64748b',
    nav: '#059669', draft: '#f97316', pose: '#d97706', done: '#94a3b8', label: '#ffffff',
  },
  dark: {
    bg: '#020617', minor: '#0f172a', major: '#1e293b', axisX: '#f87171', axisY: '#4ade80',
    scan: '#fb923c', text: '#94a3b8',
    nav: '#34d399', draft: '#fb923c', pose: '#fbbf24', done: '#64748b', label: '#020617',
  },
}

const DRAG_PX = 12 // меньше — это тап, направление выбираем сами

function requestDraw() {
  if (!frame) frame = requestAnimationFrame(draw)
}

function draw() {
  frame = 0
  if (!ctx || !width) return
  const c = isDark.value ? COLORS.dark : COLORS.light
  const dpr = window.devicePixelRatio || 1
  if (follow.value && props.pose) view = { ...view, cx: props.pose.x, cy: props.pose.y }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, width, height)

  drawGrid(c)
  drawMap()
  drawAxes(c)
  drawPath(c)
  drawNav(c)
  drawDraft(c)
  drawScan(c)
  drawRobot()
  drawPick(c)
  drawScaleBar(c)
}

const toScreen = (x, y) => worldToScreen(view, width, height, x, y)

function drawMap() {
  if (!shown) return
  // Картинку строим один раз на карту (и при смене темы).
  if (!shown.tinted || shown.dark !== isDark.value) {
    shown.dark = isDark.value
    shown.tinted = gridCanvas(shown.meta, isDark.value ? PALETTES.dark : PALETTES.light)
  }
  const m = shown.meta
  // Левый верхний угол картинки = (origin.x, origin.y + height·res) в мире.
  const [sx, sy] = toScreen(m.origin[0], m.origin[1] + m.height * m.resolution)
  const size = m.resolution * view.scale
  ctx.save()
  ctx.imageSmoothingEnabled = size < 1
  ctx.drawImage(shown.tinted, sx, sy, m.width * size, m.height * size)
  ctx.restore()
}

function drawGrid(c) {
  const step = niceStep(view.scale, 32)
  const major = step * 5
  const x0 = view.cx - width / 2 / view.scale
  const x1 = view.cx + width / 2 / view.scale
  const y0 = view.cy - height / 2 / view.scale
  const y1 = view.cy + height / 2 / view.scale

  ctx.lineWidth = 1
  for (const [s, color] of [[step, c.minor], [major, c.major]]) {
    ctx.strokeStyle = color
    ctx.beginPath()
    for (let x = Math.ceil(x0 / s) * s; x <= x1; x += s) {
      const [px] = toScreen(x, 0)
      ctx.moveTo(Math.round(px) + 0.5, 0)
      ctx.lineTo(Math.round(px) + 0.5, height)
    }
    for (let y = Math.ceil(y0 / s) * s; y <= y1; y += s) {
      const [, py] = toScreen(0, y)
      ctx.moveTo(0, Math.round(py) + 0.5)
      ctx.lineTo(width, Math.round(py) + 0.5)
    }
    ctx.stroke()
  }
}

// Начало координат фрейма: X — красная, Y — зелёная (как в RViz).
function drawAxes(c) {
  const [ox, oy] = toScreen(0, 0)
  const len = Math.max(20, view.scale * 0.5)
  ctx.lineWidth = 2
  ctx.strokeStyle = c.axisX
  ctx.beginPath()
  ctx.moveTo(ox, oy)
  ctx.lineTo(ox + len, oy)
  ctx.stroke()
  ctx.strokeStyle = c.axisY
  ctx.beginPath()
  ctx.moveTo(ox, oy)
  ctx.lineTo(ox, oy - len)
  ctx.stroke()
}

function drawPath(c) {
  if (!props.path?.length) return
  ctx.save()
  ctx.strokeStyle = c.nav
  ctx.lineWidth = 3
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.globalAlpha = 0.85
  ctx.beginPath()
  props.path.forEach(([x, y], i) => {
    const [px, py] = toScreen(x, y)
    if (i) ctx.lineTo(px, py)
    else ctx.moveTo(px, py)
  })
  ctx.stroke()
  ctx.restore()
}

/** Активная цель или маршрут: пройденные точки серые, текущая — яркая. */
function drawNav(c) {
  const n = props.nav
  if (!n?.poses?.length) return
  const active = n.state === 'active'
  if (n.kind === 'route' && n.poses.length > 1) {
    polyline(n.poses, active ? c.nav : c.done, [6, 6], 2)
  }
  n.poses.forEach((p, i) => {
    const passed = !active || i < n.index
    const color = passed && !(n.state === 'succeeded' && i === n.poses.length - 1) ? c.done : c.nav
    if (n.kind === 'goal') drawGoalFlag(p, color)
    else drawWaypoint(p, i + 1, color, c, active && i === n.index)
  })
}

function drawDraft(c) {
  const d = props.draft
  if (!d?.length) return
  polyline(d, c.draft, [6, 6], 2)
  d.forEach((p, i) => drawWaypoint(p, i + 1, c.draft, c, false))
}

function polyline(poses, color, dash, lineWidth) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.setLineDash(dash)
  ctx.beginPath()
  poses.forEach((p, i) => {
    const [px, py] = toScreen(p.x, p.y)
    if (i) ctx.lineTo(px, py)
    else ctx.moveTo(px, py)
  })
  ctx.stroke()
  ctx.restore()
}

/** Стрелка позы: от точки в направлении theta. */
function drawArrow(x, y, theta, color, len = 34) {
  const [px, py] = toScreen(x, y)
  ctx.save()
  ctx.translate(px, py)
  ctx.rotate(-theta)
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(len - 10, 0)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(len, 0)
  ctx.lineTo(len - 12, -7)
  ctx.lineTo(len - 12, 7)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.arc(0, 0, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawGoalFlag(p, color) {
  drawArrow(p.x, p.y, p.theta, color)
  const [px, py] = toScreen(p.x, p.y)
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(px, py, 11, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function drawWaypoint(p, n, color, c, current) {
  drawArrow(p.x, p.y, p.theta, color, 26)
  const [px, py] = toScreen(p.x, p.y)
  ctx.save()
  if (current) {
    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(px, py, 16, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(px, py, 10, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = c.label
  ctx.font = 'bold 11px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(String(n), px, py + 0.5)
  ctx.restore()
}

function drawScan(c) {
  if (!props.scan?.length) return
  const s = Math.max(2, Math.min(4, view.scale * 0.04))
  ctx.fillStyle = c.scan
  for (const [x, y] of props.scan) {
    const [px, py] = toScreen(x, y)
    ctx.fillRect(px - s / 2, py - s / 2, s, s)
  }
}

// Робот — цвет выбранной гаммы (brand-800, в тёмной теме brand-400), вид — из настроек интерфейса.
function drawRobot() {
  const p = props.pose
  if (!p) return
  const [px, py] = toScreen(p.x, p.y)
  const r = Math.max(8, props.robotRadius * view.scale)
  ctx.save()
  ctx.translate(px, py)
  // Экранная ось Y вниз → угол мира с минусом.
  ctx.rotate(-p.theta)
  drawRobotShape(ctx, robotLook.kind.value, r, isDark.value ? brand.value[400] : brand.value[800])
  ctx.restore()
}

/** Предпросмотр жеста инструмента. */
function drawPick(c) {
  if (!pick) return
  const p = pickedPose()
  const color = props.tool === 'pose' ? c.pose : props.tool === 'route' ? c.draft : c.nav
  if (props.tool === 'pose') {
    // Силуэт робота в будущей позе.
    const [px, py] = toScreen(p.x, p.y)
    ctx.save()
    ctx.strokeStyle = color
    ctx.setLineDash([4, 4])
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(px, py, Math.max(8, props.robotRadius * view.scale), 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
  drawArrow(p.x, p.y, p.theta, color, 42)
}

function drawScaleBar(c) {
  const meters = niceStep(view.scale, 80)
  const px = meters * view.scale
  const x = 16
  const y = height - 16
  ctx.strokeStyle = c.text
  ctx.fillStyle = c.text
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(x, y - 5)
  ctx.lineTo(x, y)
  ctx.lineTo(x + px, y)
  ctx.lineTo(x + px, y - 5)
  ctx.stroke()
  ctx.font = '11px "JetBrains Mono", ui-monospace, monospace'
  ctx.textAlign = 'left'
  ctx.fillText(meters < 1 ? `${meters * 100} cm` : `${meters} m`, x + 4, y - 8)
}

// ---------- Размер ----------

let resizeObserver = null
function resize() {
  const rect = wrap.value.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  width = rect.width
  height = rect.height
  canvas.value.width = Math.round(width * dpr)
  canvas.value.height = Math.round(height * dpr)
  draw()
}

// ---------- Ввод: мышь, тач, колесо ----------

const pointers = new Map() // pointerId -> { x, y }
// Координаты под курсором (в мире), пока указатель над картой.
const cursor = ref(null)
let pinch = null // { dist, mid }

function local(e) {
  const rect = canvas.value.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function toWorld(p) {
  const [x, y] = screenToWorld(view, width, height, p.x, p.y)
  return { x, y }
}

/**
 * Поза из жеста. Потянули — направление по стрелке. Тапнули — по ходу движения:
 * для цели от робота к точке, для маршрута от предыдущей точки, для позы — как сейчас.
 */
function pickedPose() {
  const { start, end, dragged } = pick
  if (dragged) return { ...start, theta: heading(start, end) }
  if (props.tool === 'pose') return { ...start, theta: props.pose?.theta ?? 0 }
  const from = props.tool === 'route' && props.draft?.length ? props.draft[props.draft.length - 1] : props.pose
  return { ...start, theta: from ? heading(from, start) : 0 }
}

function onPointerDown(e) {
  try {
    canvas.value.setPointerCapture(e.pointerId)
  } catch (_) {}
  const p = local(e)
  pointers.set(e.pointerId, p)
  // Инструмент — только одним пальцем / левой кнопкой.
  if (props.tool && pointers.size === 1 && e.button === 0) {
    const w = toWorld(p)
    pick = { pointerId: e.pointerId, start: w, end: w, startPx: p, dragged: false }
    requestDraw()
    return
  }
  // Второй палец во время жеста — это уже масштаб, жест отменяем.
  if (pick) pick = null
  if (pointers.size === 2) pinch = pinchState()
}

function onPointerMove(e) {
  cursor.value = toWorld(local(e))
  const prev = pointers.get(e.pointerId)
  if (!prev) return
  const cur = local(e)
  pointers.set(e.pointerId, cur)

  if (pick && e.pointerId === pick.pointerId) {
    pick.end = toWorld(cur)
    if (Math.hypot(cur.x - pick.startPx.x, cur.y - pick.startPx.y) > DRAG_PX) pick.dragged = true
    requestDraw()
    return
  }

  if (pointers.size === 1) {
    if (cur.x === prev.x && cur.y === prev.y) return
    follow.value = false
    view = pan(view, cur.x - prev.x, cur.y - prev.y)
  } else if (pointers.size === 2 && pinch) {
    // Два пальца: масштаб вокруг середины + перемещение за серединой.
    const next = pinchState()
    if (pinch.dist > 0) view = zoomAt(view, width, height, next.mid.x, next.mid.y, next.dist / pinch.dist)
    view = pan(view, next.mid.x - pinch.mid.x, next.mid.y - pinch.mid.y)
    follow.value = false
    pinch = next
  }
  requestDraw()
}

function onPointerUp(e) {
  if (pick && e.pointerId === pick.pointerId) {
    if (e.type === 'pointerup') emit('pick', roundPose(pickedPose()))
    pick = null
    requestDraw()
  }
  pointers.delete(e.pointerId)
  pinch = pointers.size === 2 ? pinchState() : null
}

function pinchState() {
  const [a, b] = [...pointers.values()]
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
}

function roundPose(p) {
  const r = (v, k) => Math.round(v * k) / k
  return { x: r(p.x, 1000), y: r(p.y, 1000), theta: r(p.theta, 1000) }
}

function onWheel(e) {
  const p = local(e)
  // При follow масштабируем вокруг робота, чтобы он не уезжал из центра.
  const [sx, sy] = follow.value ? [width / 2, height / 2] : [p.x, p.y]
  view = zoomAt(view, width, height, sx, sy, Math.exp(-e.deltaY * 0.0015))
  requestDraw()
}

function zoomBy(factor) {
  view = zoomAt(view, width, height, width / 2, height / 2, factor)
  requestDraw()
}

function centerOnRobot() {
  follow.value = true
  requestDraw()
}

const cursorClass = computed(() => (props.tool ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'))

// ---------- Жизненный цикл ----------

watch(() => props.map, (m) => {
  shown = m?.data ? { meta: m, tinted: null, dark: null } : null
  requestDraw()
}, { immediate: true })

watch(
  () => [props.pose, props.scan, props.map, props.path, props.nav, props.draft, props.tool, follow.value, isDark.value, brand.value, robotLook.kind.value],
  requestDraw,
  { deep: false },
)
// Черновик меняют на месте (push/splice) — следим глубоко.
watch(() => props.draft, requestDraw, { deep: true })
// Сменили инструмент посреди жеста — жест отменяется.
watch(() => props.tool, () => (pick = null))

onMounted(() => {
  ctx = canvas.value.getContext('2d')
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(wrap.value)
  resize()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  cancelAnimationFrame(frame)
})
</script>

<template>
  <div ref="wrap" class="relative h-full w-full overflow-hidden">
    <canvas
      ref="canvas"
      class="absolute inset-0 h-full w-full touch-none"
      :class="cursorClass"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="cursor = null"
      @wheel.prevent="onWheel"
      @contextmenu.prevent
    ></canvas>

    <div class="absolute top-3 right-3 flex flex-col gap-1.5">
      <button type="button" class="map-btn" :title="t('map.zoomIn')" @click="zoomBy(1.5)">+</button>
      <button type="button" class="map-btn" :title="t('map.zoomOut')" @click="zoomBy(1 / 1.5)">−</button>
      <button
        type="button"
        class="map-btn"
        :class="{ 'map-btn-active': follow }"
        :title="t('map.follow')"
        @click="centerOnRobot"
      >
        ◎
      </button>
    </div>

    <slot />

    <div
      v-if="cursor"
      class="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-white/85 px-2 py-1 font-mono text-[11px] text-slate-600 tabular-nums dark:bg-slate-900/85 dark:text-slate-300"
    >
      x {{ cursor.x.toFixed(2) }} · y {{ cursor.y.toFixed(2) }} m
    </div>

    <div
      v-if="!pose"
      class="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-400"
    >
      {{ t('map.noPose') }}
    </div>
  </div>
</template>

<style scoped>
@reference '../assets/main.css';

.map-btn {
  @apply grid h-10 w-10 place-items-center rounded-md border border-slate-200 bg-white/90 font-mono text-lg text-slate-700 shadow-sm transition select-none hover:bg-white active:scale-95 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-200 dark:hover:bg-slate-800;
}
.map-btn-active {
  @apply border-brand-700 text-brand-800 dark:border-brand-400 dark:text-brand-300;
}
</style>
