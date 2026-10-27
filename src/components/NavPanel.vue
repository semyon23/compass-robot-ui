<script setup>
import { computed, ref, watch } from 'vue'
import { NButton, NRadioGroup, NRadioButton, NSelect, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useLocalStorage } from '@vueuse/core'
import { useRobotStore } from '../stores/robot'
import { listMaps } from '../api/maps'
import { activateMap, navCancel } from '../api/navigation'
import { errorText } from '../lib/errorText'

/**
 * Навигация на экране «Управление»: активная карта и локализация, текущая цель / маршрут,
 * редактор маршрута. Точки на карте ставит MapCanvas (инструменты), сюда приходят через draft.
 */
const tool = defineModel('tool', { type: String, default: null })
const draft = defineModel('draft', { type: Array, default: () => [] })

const { t, te } = useI18n()
const message = useMessage()
const robot = useRobotStore()

const status = computed(() => robot.status)
// localization (map_server + AMCL) — карта и поза; navigation (Nav2) — цели, поднимается после позы.
const stackState = (name) => status.value?.stacks?.find((s) => s.name === name)?.state || null
const navStack = computed(() => stackState('localization'))
const navRunning = computed(() => navStack.value === 'running')
const nav2Up = computed(() => stackState('navigation') === 'running')
const localization = computed(() => status.value?.localization?.status || 'none')
const inService = computed(() => status.value?.mode === 'SERVICE')
const canCommand = computed(
  () =>
    robot.online && inService.value && nav2Up.value && status.value?.state === 'ready' &&
    localization.value === 'ok' && robot.controlOwner === 'me',
)
const nav = computed(() => robot.navStatus)
const busy = ref(false)

async function run(action) {
  busy.value = true
  try {
    await action()
  } catch (e) {
    message.error(errorText(e))
  } finally {
    busy.value = false
  }
}

// ---------- Активная карта ----------

const maps = ref([])
const mapId = ref(null)
const mapOptions = computed(() => maps.value.map((m) => ({ label: m.name, value: m.id })))
const activeId = computed(() => status.value?.map?.id || null)

watch(
  () => robot.online,
  async (online) => {
    if (!online) return
    try {
      maps.value = await listMaps()
    } catch (_) {
      maps.value = []
    }
  },
  { immediate: true },
)
// В списке по умолчанию — активная карта робота.
watch(activeId, (id) => (mapId.value = id), { immediate: true })

const canActivate = computed(
  () =>
    robot.online && !!mapId.value && status.value?.state === 'ready' &&
    !['STARTUP', 'TEACH_IN'].includes(status.value?.mode) &&
    (mapId.value !== activeId.value || navStack.value !== 'running'),
)
const activate = () => run(() => activateMap(mapId.value))

const LOC_COLORS = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  uncertain: 'text-amber-700 dark:text-amber-400',
  lost: 'text-red-700 dark:text-red-400',
  none: 'text-slate-500 dark:text-slate-400',
}

// ---------- Текущая цель ----------

const STATE_COLORS = {
  active: 'text-emerald-700 dark:text-emerald-400',
  succeeded: 'text-emerald-700 dark:text-emerald-400',
  failed: 'text-red-700 dark:text-red-400',
  canceled: 'text-slate-500 dark:text-slate-400',
}

const navTitle = computed(() => {
  const n = nav.value
  if (!n) return ''
  return n.kind === 'goal' ? t('navi.goal') : `${t('navi.route')} · ${t(`navi.mode_${n.mode}`)}`
})

const failReason = computed(() => {
  const err = nav.value?.error
  if (!err) return null
  return te(`navi.err_${err.code}`) ? t(`navi.err_${err.code}`) : err.message
})

const cancel = () => run(() => navCancel())

function repeat() {
  const n = nav.value
  run(() => robot.navStart(n.kind, n.mode, n.poses))
}

function eta(sec) {
  if (sec == null) return '—'
  const s = Math.round(sec)
  return s < 60 ? t('navi.sec', { s }) : t('navi.minSec', { m: Math.floor(s / 60), s: s % 60 })
}

// ---------- Маршрут ----------

const routeMode = useLocalStorage('compass.routeMode', 'waypoints')
if (routeMode.value === 'through_poses') routeMode.value = 'line' // режим переименован (через ломаную, а не через планировщик)

function move(i, dir) {
  const next = [...draft.value]
  const j = i + dir
  ;[next[i], next[j]] = [next[j], next[i]]
  draft.value = next
}
function remove(i) {
  draft.value = draft.value.filter((_, k) => k !== i)
}
function clear() {
  draft.value = []
  if (tool.value === 'route') tool.value = null
}
function toggleRouteTool() {
  tool.value = tool.value === 'route' ? null : 'route'
}

function startRoute() {
  run(async () => {
    await robot.navStart('route', routeMode.value, draft.value)
    draft.value = []
    tool.value = null
  })
}

const fmtPose = (p) => `${p.x.toFixed(2)}, ${p.y.toFixed(2)} · ${Math.round((p.theta * 180) / Math.PI)}°`
</script>

<template>
  <!-- Карта, локализация и текущая цель -->
  <section class="panel-card">
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold">{{ t('navi.title') }}</h2>
      <span class="text-xs font-semibold" :class="LOC_COLORS[localization]">
        {{ t('overview.localization') }}: {{ t(`localization.${localization}`) }}
      </span>
    </div>

    <template v-if="mapOptions.length">
      <div class="mb-3 flex gap-2">
        <NSelect v-model:value="mapId" :options="mapOptions" :placeholder="t('navi.chooseMap')" class="min-w-0 flex-1" />
        <NButton type="primary" :loading="busy" :disabled="!canActivate" @click="activate">
          {{ mapId === activeId && navStack !== 'running' ? t('navi.restart') : t('navi.activate') }}
        </NButton>
      </div>
      <p v-if="!activeId" class="mb-3 text-sm text-slate-600 dark:text-slate-300">{{ t('navi.offText') }}</p>
    </template>
    <div v-else class="mb-3 text-sm text-slate-400">{{ t('navi.noMaps') }}</div>

    <div v-if="navStack === 'starting' || navStack === 'stopping'" class="mb-3 flex items-center gap-3 text-sm text-amber-700 dark:text-amber-400">
      <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500"></span>
      {{ t('navi.starting') }}
    </div>
    <div v-else-if="navStack === 'failed'" class="notice notice-error mb-3">{{ t('navi.failed') }}</div>
    <div v-else-if="navRunning && localization !== 'ok'" class="notice mb-3">
      <div class="mb-2">{{ t('navi.needPose') }}</div>
      <NButton size="small" type="warning" @click="tool = 'pose'">{{ t('navi.setPose') }}</NButton>
    </div>
    <div v-else-if="navRunning && !nav2Up" class="mb-3 flex items-center gap-3 text-sm text-amber-700 dark:text-amber-400">
      <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500"></span>
      {{ t('navi.nav2Starting') }}
    </div>
    <p v-if="navRunning && !inService" class="mb-3 text-xs text-slate-500 dark:text-slate-400">{{ t('navi.needService') }}</p>

    <div v-if="nav" class="rounded border border-slate-200 p-3 dark:border-slate-700">
      <div class="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span class="truncate font-medium">{{ navTitle }}</span>
        <span class="shrink-0 text-xs font-semibold" :class="STATE_COLORS[nav.state]">{{ t(`navi.state_${nav.state}`) }}</span>
      </div>
      <template v-if="nav.kind === 'route'">
        <div class="mb-1 text-xs text-slate-500 dark:text-slate-400">
          {{ t('navi.point', { i: Math.min(nav.index + 1, nav.poses.length), n: nav.poses.length }) }}
        </div>
        <div class="mb-2 h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
          <div class="h-full bg-emerald-500 transition-all" :style="{ width: `${(nav.index / nav.poses.length) * 100}%` }"></div>
        </div>
      </template>
      <div v-if="robot.navActivity" class="mb-1 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"></span>
        {{ t('navi.nav2Now') }}: {{ t(`navi.activity_${robot.navActivity}`) }}
        <span v-if="nav.recoveries" class="text-amber-700 dark:text-amber-400">· {{ t('navi.recoveries', { n: nav.recoveries }) }}</span>
      </div>
      <div v-if="nav.state === 'active' && nav.distanceRemaining != null" class="mb-3 font-mono text-xs text-slate-600 dark:text-slate-300">
        {{ nav.distanceRemaining.toFixed(1) }} m · ~{{ eta(nav.eta) }}
      </div>
      <div v-if="failReason" class="mb-3 text-xs text-red-700 dark:text-red-400">{{ failReason }}</div>
      <NButton v-if="nav.state === 'active'" block type="error" ghost :loading="busy" @click="cancel">
        {{ t('navi.cancel') }}
      </NButton>
      <NButton v-else block :loading="busy" :disabled="!canCommand" @click="repeat">{{ t('navi.repeat') }}</NButton>
    </div>
    <div v-else-if="navRunning" class="text-sm text-slate-400">{{ t('navi.noGoal') }}</div>

    <p v-if="navRunning && robot.controlOwner !== 'me'" class="mt-3 text-xs text-slate-500 dark:text-slate-400">
      {{ t('navi.needControl') }}
    </p>
  </section>

  <!-- Редактор маршрута -->
  <section v-if="navRunning" class="panel-card">
    <h2 class="panel-title">{{ t('navi.route') }}</h2>
    <NRadioGroup v-model:value="routeMode" size="small" class="mb-2 flex">
      <NRadioButton value="waypoints" class="flex-1 text-center">{{ t('navi.mode_waypoints') }}</NRadioButton>
      <NRadioButton value="line" class="flex-1 text-center">{{ t('navi.mode_line') }}</NRadioButton>
    </NRadioGroup>
    <p class="mb-3 text-xs text-slate-500 dark:text-slate-400">{{ t(`navi.help_${routeMode}`) }}</p>

    <ol v-if="draft.length" class="mb-3 max-h-56 divide-y divide-slate-100 overflow-y-auto rounded border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
      <li v-for="(p, i) in draft" :key="i" class="flex items-center gap-2 px-2 py-1.5 text-sm">
        <span class="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-white">{{ i + 1 }}</span>
        <span class="flex-1 truncate font-mono text-xs">{{ fmtPose(p) }}</span>
        <button type="button" class="route-btn" :disabled="i === 0" :title="t('navi.up')" @click="move(i, -1)">↑</button>
        <button type="button" class="route-btn" :disabled="i === draft.length - 1" :title="t('navi.down')" @click="move(i, 1)">↓</button>
        <button type="button" class="route-btn hover:!text-red-600" :title="t('navi.remove')" @click="remove(i)">✕</button>
      </li>
    </ol>
    <p v-else class="mb-3 text-sm text-slate-400">{{ t('navi.routeEmpty') }}</p>

    <div class="grid grid-cols-2 gap-2">
      <NButton :type="tool === 'route' ? 'warning' : 'default'" :disabled="!canCommand" @click="toggleRouteTool">
        {{ tool === 'route' ? t('navi.doneAdding') : t('navi.addPoints') }}
      </NButton>
      <NButton :disabled="!draft.length" @click="clear">{{ t('navi.clear') }}</NButton>
      <NButton class="col-span-2" type="primary" size="large" :loading="busy" :disabled="!draft.length || !canCommand" @click="startRoute">
        {{ t('navi.go', { n: draft.length }) }}
      </NButton>
    </div>
  </section>
</template>

<style scoped>
@reference '../assets/main.css';

.notice {
  @apply rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200;
}
.notice-error {
  @apply border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200;
}
.route-btn {
  @apply grid h-7 w-7 shrink-0 place-items-center rounded font-mono text-sm text-slate-500 transition hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent dark:text-slate-400 dark:hover:bg-slate-800;
}
</style>
