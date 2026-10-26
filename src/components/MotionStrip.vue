<script setup>
import { computed, ref } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRobotStore } from '../stores/robot'
import { navCancel } from '../api/navigation'
import { errorText } from '../lib/errorText'

/**
 * Строка движения поверх карты: что робот делает сейчас (цель или маршрут Compass, задание fms),
 * прогресс, расстояние и время. Когда цель завершилась — итог, пока его не закроют.
 */
const { t, te } = useI18n()
const message = useMessage()
const robot = useRobotStore()

const nav = computed(() => robot.navStatus)
const mode = computed(() => robot.status?.mode)

const missed = computed(() =>
  robot.navMissed && robot.navMissed.goalId === nav.value?.goalId ? robot.navMissed.points : [],
)
const RECOVERY = ['spin', 'backup', 'wait', 'clearing']

// Что показать: активная цель Compass → задание fms → итог последней цели.
const view = computed(() => {
  const n = nav.value
  const f = robot.fms
  if (n?.state === 'active') {
    const activity = robot.navActivity
    const headline = n.kind === 'route'
      ? t('motion.toPoint', { i: Math.min(n.index + 1, n.poses.length), n: n.poses.length })
      : t('motion.toGoal')
    return {
      tone: RECOVERY.includes(activity) ? 'warn' : 'ok',
      headline,
      detail: activity ? t(`navi.activity_${activity}`) : '',
      // По расстоянию до конца; маршрут с остановками его не сообщает — тогда по точкам.
      progress: robot.navMaxDist > 0 && n.distanceRemaining != null ? 1 - n.distanceRemaining / robot.navMaxDist
        : n.kind === 'route' ? n.index / n.poses.length : null,
      distance: n.distanceRemaining,
      eta: n.eta,
      cancel: true,
    }
  }
  if (f?.orderActive && ['AUTOMATIC', 'INTERVENED'].includes(mode.value)) {
    const state = mode.value === 'INTERVENED' ? 'intervened' : f.paused ? 'paused' : f.driving ? 'driving'
      : f.waitingForUpdate ? 'waiting' : 'standing'
    return {
      tone: state === 'intervened' ? 'warn' : 'fms',
      headline: t('motion.fmsOrder', { order: f.orderId }),
      detail: `${t('fms.node')} ${f.lastNodeId || '—'} · ${t(`fms.${state}`)}`,
    }
  }
  // Итог — только целям, которые шли при открытой странице (не вчерашним), и пока его не закрыли.
  if (n && n.state !== 'active' && robot.navSeen.has(n.goalId) && !robot.navDismissed.has(n.goalId)) {
    const total = n.poses.length
    if (n.state === 'succeeded' && missed.value.length) {
      return {
        tone: 'warn', result: true,
        headline: t('motion.routePartly', { done: total - missed.value.length, n: total }),
        detail: t('motion.missed', { points: missed.value.join(', ') }),
      }
    }
    if (n.state === 'succeeded') {
      return {
        tone: 'ok', result: true,
        headline: n.kind === 'route' ? t('motion.routeDone', { n: total }) : t('motion.goalDone'),
      }
    }
    if (n.state === 'failed') {
      const code = n.error?.code
      return {
        tone: 'error', result: true,
        headline: n.kind === 'route' ? t('motion.routeFailed', { i: n.index + 1, n: total }) : t('motion.goalFailed'),
        detail: code && te(`navi.err_${code}`) ? t(`navi.err_${code}`) : n.error?.message || '',
      }
    }
    return { tone: 'muted', result: true, headline: t('motion.canceled') }
  }
  return null
})

const TONES = {
  ok: { dot: 'bg-emerald-500', bar: 'bg-emerald-500', border: 'border-emerald-600/40' },
  fms: { dot: 'bg-cyan-500', bar: 'bg-cyan-500', border: 'border-cyan-600/40' },
  warn: { dot: 'bg-amber-500', bar: 'bg-amber-500', border: 'border-amber-500/50' },
  error: { dot: 'bg-red-500', bar: 'bg-red-500', border: 'border-red-500/60' },
  muted: { dot: 'bg-slate-400', bar: 'bg-slate-400', border: 'border-slate-300 dark:border-slate-600' },
}

function eta(sec) {
  if (sec == null) return ''
  const s = Math.round(sec)
  return s < 60 ? t('navi.sec', { s }) : t('navi.minSec', { m: Math.floor(s / 60), s: s % 60 })
}

const busy = ref(false)
async function cancel() {
  busy.value = true
  try {
    await navCancel()
  } catch (e) {
    message.error(errorText(e))
  } finally {
    busy.value = false
  }
}
const dismiss = () => (robot.navDismissed = new Set([...robot.navDismissed, nav.value.goalId]))
</script>

<template>
  <div
    v-if="view"
    class="flex w-full max-w-[34rem] items-center gap-3 rounded-lg border bg-white/95 px-3 py-2 shadow-md dark:bg-slate-900/95"
    :class="TONES[view.tone].border"
  >
    <span
      class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      :class="[TONES[view.tone].dot, { 'animate-pulse': !view.result }]"
    ></span>
    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-2">
        <span class="truncate text-sm font-semibold">{{ view.headline }}</span>
        <span v-if="view.distance != null" class="ml-auto shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400">
          {{ view.distance.toFixed(1) }} m<template v-if="view.eta != null"> · ~{{ eta(view.eta) }}</template>
        </span>
      </div>
      <div v-if="view.detail" class="truncate text-xs text-slate-600 dark:text-slate-300">{{ view.detail }}</div>
      <div v-if="view.progress != null" class="mt-1.5 h-1 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
        <div class="h-full transition-all" :class="TONES[view.tone].bar" :style="{ width: `${Math.round(view.progress * 100)}%` }"></div>
      </div>
    </div>
    <NButton v-if="view.cancel" size="small" type="error" ghost :loading="busy" @click="cancel">{{ t('navi.cancel') }}</NButton>
    <NButton v-else-if="view.result" size="tiny" quaternary :title="t('motion.close')" @click="dismiss">✕</NButton>
  </div>
</template>
