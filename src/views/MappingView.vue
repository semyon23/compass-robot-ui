<script setup>
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NInput, NModal, NSelect, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import MapCanvas from '../components/MapCanvas.vue'
import ControlCard from '../components/ControlCard.vue'
import JoystickCard from '../components/JoystickCard.vue'
import { useRobotStore } from '../stores/robot'
import { useSubscription } from '../composables/useSubscription'
import { setOperatingMode } from '../api/robot'
import { listMaps, setMappingPaused, saveMapping } from '../api/maps'
import { errorText } from '../lib/errorText'

const { t, locale } = useI18n()
const message = useMessage()
const robot = useRobotStore()
const route = useRoute()

useSubscription(['pose', 'scan'])

const status = computed(() => robot.status)

// /map — только когда SLAM уже запущен: rosbridge выбирает QoS подписки по издателям в момент
// подписки, и только так получит последнюю карту (transient_local), даже если робот стоит —
// slam_toolbox публикует /map лишь при изменениях.
let offMap = null
watch(
  () => robot.online && status.value?.mode === 'TEACH_IN' && status.value?.state === 'ready',
  (ready) => {
    offMap?.()
    offMap = ready ? robot.subscribeStreams(['map']) : null
  },
  { immediate: true },
)
onBeforeUnmount(() => offMap?.())
// Режим TEACH_IN — картографируем (в том числе пока SLAM останавливается после «Завершить»).
const inMapping = computed(() => status.value?.mode === 'TEACH_IN')
const switching = computed(() => status.value?.state === 'switching')
const switchingToMapping = computed(() => switching.value && status.value?.transition?.to === 'TEACH_IN')
const canStart = computed(() => robot.online && status.value?.mode === 'SERVICE' && !switching.value)
const mapping = computed(() => status.value?.mapping)
const unsaved = computed(() => !!mapping.value?.unsavedChanges)

// ---------- Старт ----------

const maps = ref([])
const continueId = ref(route.query.continue || null) // «Продолжить» из библиотеки карт
const canContinue = computed(() => robot.capabilities.has('continue_mapping'))
const continueOptions = computed(() =>
  maps.value.filter((m) => m.hasPosegraph).map((m) => ({ label: m.name, value: m.id })),
)

async function loadMaps() {
  try {
    maps.value = await listMaps()
  } catch (_) {
    maps.value = []
  }
}
watch(
  () => robot.online && !inMapping.value,
  (need) => need && loadMaps(),
  { immediate: true },
)

const starting = ref(false)
async function start(continueFrom = null) {
  starting.value = true
  try {
    await setOperatingMode('TEACH_IN', continueFrom || '')
  } catch (e) {
    message.error(errorText(e))
  } finally {
    starting.value = false
  }
}

// ---------- Пауза ----------

const pausing = ref(false)
async function togglePause() {
  pausing.value = true
  try {
    await setMappingPaused(!mapping.value?.paused)
  } catch (e) {
    message.error(errorText(e))
  } finally {
    pausing.value = false
  }
}

// ---------- Сохранение ----------

const saveOpen = ref(false)
const saveName = ref('')
const saving = ref(false)
const nameTaken = ref(false) // карта с таким именем есть — спрашиваем про перезапись
let exitAfterSave = false
const nameInput = ref(null)

function defaultName() {
  if (status.value?.map?.name) return status.value.map.name
  const now = new Date()
  return t('mapping.defaultName', {
    date: now.toLocaleDateString(locale.value),
    time: now.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false }),
  })
}

function openSave(exit = false) {
  exitAfterSave = exit
  saveName.value = defaultName()
  nameTaken.value = false
  saveOpen.value = true
  nextTick(() => nameInput.value?.select())
}

const nameError = computed(() => {
  const n = saveName.value.trim()
  if (!n) return t('mapping.nameRequired')
  if (n.length > 64) return t('mapping.nameTooLong')
  return null
})

async function save(overwrite = false) {
  if (nameError.value) return
  const name = saveName.value.trim()
  // Пересохранение текущей карты под тем же именем — перезапись без лишнего вопроса.
  const sameAsCurrent = status.value?.map?.name === name
  saving.value = true
  try {
    await saveMapping(name, overwrite || sameAsCurrent)
    saveOpen.value = false
    message.success(t('mapping.saved', { name }))
    if (exitAfterSave) await finish(true)
  } catch (e) {
    if (e.code === 'CONFLICT') nameTaken.value = true
    else message.error(errorText(e))
  } finally {
    saving.value = false
  }
}

watch(saveName, () => (nameTaken.value = false))

// ---------- Завершение ----------

const finishOpen = ref(false)
const finishing = ref(false)

function askFinish() {
  if (unsaved.value) finishOpen.value = true
  else finish(true)
}

async function finish(confirmed) {
  if (!confirmed) return
  finishOpen.value = false
  finishing.value = true
  try {
    await setOperatingMode('SERVICE')
  } catch (e) {
    message.error(errorText(e))
  } finally {
    finishing.value = false
  }
}

function saveAndFinish() {
  finishOpen.value = false
  openSave(true)
}

// ---------- Вид ----------

const follow = ref(true)
const sizeText = computed(() => {
  const m = robot.liveMap
  if (!m) return '—'
  return `${(m.width * m.resolution).toFixed(1)} × ${(m.height * m.resolution).toFixed(1)} m`
})
</script>

<template>
  <!-- Не картографируем: старт -->
  <div v-if="!inMapping" class="mx-auto grid max-w-3xl gap-4 pt-2">
    <section class="panel-card">
      <h2 class="panel-title">{{ t('mapping.newTitle') }}</h2>
      <p class="mb-4 text-sm text-slate-600 dark:text-slate-300">{{ t('mapping.newText') }}</p>

      <div v-if="switchingToMapping" class="flex items-center gap-3 text-sm text-amber-700 dark:text-amber-400">
        <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500"></span>
        {{ t('mapping.starting') }}
        <span v-if="status?.transition?.stack" class="font-mono text-xs">{{ status.transition.stack }}</span>
      </div>
      <template v-else>
        <NButton
          type="primary"
          size="large"
          :loading="starting"
          :disabled="!canStart"
          @click="start()"
        >
          {{ t('mapping.start') }}
        </NButton>
        <p v-if="robot.online && status && status.mode !== 'SERVICE' && !switching" class="mt-3 text-xs text-slate-500 dark:text-slate-400">
          {{ t('mapping.needService', { mode: t(`mode.${status.mode}`) }) }}
        </p>
      </template>
    </section>

    <section v-if="canContinue" class="panel-card">
      <h2 class="panel-title">{{ t('mapping.continueTitle') }}</h2>
      <p class="mb-4 text-sm text-slate-600 dark:text-slate-300">{{ t('mapping.continueText') }}</p>
      <div v-if="continueOptions.length" class="flex flex-wrap gap-3">
        <NSelect
          v-model:value="continueId"
          :options="continueOptions"
          :placeholder="t('mapping.chooseMap')"
          size="large"
          class="min-w-64 flex-1"
        />
        <NButton
          size="large"
          :loading="starting"
          :disabled="!continueId || !canStart"
          @click="start(continueId)"
        >
          {{ t('mapping.continue') }}
        </NButton>
      </div>
      <div v-else class="text-sm text-slate-400">{{ t('mapping.noMaps') }}</div>
    </section>

    <section class="panel-card">
      <h2 class="panel-title">{{ t('mapping.tipsTitle') }}</h2>
      <ul class="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
        <li>{{ t('mapping.tip1') }}</li>
        <li>{{ t('mapping.tip2') }}</li>
        <li>{{ t('mapping.tip3') }}</li>
        <li>{{ t('mapping.tip4') }}</li>
      </ul>
    </section>
  </div>

  <!-- Картографируем -->
  <div v-else class="flex h-full min-h-0 flex-col gap-4 lg:flex-row">
    <div
      class="relative min-h-[360px] flex-1 overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
    >
      <MapCanvas
        v-model:follow="follow"
        :pose="robot.pose"
        :robot-radius="robot.info?.robotRadius ?? undefined"
        :scan="robot.scan"
        :map="robot.liveMap"
      />
      <div
        class="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded bg-white/90 px-2.5 py-1.5 text-xs font-semibold dark:bg-slate-900/90"
      >
        <template v-if="mapping?.paused">
          <span class="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500"></span>
          <span class="text-amber-700 dark:text-amber-400">{{ t('mapping.paused') }}</span>
        </template>
        <template v-else>
          <span class="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-500"></span>
          <span class="text-red-700 dark:text-red-400">{{ t('mapping.recording') }}</span>
        </template>
      </div>
    </div>

    <div class="flex w-full shrink-0 flex-col gap-4 overflow-y-auto lg:w-80">
      <section class="panel-card">
        <h2 class="panel-title">{{ t('nav.mapping') }}</h2>
        <dl class="mb-4 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt class="text-slate-500 dark:text-slate-400">{{ t('mapping.map') }}</dt>
          <dd class="truncate text-right font-medium">{{ status?.map?.name || t('mapping.newMap') }}</dd>
          <dt class="text-slate-500 dark:text-slate-400">{{ t('mapping.size') }}</dt>
          <dd class="text-right font-mono text-xs leading-5">{{ sizeText }}</dd>
          <dt class="text-slate-500 dark:text-slate-400">{{ t('mapping.changes') }}</dt>
          <dd class="text-right" :class="unsaved ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'">
            {{ unsaved ? t('mapping.unsaved') : t('mapping.allSaved') }}
          </dd>
        </dl>
        <div class="grid grid-cols-2 gap-2">
          <NButton size="large" :loading="pausing" :disabled="switching" @click="togglePause">
            {{ mapping?.paused ? t('mapping.resume') : t('mapping.pause') }}
          </NButton>
          <NButton size="large" type="primary" :disabled="!robot.liveMap || switching" @click="openSave(false)">
            {{ t('mapping.save') }}
          </NButton>
          <NButton size="large" class="col-span-2" :loading="finishing || switching" @click="askFinish">
            {{ t('mapping.finish') }}
          </NButton>
        </div>
      </section>

      <ControlCard />
      <JoystickCard />
    </div>
  </div>

  <!-- Сохранение -->
  <NModal v-model:show="saveOpen" :mask-closable="!saving">
    <div class="w-[min(28rem,calc(100vw-2rem))] rounded-md border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <h3 class="mb-4 text-base font-semibold">{{ t('mapping.saveTitle') }}</h3>
      <label class="mb-1 block text-sm text-slate-500 dark:text-slate-400">{{ t('mapping.name') }}</label>
      <NInput
        ref="nameInput"
        v-model:value="saveName"
        size="large"
        :maxlength="64"
        :status="nameError ? 'error' : undefined"
        @keyup.enter="save(false)"
      />
      <div class="mt-1 min-h-5 text-xs text-red-600 dark:text-red-400">{{ saveName ? nameError : '' }}</div>
      <div
        v-if="nameTaken"
        class="mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      >
        {{ t('mapping.nameTaken') }}
      </div>
      <div class="mt-5 flex justify-end gap-2">
        <NButton :disabled="saving" @click="saveOpen = false">{{ t('common.cancel') }}</NButton>
        <NButton v-if="nameTaken" type="warning" :loading="saving" @click="save(true)">{{ t('mapping.overwrite') }}</NButton>
        <NButton v-else type="primary" :loading="saving" :disabled="!!nameError" @click="save(false)">
          {{ t('mapping.save') }}
        </NButton>
      </div>
    </div>
  </NModal>

  <!-- Выход с несохранёнными изменениями -->
  <NModal v-model:show="finishOpen">
    <div class="w-[min(30rem,calc(100vw-2rem))] rounded-md border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <h3 class="mb-2 text-base font-semibold">{{ t('mapping.unsavedTitle') }}</h3>
      <p class="text-sm text-slate-600 dark:text-slate-300">{{ t('mapping.unsavedText') }}</p>
      <div class="mt-5 flex flex-wrap justify-end gap-2">
        <NButton @click="finishOpen = false">{{ t('common.cancel') }}</NButton>
        <NButton type="error" ghost @click="finish(true)">{{ t('mapping.discard') }}</NButton>
        <NButton type="primary" @click="saveAndFinish">{{ t('mapping.saveAndFinish') }}</NButton>
      </div>
    </div>
  </NModal>
</template>
