<script setup>
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { NTabs, NTabPane, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSessionStorage } from '@vueuse/core'
import MapCanvas from '../components/MapCanvas.vue'
import ControlCard from '../components/ControlCard.vue'
import JoystickCard from '../components/JoystickCard.vue'
import NavPanel from '../components/NavPanel.vue'
import FmsCard from '../components/FmsCard.vue'
import MapLayers from '../components/MapLayers.vue'
import CameraVideo from '../components/CameraVideo.vue'
import MotionStrip from '../components/MotionStrip.vue'
import { MAP_LAYERS, useMapLayers } from '../composables/useMapLayers'
import { useRobotStore } from '../stores/robot'
import { useSubscription } from '../composables/useSubscription'
import { activateMap } from '../api/navigation'
import { errorText } from '../lib/errorText'

const { t } = useI18n()
const message = useMessage()
const robot = useRobotStore()

useSubscription(['pose', 'scan', 'camera', 'path', 'bt', 'fmsPath'])

const follow = ref(true)
const joystickCard = ref(null)
const tab = ref('manual')

// ---------- Инструменты карты (как в RViz) ----------

const tool = ref(null) // null | 'pose' | 'goal' | 'route'
// Черновик маршрута переживает уход с экрана в пределах вкладки браузера.
const draft = useSessionStorage('compass.routeDraft', [])

// Навигация по карте — когда робот её умеет (capabilities из get_info).
const hasNav = computed(() => robot.capabilities.has('navigation'))
// Стеки на активной карте: localization (map_server + AMCL) — карта и поза; navigation (Nav2) —
// цели; Nav2 поднимается, когда у робота есть поза.
const stackRunning = (name) => robot.status?.stacks?.some((s) => s.name === name && s.state === 'running')
const navRunning = computed(() => stackRunning('localization'))
const navReady = computed(() => hasNav.value && navRunning.value && robot.status?.state === 'ready')
const localized = computed(() => robot.status?.localization?.status === 'ok')
// Работа с fms: маршрут order'а на карте и карточка fms в панели.
const fmsMode = computed(() => ['AUTOMATIC', 'INTERVENED'].includes(robot.status?.mode))
// Цель на карте: с недостигнутыми точками маршрута.
const navOnMap = computed(() => {
  const n = robot.navStatus
  const m = robot.navMissed
  return n && m?.goalId === n.goalId ? { ...n, missed: m.points } : n
})
// Маршрут fms — в списке слоёв, только когда есть агент VDA 5050.
const availableLayers = computed(() => MAP_LAYERS.filter((key) => key !== 'fmsRoute' || robot.fms))
const canCommand = computed(
  () =>
    navReady.value && stackRunning('navigation') && robot.status?.mode === 'SERVICE' && localized.value &&
    robot.online && robot.controlOwner === 'me',
)
const commandReason = computed(() => {
  if (!navReady.value) return t('tools.needNav')
  if (robot.status?.mode !== 'SERVICE') return t('navi.needService')
  if (!localized.value) return t('navi.needPose')
  return t('navi.needControl')
})

// /map — пока работает навигация: подписываемся, когда map_server уже публикует (rosbridge берёт
// QoS издателя в момент подписки, иначе латченую карту не получить). Перезапуск стека — заново.
let offMap = null
watch(
  () => robot.online && navRunning.value,
  (on) => {
    offMap?.()
    offMap = on ? robot.subscribeStreams(['map']) : null
    if (!on) robot.liveMap = null
  },
  { immediate: true },
)
onBeforeUnmount(() => offMap?.())

// Слои навигации: тяжёлые (карты стоимости, частицы, траектория) — подписка, только пока видны.
const layers = useMapLayers()
const LAYER_STREAMS = ['localPlan', 'particles', 'localCostmap', 'globalCostmap']
let offLayers = null
watch(
  () => [robot.online && navRunning.value, ...LAYER_STREAMS.map((n) => layers.value[n])],
  ([on]) => {
    offLayers?.()
    const names = LAYER_STREAMS.filter((n) => layers.value[n])
    offLayers = on && names.length ? robot.subscribeStreams(names) : null
  },
  { immediate: true },
)
onBeforeUnmount(() => offLayers?.())

const TOOLS = computed(() => [
  { id: null, icon: '✥', label: t('tools.pan'), enabled: true },
  { id: 'pose', icon: '⌖', label: t('tools.pose'), enabled: navReady.value, reason: t('tools.needNav') },
  { id: 'goal', icon: '⚑', label: t('tools.goal'), enabled: canCommand.value, reason: commandReason.value },
  { id: 'route', icon: '⋯', label: t('tools.route'), enabled: canCommand.value, reason: commandReason.value },
])

function selectTool(id) {
  tool.value = tool.value === id ? null : id
}

// Инструмент стал недоступен (отобрали управление, вышли из навигации) — выключаем.
watch(TOOLS, (list) => {
  if (tool.value && !list.find((x) => x.id === tool.value)?.enabled) tool.value = null
})
// Выбрали инструмент — показываем вкладку навигации, там маршрут и статус.
watch(tool, (v) => {
  if (v) tab.value = 'nav'
})

async function onPick(p) {
  if (tool.value === 'route') {
    draft.value = [...draft.value, p]
    return
  }
  // Поза и цель — одно нажатие, потом инструмент выключается (как в RViz).
  const which = tool.value
  tool.value = null
  try {
    if (which === 'pose') {
      // Поза для AMCL на активной карте — через compass_core (он и время, и фрейм проставит).
      await activateMap(robot.status.map.id, p)
      message.success(t('tools.poseSet'))
    } else if (which === 'goal') {
      await robot.navStart('goal', '', [p])
    }
  } catch (e) {
    message.error(errorText(e))
  }
}

function onKey(e) {
  if (e.key === 'Escape' && tool.value) tool.value = null
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

// ---------- Телеметрия ----------

const pose = computed(() => robot.pose)
const command = computed(() => joystickCard.value?.command ?? { linear: 0, angular: 0, lateral: 0 })
const fmt = (v, digits = 2) => (v == null ? '—' : v.toFixed(digits))
const deg = (rad) => (rad == null ? '—' : `${Math.round((rad * 180) / Math.PI)}°`)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
    <!-- Карта -->
    <div
      class="relative min-h-[360px] flex-1 overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <MapCanvas
        v-model:follow="follow"
        :pose="pose"
        :robot-radius="robot.info?.robotRadius ?? undefined"
        :scan="layers.scan ? robot.scan : null"
        :camera="layers.camera ? robot.camera : null"
        :map="layers.map ? robot.liveMap : null"
        :tool="tool"
        :path="navReady && layers.plan ? robot.navPath : null"
        :local-plan="navReady && layers.localPlan ? robot.localPlan : null"
        :particles="navRunning && layers.particles ? robot.particles : null"
        :local-costmap="navReady && layers.localCostmap ? robot.localCostmap : null"
        :global-costmap="navReady && layers.globalCostmap ? robot.globalCostmap : null"
        :fms-path="fmsMode && layers.fmsRoute ? robot.fmsPath : null"
        :nav="navReady && layers.goals ? navOnMap : null"
        :draft="navReady ? draft : null"
        @pick="onPick"
      >
        <!-- Инструменты -->
        <div
          v-if="hasNav"
          class="absolute top-3 left-3 flex overflow-hidden rounded-md border border-slate-200 bg-white/95 shadow-sm dark:border-slate-700 dark:bg-slate-900/95"
        >
          <button
            v-for="x in TOOLS"
            :key="x.id ?? 'pan'"
            type="button"
            class="tool-btn"
            :class="{ 'tool-btn-active': tool === x.id }"
            :disabled="!x.enabled"
            :title="x.enabled ? x.label : `${x.label} — ${x.reason}`"
            @click="selectTool(x.id)"
          >
            <span class="font-mono text-base leading-none">{{ x.icon }}</span>
            <span class="hidden xl:inline">{{ x.label }}</span>
          </button>
        </div>

        <!-- Слои — под кнопками масштаба -->
        <div v-if="hasNav" class="absolute top-[9.4rem] right-3">
          <MapLayers :available="availableLayers" />
        </div>

        <!-- Что робот делает сейчас: цель, маршрут или задание fms -->
        <div class="pointer-events-none absolute inset-x-3 bottom-10 flex justify-center">
          <MotionStrip class="pointer-events-auto" />
        </div>

        <!-- Подсказка к инструменту -->
        <div
          v-if="tool"
          class="pointer-events-none absolute top-16 left-1/2 max-w-[90%] -translate-x-1/2 rounded-md bg-slate-900/85 px-3 py-2 text-center text-xs text-white shadow dark:bg-slate-100/90 dark:text-slate-900"
        >
          {{ t(`tools.hint_${tool}`) }} · {{ t('tools.escHint') }}
        </div>

        <!-- Телеметрия — столбиком под инструментами; пока выбран инструмент, на её месте подсказка -->
        <dl
          v-if="pose && layers.telemetry && !tool"
          class="pointer-events-none absolute top-16 left-3 grid grid-cols-[auto_auto_auto] gap-x-2 rounded-md bg-white/85 px-3 py-2 font-mono text-[13px] leading-6 text-slate-700 tabular-nums shadow-sm dark:bg-slate-900/85 dark:text-slate-200"
        >
          <dt class="text-slate-400">x</dt>
          <dd class="pl-2 text-right">{{ fmt(pose.x) }}</dd>
          <dd class="text-slate-400">m</dd>
          <dt class="text-slate-400">y</dt>
          <dd class="pl-2 text-right">{{ fmt(pose.y) }}</dd>
          <dd class="text-slate-400">m</dd>
          <dt class="text-slate-400">θ</dt>
          <dd class="pl-2 text-right">{{ deg(pose.theta) }}</dd>
          <dd></dd>
          <dt class="text-slate-400">v</dt>
          <dd class="pl-2 text-right">{{ fmt(pose.linear) }}</dd>
          <dd class="text-slate-400">m/s</dd>
          <dt class="text-slate-400">ω</dt>
          <dd class="pl-2 text-right">{{ fmt(pose.angular) }}</dd>
          <dd class="text-slate-400">rad/s</dd>
          <template v-if="robot.controlOwner === 'me'">
            <dt class="text-slate-400">cmd</dt>
            <dd class="col-span-2 pl-2 text-right">
              {{ fmt(command.linear) }}<template v-if="robot.capabilities.has('holonomic')"> / {{ fmt(command.lateral) }}</template>
              / {{ fmt(command.angular) }}
            </dd>
          </template>
          <dt class="text-slate-400">{{ t('drive.frame') }}</dt>
          <dd class="col-span-2 pl-2 text-right">{{ pose.frame }}</dd>
        </dl>
      </MapCanvas>
      <CameraVideo v-if="layers.video" @close="layers.video = false" />
    </div>

    <!-- Панель -->
    <div class="flex w-full shrink-0 flex-col gap-4 overflow-y-auto lg:w-80">
      <FmsCard v-if="robot.fms" />
      <ControlCard />

      <!-- display-directive="show": джойстик и клавиатура работают и на вкладке навигации -->
      <JoystickCard v-if="!hasNav" ref="joystickCard" />
      <NTabs v-else v-model:value="tab" type="segment" size="small">
        <NTabPane name="manual" :tab="t('drive.tabManual')" display-directive="show">
          <JoystickCard ref="joystickCard" />
        </NTabPane>
        <NTabPane name="nav" :tab="t('drive.tabNav')" display-directive="show">
          <div class="flex flex-col gap-4">
            <NavPanel v-model:tool="tool" v-model:draft="draft" />
          </div>
        </NTabPane>
      </NTabs>
    </div>
  </div>
</template>

<style scoped>
@reference '../assets/main.css';

.tool-btn {
  @apply flex h-10 min-w-10 items-center justify-center gap-2 border-r border-slate-200 px-3 text-sm text-slate-700 transition select-none last:border-r-0 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800;
}
.tool-btn-active {
  @apply bg-brand-800 text-white hover:bg-brand-800 dark:bg-brand-700 dark:hover:bg-brand-700;
}
</style>
