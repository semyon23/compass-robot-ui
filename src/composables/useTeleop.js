import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRobotStore } from '../stores/robot'
import { stop } from '../api/robot'

const SEND_MS = 100 // 10 Гц; сторожевой таймер на роботе — 500 мс

const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  strafeLeft: ['KeyQ'], // вбок — только у holonomic-робота
  strafeRight: ['KeyE'],
}
const ALL_KEYS = new Set(Object.values(KEYS).flat())

/**
 * Ручное управление: джойстик или клавиатура → /compass/teleop.
 *
 * - Пока ввод ненулевой — шлём cmd_vel каждые 100 мс.
 * - Ввод обнулился — один нулевой cmd_vel и тишина (робот и так встанет по таймауту).
 * - enabled=false (нет управления/связи), потеря фокуса окна, уход с экрана — стоп.
 * - Пробел — СТОП.
 *
 * limits — ref { linear, angular } (м/с, рад/с) с учётом ползунка скорости.
 * holonomic — робот ездит боком (меканум, омни): Q/E — вбок; strafe — джойстик по горизонтали
 * двигает вбок, а не поворачивает.
 */
export function useTeleop({ enabled, limits, holonomic, strafe }) {
  const robot = useRobotStore()
  const joystick = ref({ x: 0, y: 0 })
  const pressed = ref(new Set())
  let timer = null
  let sending = false

  // Вектор ввода: x — поворот, y — вперёд, s — вбок (вправо +). Джойстик важнее клавиатуры.
  const input = computed(() => {
    const j = joystick.value
    if (j.x || j.y) return strafe.value ? { x: 0, y: j.y, s: j.x } : { x: j.x, y: j.y, s: 0 }
    const has = (dir) => KEYS[dir].some((k) => pressed.value.has(k))
    return {
      x: (has('right') ? 1 : 0) - (has('left') ? 1 : 0),
      y: (has('forward') ? 1 : 0) - (has('back') ? 1 : 0),
      s: (has('strafeRight') ? 1 : 0) - (has('strafeLeft') ? 1 : 0),
    }
  })

  const command = computed(() => {
    if (!enabled.value) return { linear: 0, angular: 0, lateral: 0 }
    const { x, y, s } = input.value
    // Вправо — поворот по часовой и движение вбок вправо: отрицательные angular и lateral (REP-103).
    return {
      linear: round(y * limits.value.linear),
      angular: round(-x * limits.value.angular),
      lateral: holonomic.value ? round(-s * limits.value.linear) : 0,
    }
  })

  function tick() {
    const cmd = command.value
    const moving = cmd.linear !== 0 || cmd.angular !== 0 || cmd.lateral !== 0
    if (moving) {
      robot.sendTeleop(cmd.linear, cmd.angular, cmd.lateral)
      sending = true
    } else if (sending) {
      robot.sendTeleop(0, 0, 0)
      sending = false
    }
  }

  function clearInput() {
    joystick.value = { x: 0, y: 0 }
    pressed.value = new Set()
  }

  function isTyping(e) {
    const el = e.target
    return el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
  }

  function onKeyDown(e) {
    if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.code === 'Space') {
      e.preventDefault()
      clearInput()
      stop().catch(() => {})
      return
    }
    if (!ALL_KEYS.has(e.code)) return
    e.preventDefault()
    if (!pressed.value.has(e.code)) pressed.value = new Set(pressed.value).add(e.code)
  }

  function onKeyUp(e) {
    if (!pressed.value.has(e.code)) return
    const next = new Set(pressed.value)
    next.delete(e.code)
    pressed.value = next
  }

  function onVisibility() {
    if (document.hidden) clearInput()
  }

  onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearInput)
    document.addEventListener('visibilitychange', onVisibility)
    timer = setInterval(tick, SEND_MS)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', clearInput)
    document.removeEventListener('visibilitychange', onVisibility)
    clearInterval(timer)
    if (sending) robot.sendTeleop(0, 0, 0)
  })

  return { joystick, pressed, command }
}

function round(v) {
  return Math.round(v * 1000) / 1000 || 0
}
