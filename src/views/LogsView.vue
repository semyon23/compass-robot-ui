<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NButton, NDropdown, NInput, NSelect, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useLocalStorage } from '@vueuse/core'
import * as ros from '../api/rosbridge'
import { useRobotStore } from '../stores/robot'
import { errorText } from '../lib/errorText'
import { collectLogs } from '../api/logs'
import { saveBlob } from '../lib/download'

/**
 * Журнал робота: живой /rosout (логи всех нод — Nav2, AMCL, SLAM, compass_core, оркестратор)
 * и, при открытии, WARN+ из памяти compass_core — что было, пока Compass не был открыт.
 * Всё хранится только в этой вкладке; последние MAX_ENTRIES строк.
 */
const { t, locale } = useI18n()
const message = useMessage()
const robot = useRobotStore()

const MAX_ENTRIES = 2000
const LEVELS = { 10: 'debug', 20: 'info', 30: 'warn', 40: 'error', 50: 'fatal' }

// Группы нод — по именам из nav2_bringup, slam_toolbox и compass_bringup.
const GROUPS = {
  nav2: /controller|planner|bt_navigator|behavior|smoother|collision|waypoint|docking|route_server|lifecycle_manager_navigation|costmap/,
  localization: /amcl|map_server|lifecycle_manager_localization/,
  slam: /slam/,
  compass: /compass|rosbridge|twist_mux/,
  orchestrator: /task_orchestrator/,
}

const entries = ref([])
let seq = 0

function add(e, receivedNow) {
  const ms = e.stamp.sec * 1000 + Math.floor(e.stamp.nanosec / 1e6)
  entries.value.push({
    id: ++seq,
    // В симуляции ноды ставят sim time (от нуля) — тогда берём момент получения.
    time: new Date(receivedNow && ms < Date.UTC(2020, 0, 1) ? Date.now() : ms),
    level: e.level,
    name: e.name,
    msg: e.msg,
    where: e.file ? `${e.file}:${e.line} · ${e.function}` : '',
  })
  if (entries.value.length > MAX_ENTRIES) entries.value.splice(0, entries.value.length - MAX_ENTRIES)
}

// ---------- Источники ----------

async function loadHistory() {
  try {
    const res = await ros.call('/compass/logs/history', { min_level: 30, limit: 0 })
    const live = entries.value
    entries.value = []
    res.entries.forEach((e) => add(e, false))
    live.forEach((e) => entries.value.push(e))
  } catch (e) {
    message.error(errorText(e))
  }
}

let off = null
onMounted(() => {
  off = ros.subscribe('/rosout', 'rcl_interfaces/msg/Log', (e) => add(e, true))
})
onBeforeUnmount(() => off?.())
watch(() => robot.online, (online) => online && loadHistory(), { immediate: true })

// ---------- Фильтры ----------

const minLevel = useLocalStorage('compass.logs.minLevel', 20)
const group = ref('all')
const search = ref('')
const paused = ref(false)
const frozen = ref([])

watch(paused, (p) => (frozen.value = p ? [...entries.value] : []))

const levelOptions = computed(() =>
  Object.entries(LEVELS).map(([v, key]) => ({ value: Number(v), label: t(`logs.level_${key}`) })),
)
const groupOptions = computed(() => [
  { value: 'all', label: t('logs.groupAll') },
  ...Object.keys(GROUPS).map((g) => ({ value: g, label: t(`logs.group_${g}`) })),
])

const shown = computed(() => {
  const q = search.value.trim().toLowerCase()
  const re = GROUPS[group.value]
  return (paused.value ? frozen.value : entries.value).filter(
    (e) =>
      e.level >= minLevel.value &&
      (!re || re.test(e.name)) &&
      (!q || e.msg.toLowerCase().includes(q) || e.name.toLowerCase().includes(q)),
  )
})

function clear() {
  entries.value = []
  frozen.value = []
}

// ---------- Скачать логи робота за период (zip: логи ROS и журнал compass_core) ----------

const PERIODS = [0.25, 1, 6, 24, 24 * 7] // часы
const periodOptions = computed(() => PERIODS.map((h) => ({ key: h, label: t(`logs.period_${String(h).replace('.', '_')}`) })))
const downloading = ref(false)

async function download(hours) {
  downloading.value = true
  try {
    const res = await collectLogs(Date.now() - hours * 3600 * 1000)
    if (!res) return message.info(t('logs.downloadEmpty'))
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
    saveBlob(`${robot.robotName}-logs-${stamp}.zip`, new Blob([res.zip], { type: 'application/zip' }))
    message.success(t('logs.downloaded', { n: res.count, mb: (res.size / 1048576).toFixed(1) }))
  } catch (e) {
    message.error(errorText(e))
  } finally {
    downloading.value = false
  }
}

// ---------- Прокрутка: новые внизу, как в терминале ----------

const list = ref(null)
const follow = ref(true)

function onScroll() {
  const el = list.value
  follow.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}
function toBottom() {
  follow.value = true
  nextTick(() => list.value && (list.value.scrollTop = list.value.scrollHeight))
}
watch(() => shown.value.length, () => follow.value && toBottom())

// ---------- Строка ----------

const expanded = ref(null)
const timeText = (d) =>
  d.toLocaleTimeString(locale.value, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')

async function copy(e) {
  try {
    await navigator.clipboard.writeText(`${e.time.toISOString()} [${LEVELS[e.level] || e.level}] [${e.name}] ${e.msg}`)
    message.success(t('logs.copied'))
  } catch (_) {
    // буфер обмена недоступен (не https) — молча
  }
}

const LEVEL_CLASSES = {
  10: 'text-slate-400',
  20: 'text-sky-700 dark:text-sky-400',
  30: 'text-amber-700 dark:text-amber-400',
  40: 'text-red-700 dark:text-red-400',
  50: 'bg-red-600 text-white',
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <h1 class="mr-2 text-lg font-semibold">{{ t('nav.logs') }}</h1>
      <NSelect v-model:value="minLevel" :options="levelOptions" class="!w-36" />
      <NSelect v-model:value="group" :options="groupOptions" class="!w-44" />
      <NInput v-model:value="search" :placeholder="t('logs.search')" clearable class="!w-56" />
      <div class="ml-auto flex items-center gap-2">
        <span class="text-xs text-slate-500 tabular-nums dark:text-slate-400">{{ t('logs.count', { n: shown.length }) }}</span>
        <NButton :type="paused ? 'warning' : 'default'" @click="paused = !paused">
          {{ paused ? t('logs.resume') : t('logs.pause') }}
        </NButton>
        <NButton @click="clear">{{ t('logs.clear') }}</NButton>
        <NDropdown trigger="click" :options="periodOptions" @select="download">
          <NButton :loading="downloading">{{ t('logs.download') }}</NButton>
        </NDropdown>
      </div>
    </div>

    <div class="relative min-h-0 flex-1 rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div ref="list" class="h-full overflow-y-auto font-mono text-xs" @scroll="onScroll">
        <div v-if="!shown.length" class="grid h-full place-items-center text-sm text-slate-400">
          {{ entries.length ? t('logs.nothingFiltered') : t('logs.empty') }}
        </div>
        <div
          v-for="e in shown"
          :key="e.id"
          class="cursor-pointer border-b border-slate-100 px-3 py-1 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/50"
          @click="expanded = expanded === e.id ? null : e.id"
        >
          <div class="flex gap-3">
            <span class="shrink-0 text-slate-400 tabular-nums">{{ timeText(e.time) }}</span>
            <span class="w-12 shrink-0 rounded px-1 text-center font-semibold uppercase" :class="LEVEL_CLASSES[e.level]">
              {{ LEVELS[e.level] || e.level }}
            </span>
            <span class="w-44 shrink-0 truncate text-slate-500 dark:text-slate-400" :title="e.name">{{ e.name }}</span>
            <span class="min-w-0 flex-1 break-words whitespace-pre-wrap text-slate-800 dark:text-slate-100">{{ e.msg }}</span>
          </div>
          <div v-if="expanded === e.id" class="mt-1 flex items-center gap-3 pl-[7.5rem] text-slate-500 dark:text-slate-400">
            <span class="min-w-0 flex-1 truncate">{{ e.where || '—' }}</span>
            <NButton size="tiny" @click.stop="copy(e)">{{ t('logs.copy') }}</NButton>
          </div>
        </div>
      </div>
      <NButton v-if="!follow" size="small" type="primary" class="!absolute right-4 bottom-4 shadow" @click="toBottom">
        ↓ {{ t('logs.toNewest') }}
      </NButton>
    </div>
  </div>
</template>
