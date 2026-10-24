<script setup>
import { computed } from 'vue'
import { NCard } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRobotStore } from '../stores/robot'
import { MODE_COLORS } from '../lib/modes'

const { t, te, locale } = useI18n()
const robot = useRobotStore()

const status = computed(() => robot.status)
const modeColor = computed(() => MODE_COLORS[robot.displayMode] || MODE_COLORS.unknown)

const battery = computed(() => status.value?.battery ?? null)
const batteryColor = computed(() => {
  const p = battery.value?.percent ?? 0
  if (p < 15) return '#dc2626'
  if (p < 30) return '#d97706'
  return '#059669'
})

const STACK_COLORS = {
  running: '#22c55e',
  starting: '#eab308',
  stopping: '#eab308',
  stopped: '#94a3b8',
  failed: '#ef4444',
}

const LEVEL_COLORS = { info: '#3b82f6', warning: '#d97706', error: '#dc2626' }

const controlText = computed(() => {
  const c = status.value?.control
  if (!c || c.owner === 'none') return t('control.none')
  if (c.owner === 'me') return t('control.me')
  return t('control.other', { client: c.client || '—' })
})

// Текст события по коду; если код UI неизвестен — сообщение робота.
function eventText(ev) {
  if (!te(`events.${ev.code}`)) return ev.message
  const details = { ...ev.details }
  if (details.mode && te(`mode.${details.mode}`)) details.mode = t(`mode.${details.mode}`)
  return t(`events.${ev.code}`, details)
}

function timeOf(iso) {
  const d = new Date(iso)
  return isNaN(d) ? '' : d.toLocaleTimeString(locale.value)
}
</script>

<template>
  <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
    <NCard size="small" :title="t('overview.mode')" class="!bg-white dark:!bg-slate-900">
      <div class="text-xl leading-tight font-semibold" :style="{ color: modeColor }">{{ t(`mode.${robot.displayMode}`) }}</div>
      <div class="mt-1 text-sm text-slate-500 dark:text-slate-400">
        {{ t('overview.map') }}:
        <span class="text-slate-700 dark:text-slate-200">{{ status?.map?.name || t('overview.noMap') }}</span>
      </div>
    </NCard>

    <NCard size="small" :title="t('overview.battery')" class="!bg-white dark:!bg-slate-900">
      <template v-if="battery">
        <div class="flex items-baseline gap-2">
          <span class="text-xl leading-tight font-semibold">{{ Math.round(battery.percent) }}%</span>
          <span v-if="battery.voltage != null" class="font-mono text-xs text-slate-500">{{ battery.voltage.toFixed(1) }} V</span>
          <span v-if="battery.charging" class="text-xs text-emerald-600">{{ t('overview.charging') }}</span>
        </div>
        <div class="mt-2 h-2 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
          <div class="h-full transition-all" :style="{ width: `${battery.percent}%`, backgroundColor: batteryColor }"></div>
        </div>
      </template>
      <div v-else class="text-xl leading-tight font-semibold text-slate-400">{{ t('overview.batteryNoData') }}</div>
    </NCard>

    <NCard size="small" :title="t('overview.localization')" class="!bg-white dark:!bg-slate-900">
      <div class="text-xl leading-tight font-semibold">
        {{ status?.localization ? t(`localization.${status.localization.status}`) : '—' }}
      </div>
    </NCard>

    <NCard size="small" :title="t('overview.control')" class="!bg-white dark:!bg-slate-900">
      <div class="text-xl leading-tight font-semibold">{{ status ? controlText : '—' }}</div>
    </NCard>

    <NCard size="small" :title="t('overview.stacks')" class="!bg-white md:col-span-1 xl:col-span-2 dark:!bg-slate-900">
      <ul v-if="status?.stacks?.length" class="divide-y divide-slate-100 dark:divide-slate-800">
        <li v-for="s in status.stacks" :key="s.name" class="flex items-center justify-between py-2">
          <span class="font-mono text-sm">{{ s.name }}</span>
          <span class="flex items-center gap-2 text-sm">
            <span class="inline-block h-2 w-2 rounded-full" :style="{ backgroundColor: STACK_COLORS[s.state] }"></span>
            {{ t(`stack.${s.state}`) }}
          </span>
        </li>
      </ul>
      <div v-else class="py-2 text-sm text-slate-400">—</div>
    </NCard>

    <NCard size="small" :title="t('overview.events')" class="!bg-white md:col-span-1 xl:col-span-2 dark:!bg-slate-900">
      <ul v-if="robot.events.length" class="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
        <li v-for="ev in robot.events" :key="ev.id" class="flex items-start gap-3 py-2 text-sm">
          <span class="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" :style="{ backgroundColor: LEVEL_COLORS[ev.level] }"></span>
          <span class="flex-1">{{ eventText(ev) }}</span>
          <span class="shrink-0 font-mono text-xs text-slate-400">{{ timeOf(ev.time) }}</span>
        </li>
      </ul>
      <div v-else class="py-2 text-sm text-slate-400">{{ t('overview.noEvents') }}</div>
    </NCard>
  </div>
</template>
