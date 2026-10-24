<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NDropdown, NInput, NModal, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { unzipSync, zipSync } from 'fflate'
import MapPreview from '../components/MapPreview.vue'
import { useRobotStore } from '../stores/robot'
import { deleteMap, fetchMapFile, importMap, listMaps, renameMap } from '../api/maps'
import { parsePgm } from '../lib/mapTint'
import { errorText } from '../lib/errorText'
import { saveBlob } from '../lib/download'

const { t, locale } = useI18n()
const message = useMessage()
const router = useRouter()
const robot = useRobotStore()

// ---------- Список ----------

const maps = ref([])
const loading = ref(false)
const loaded = ref(false)

async function load() {
  loading.value = true
  try {
    maps.value = await listMaps()
    loaded.value = true
  } catch (e) {
    message.error(errorText(e))
  } finally {
    loading.value = false
  }
}

watch(() => robot.online, (online) => online && load(), { immediate: true })
// Карту сохранили или удалили с другой вкладки (или на экране картографирования) — обновляем.
watch(
  () => robot.events[0],
  (ev) => ev && ['MAP_SAVED', 'MAP_DELETED', 'MAP_IMPORTED'].includes(ev.code) && load(),
)

const buildingId = computed(() => (robot.status?.mode === 'TEACH_IN' ? robot.status?.map?.id : null))
const canContinue = computed(() => robot.capabilities.has('continue_mapping'))

function sizeText(m) {
  return `${(m.width * m.resolution).toFixed(1)} × ${(m.height * m.resolution).toFixed(1)} ${t('maps.meters')}`
}
const megabytes = (bytes) => t('maps.mb', { n: (bytes / 1048576).toFixed(1) })
const dateText = (iso) =>
  new Date(iso).toLocaleString(locale.value, { dateStyle: 'medium', timeStyle: 'short', hour12: false })

// ---------- Имя: переименование и импорт ----------

const nameOpen = ref(false)
const nameMode = ref('rename') // rename | import
const nameValue = ref('')
const nameTaken = ref(false)
const nameBusy = ref(false)
const nameInput = ref(null)
let target = null // карта для rename или { files } для import

const nameError = computed(() => {
  const n = nameValue.value.trim()
  if (!n) return t('mapping.nameRequired')
  if (n.length > 64) return t('mapping.nameTooLong')
  return null
})
watch(nameValue, () => (nameTaken.value = false))

function openName(mode, initial, payload) {
  nameMode.value = mode
  nameValue.value = initial
  nameTaken.value = false
  target = payload
  nameOpen.value = true
  nextTick(() => nameInput.value?.select())
}

async function submitName() {
  if (nameError.value) return
  const name = nameValue.value.trim()
  nameBusy.value = true
  try {
    if (nameMode.value === 'rename') {
      await renameMap(target.id, name)
      message.success(t('maps.renamed', { name }))
    } else {
      await importMap(name, target.files)
      message.success(t('maps.imported', { name }))
    }
    nameOpen.value = false
    load()
  } catch (e) {
    if (e.code === 'CONFLICT') nameTaken.value = true
    else message.error(errorText(e))
  } finally {
    nameBusy.value = false
  }
}

// ---------- Удаление ----------

const deleteTarget = ref(null)
const deleting = ref(false)

async function confirmDelete() {
  deleting.value = true
  try {
    await deleteMap(deleteTarget.value.id)
    message.success(t('maps.deleted', { name: deleteTarget.value.name }))
    deleteTarget.value = null
    load()
  } catch (e) {
    message.error(errorText(e))
  } finally {
    deleting.value = false
  }
}

// ---------- Экспорт: zip собираем в браузере ----------

const exportingId = ref(null)

async function exportMap(m) {
  exportingId.value = m.id
  try {
    const names = ['map.yaml', 'map.pgm', ...(m.hasPosegraph ? ['map.posegraph', 'map.data'] : [])]
    const files = {}
    for (const name of names) files[name] = await fetchMapFile(m.id, name, m.updatedAt)
    saveBlob(`${m.name}.zip`, new Blob([zipSync(files)], { type: 'application/zip' }))
  } catch (e) {
    message.error(errorText(e))
  } finally {
    exportingId.value = null
  }
}

// ---------- Импорт: .zip из экспорта или отдельные файлы карты ----------

const fileInput = ref(null)
const FILE_KEYS = { yaml: 'map.yaml', yml: 'map.yaml', pgm: 'map.pgm', posegraph: 'map.posegraph', data: 'map.data' }

async function onFiles(event) {
  const list = Array.from(event.target.files || [])
  event.target.value = '' // тот же файл можно выбрать ещё раз
  if (!list.length) return

  const files = {}
  let baseName = ''
  const put = (fileName, data) => {
    const key = FILE_KEYS[fileName.toLowerCase().split('.').pop()]
    if (key && !files[key]) files[key] = data
  }
  try {
    for (const f of list) {
      const bytes = new Uint8Array(await f.arrayBuffer())
      if (/\.zip$/i.test(f.name)) {
        baseName ||= f.name.replace(/\.zip$/i, '')
        for (const [path, data] of Object.entries(unzipSync(bytes))) {
          if (!path.endsWith('/') && !path.startsWith('__MACOSX')) put(path.split('/').pop(), data)
        }
      } else {
        put(f.name, bytes)
        if (/\.ya?ml$/i.test(f.name)) baseName ||= f.name.replace(/\.ya?ml$/i, '')
      }
    }
  } catch (_) {
    return message.error(t('maps.importUnreadable'))
  }

  if (!files['map.yaml'] || !files['map.pgm']) return message.error(t('maps.importMissing'))
  try {
    parsePgm(files['map.pgm'])
  } catch (_) {
    return message.error(t('maps.importBadPgm'))
  }
  // posegraph без data (и наоборот) бесполезен
  if (!files['map.posegraph'] || !files['map.data']) {
    delete files['map.posegraph']
    delete files['map.data']
  }
  openName('import', baseName === 'map' ? '' : baseName, { files })
}

// ---------- Действия карточки ----------

function actions(m) {
  return [
    { key: 'rename', label: t('maps.rename') },
    { key: 'export', label: t('maps.export') },
    { key: 'delete', label: t('maps.delete'), disabled: m.id === buildingId.value },
  ]
}

function onAction(key, m) {
  if (key === 'rename') openName('rename', m.name, m)
  else if (key === 'export') exportMap(m)
  else if (key === 'delete') deleteTarget.value = m
}

const continueMapping = (m) => router.push({ path: '/mapping', query: { continue: m.id } })
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-lg font-semibold">{{ t('nav.maps') }}</h1>
      <span v-if="loaded" class="text-sm text-slate-500 dark:text-slate-400">{{ maps.length }}</span>
      <div class="ml-auto flex gap-2">
        <NButton :disabled="!robot.online" @click="fileInput?.click()">{{ t('maps.import') }}</NButton>
        <NButton type="primary" @click="router.push('/mapping')">{{ t('maps.newMap') }}</NButton>
      </div>
      <input
        ref="fileInput"
        type="file"
        multiple
        accept=".zip,.yaml,.yml,.pgm,.posegraph,.data"
        class="hidden"
        @change="onFiles"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="loaded && !maps.length" class="panel-card mx-auto mt-8 max-w-md text-center">
        <div class="mb-2 font-mono text-3xl text-slate-300 dark:text-slate-700">▤</div>
        <p class="text-sm text-slate-600 dark:text-slate-300">{{ t('maps.empty') }}</p>
      </div>

      <div v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <article
          v-for="m in maps"
          :key="m.id"
          class="flex flex-col overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
        >
          <div class="relative aspect-[4/3] border-b border-slate-200 dark:border-slate-800">
            <MapPreview :map-id="m.id" :version="m.updatedAt" />
            <span
              v-if="m.id === buildingId"
              class="absolute top-2 left-2 flex items-center gap-1.5 rounded bg-white/90 px-2 py-1 text-xs font-semibold text-violet-700 dark:bg-slate-900/90 dark:text-violet-300"
            >
              <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-violet-600"></span>
              {{ t('maps.building') }}
            </span>
          </div>
          <div class="flex flex-1 flex-col gap-2 p-4">
            <div class="flex items-start gap-2">
              <h2 class="min-w-0 flex-1 truncate font-medium" :title="m.name">{{ m.name }}</h2>
              <span
                v-if="m.hasPosegraph"
                class="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400"
                :title="t('maps.posegraphHint')"
              >
                posegraph
              </span>
            </div>
            <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              <dt class="text-slate-500 dark:text-slate-400">{{ t('mapping.size') }}</dt>
              <dd class="text-right font-mono text-xs leading-5">{{ sizeText(m) }}</dd>
              <dt class="text-slate-500 dark:text-slate-400">{{ t('maps.resolution') }}</dt>
              <dd class="text-right font-mono text-xs leading-5">{{ m.resolution.toFixed(2) }} {{ t('maps.perCell') }}</dd>
              <dt class="text-slate-500 dark:text-slate-400">{{ t('maps.updated') }}</dt>
              <dd class="text-right">{{ dateText(m.updatedAt) }}</dd>
              <dt class="text-slate-500 dark:text-slate-400">{{ t('maps.files') }}</dt>
              <dd class="text-right">{{ megabytes(m.sizeBytes) }}</dd>
            </dl>
            <div class="mt-auto flex gap-2 pt-2">
              <NButton
                v-if="canContinue && m.hasPosegraph"
                class="flex-1"
                :disabled="!!buildingId"
                @click="continueMapping(m)"
              >
                {{ t('maps.continue') }}
              </NButton>
              <div v-else class="flex-1"></div>
              <NDropdown trigger="click" :options="actions(m)" @select="(key) => onAction(key, m)">
                <NButton :loading="exportingId === m.id" :aria-label="t('maps.actions')">⋯</NButton>
              </NDropdown>
            </div>
          </div>
        </article>
      </div>
    </div>
  </div>

  <!-- Переименование / импорт -->
  <NModal v-model:show="nameOpen" :mask-closable="!nameBusy">
    <div class="w-[min(28rem,calc(100vw-2rem))] rounded-md border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <h3 class="mb-4 text-base font-semibold">
        {{ nameMode === 'rename' ? t('maps.renameTitle') : t('maps.importTitle') }}
      </h3>
      <label class="mb-1 block text-sm text-slate-500 dark:text-slate-400">{{ t('mapping.name') }}</label>
      <NInput
        ref="nameInput"
        v-model:value="nameValue"
        size="large"
        :maxlength="64"
        :status="nameValue && nameError ? 'error' : undefined"
        @keyup.enter="submitName"
      />
      <div class="mt-1 min-h-5 text-xs text-red-600 dark:text-red-400">
        {{ nameTaken ? t('maps.nameTaken') : nameValue ? nameError : '' }}
      </div>
      <p v-if="nameMode === 'import'" class="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {{ target?.files?.['map.posegraph'] ? t('maps.importWithPosegraph') : t('maps.importNoPosegraph') }}
      </p>
      <div class="mt-5 flex justify-end gap-2">
        <NButton :disabled="nameBusy" @click="nameOpen = false">{{ t('common.cancel') }}</NButton>
        <NButton type="primary" :loading="nameBusy" :disabled="!!nameError" @click="submitName">
          {{ nameMode === 'rename' ? t('maps.rename') : t('maps.import') }}
        </NButton>
      </div>
    </div>
  </NModal>

  <!-- Удаление -->
  <NModal :show="!!deleteTarget" :mask-closable="!deleting" @update:show="(v) => !v && (deleteTarget = null)">
    <div class="w-[min(28rem,calc(100vw-2rem))] rounded-md border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
      <h3 class="mb-2 text-base font-semibold">{{ t('maps.deleteTitle') }}</h3>
      <p class="text-sm text-slate-600 dark:text-slate-300">{{ t('maps.deleteText', { name: deleteTarget?.name }) }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <NButton :disabled="deleting" @click="deleteTarget = null">{{ t('common.cancel') }}</NButton>
        <NButton type="error" :loading="deleting" @click="confirmDelete">{{ t('maps.delete') }}</NButton>
      </div>
    </div>
  </NModal>
</template>
