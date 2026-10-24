<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { NButton, NCard, NInput, NInputNumber, NPopconfirm, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import * as ros from '../api/rosbridge'
import { applyConfig, getConfig, getHistory, getSchema, rollbackConfig } from '../api/config'
import { useRobotStore } from '../stores/robot'
import { errorText } from '../lib/errorText'

/**
 * «Настройки → Робот»: формы по схеме робота, применение с комментарием, история и откат.
 * Правки держим отдельно от значений робота (edited) — пришли новые значения, правки не теряются.
 */
const { t, te, locale } = useI18n()
const message = useMessage()
const robot = useRobotStore()

const schema = ref(null)
const version = ref(0)
const values = ref({})
const history = ref([])
const edited = ref({}) // ключ → значение, которое ввёл оператор
const fieldErrors = ref({}) // ключ → { code, message, min, max } от робота
const comment = ref('')
const applying = ref(false)

const tr = (obj) => (obj ? obj[locale.value] || obj.en || obj.ru || '' : '')
const fields = computed(() => Object.fromEntries((schema.value?.sections || []).flatMap((s) => s.fields.map((f) => [f.key, f]))))

async function load() {
  try {
    if (!schema.value) schema.value = await getSchema()
    const cfg = await getConfig()
    version.value = cfg.version
    values.value = cfg.values
    history.value = await getHistory()
  } catch (e) {
    message.error(errorText(e))
  }
}

// Применили с другой вкладки или устройства — подтягиваем новые значения и историю.
let off = null
onMounted(() => {
  off = ros.subscribe('/compass/config/changed', 'robot_interfaces/msg/ConfigChanged', (msg) => {
    if (msg.version !== version.value) load()
  })
})
onBeforeUnmount(() => off?.())
watch(() => robot.online, (online) => online && load(), { immediate: true })

// ---------- Правки ----------

const valueOf = (key) => (key in edited.value ? edited.value[key] : values.value[key])
function setValue(key, v) {
  edited.value = { ...edited.value, [key]: v }
  const { [key]: _, ...rest } = fieldErrors.value
  fieldErrors.value = rest
}
const dirtyKeys = computed(() => Object.keys(edited.value).filter((k) => edited.value[k] !== values.value[k]))
const isDirty = (key) => dirtyKeys.value.includes(key)

function reset() {
  edited.value = {}
  fieldErrors.value = {}
  comment.value = ''
}

function fieldError(key) {
  const e = fieldErrors.value[key]
  if (!e) return ''
  return te(`settings.cfgErr_${e.code}`) ? t(`settings.cfgErr_${e.code}`, e) : e.message
}

async function apply() {
  applying.value = true
  try {
    const changes = Object.fromEntries(dirtyKeys.value.map((k) => [k, edited.value[k]]))
    const res = await applyConfig(version.value, changes, comment.value.trim())
    message.success(t('settings.applied', { v: res.version }))
    reset()
    await load()
    robot.loadInfo() // имя робота в шапке
  } catch (e) {
    if (e.code === 'INVALID_INPUT' && e.details) fieldErrors.value = e.details
    else if (e.code === 'CONFLICT') {
      message.warning(t('settings.conflict'))
      await load()
    } else message.error(errorText(e))
  } finally {
    applying.value = false
  }
}

// ---------- История ----------

const timeText = (ms) => new Date(ms).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short', hour12: false })
const labelOf = (key) => tr(fields.value[key]?.label) || key
const valueText = (key, v) => (v === '' ? '—' : `${v}${fields.value[key]?.unit ? ` ${fields.value[key].unit}` : ''}`)

async function rollback(v) {
  try {
    const res = await rollbackConfig(v)
    message.success(t('settings.rolledBack', { v, nv: res.version }))
    reset()
    await load()
    robot.loadInfo()
  } catch (e) {
    message.error(errorText(e))
  }
}
</script>

<template>
  <div v-if="schema" class="grid grid-cols-1 gap-4">
    <NCard
      v-for="section in schema.sections"
      :key="section.id"
      size="small"
      :title="tr(section.title)"
      class="!bg-white dark:!bg-slate-900"
    >
      <div class="grid grid-cols-1 gap-x-6 gap-y-4 md:grid-cols-2">
        <label v-for="f in section.fields" :key="f.key" class="flex flex-col gap-1">
          <span class="flex items-center gap-2 text-sm font-medium">
            {{ tr(f.label) }}
            <span v-if="isDirty(f.key)" class="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" :title="t('settings.changed')"></span>
          </span>
          <NInput
            v-if="f.type === 'string'"
            :value="valueOf(f.key)"
            :maxlength="f.maxLength"
            :status="fieldErrors[f.key] ? 'error' : undefined"
            @update:value="(v) => setValue(f.key, v)"
          />
          <NInputNumber
            v-else
            :value="valueOf(f.key)"
            :min="f.min"
            :max="f.max"
            :step="f.step || 1"
            :precision="f.type === 'integer' ? 0 : undefined"
            :status="fieldErrors[f.key] ? 'error' : undefined"
            @update:value="(v) => setValue(f.key, v)"
          >
            <template v-if="f.unit" #suffix>{{ f.unit }}</template>
          </NInputNumber>
          <span v-if="fieldErrors[f.key]" class="text-xs text-red-600 dark:text-red-400">{{ fieldError(f.key) }}</span>
          <span v-else-if="f.help" class="text-xs text-slate-500 dark:text-slate-400">{{ tr(f.help) }}</span>
        </label>
      </div>
    </NCard>

    <!-- Применить: видно, пока есть правки -->
    <div
      v-if="dirtyKeys.length"
      class="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 shadow dark:border-amber-800 dark:bg-amber-950"
    >
      <span class="text-sm text-amber-800 dark:text-amber-200">{{ t('settings.dirty', { n: dirtyKeys.length }) }}</span>
      <NInput v-model:value="comment" size="small" :maxlength="200" :placeholder="t('settings.comment')" class="min-w-48 flex-1" />
      <NButton size="small" :disabled="applying" @click="reset">{{ t('settings.reset') }}</NButton>
      <NButton size="small" type="primary" :loading="applying" :disabled="!robot.online" @click="apply">{{ t('settings.apply') }}</NButton>
    </div>

    <NCard size="small" :title="t('settings.history')" class="!bg-white dark:!bg-slate-900">
      <ul v-if="history.length" class="max-h-96 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
        <li v-for="h in history" :key="h.version" class="flex gap-3 py-2 text-sm">
          <span class="w-12 shrink-0 font-mono text-xs leading-5 text-slate-500">v{{ h.version }}</span>
          <div class="min-w-0 flex-1">
            <div class="text-xs text-slate-500 dark:text-slate-400">
              {{ timeText(h.createdAt) }} · {{ h.client || '—' }}<template v-if="h.comment"> · «{{ h.comment }}»</template>
            </div>
            <div v-for="c in h.changes" :key="c.key" class="truncate">
              {{ labelOf(c.key) }}: <span class="text-slate-500">{{ valueText(c.key, c.from) }}</span> → {{ valueText(c.key, c.to) }}
            </div>
            <div v-if="!h.changes.length" class="text-slate-500">{{ t('settings.initial') }}</div>
          </div>
          <span v-if="h.version === version" class="shrink-0 text-xs leading-5 font-semibold text-emerald-700 dark:text-emerald-400">
            {{ t('settings.current') }}
          </span>
          <NPopconfirm v-else :positive-text="t('settings.rollback')" :negative-text="t('common.cancel')" @positive-click="rollback(h.version)">
            <template #trigger>
              <NButton size="tiny" :disabled="!robot.online">{{ t('settings.rollback') }}</NButton>
            </template>
            {{ t('settings.rollbackConfirm', { v: h.version }) }}
          </NPopconfirm>
        </li>
      </ul>
      <div v-else class="text-sm text-slate-400">—</div>
    </NCard>
  </div>
  <div v-else class="text-sm text-slate-400">{{ t('settings.noInfo') }}</div>
</template>
