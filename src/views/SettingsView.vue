<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NCard, NTabs, NTabPane, NRadioGroup, NRadioButton } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useTheme } from '../composables/useTheme'
import { useRobotStore } from '../stores/robot'
import { LOCALES, setLocale } from '../locales'
import { useRobotLook } from '../composables/useRobotLook'
import { ROBOT_KINDS } from '../lib/robotShapes'
import { SCHEMES } from '../lib/schemes'
import RobotIcon from '../components/RobotIcon.vue'
import { MAP_COLORS } from '../lib/mapColors'
import RobotSettings from '../components/RobotSettings.vue'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const theme = useTheme()
const robot = useRobotStore()
const robotLook = useRobotLook()

// Робот в превью — тем же цветом, что на карте.
const robotColor = computed(() => (theme.isDark.value ? MAP_COLORS.dark : MAP_COLORS.light).robot)
const SWATCH_STEPS = [200, 400, 600, 800, 950]

const tileClass = (active) => [
  'flex flex-col items-center gap-2 rounded-md border p-3 text-sm transition',
  active
    ? 'border-brand-700 bg-brand-50 text-brand-900 dark:border-brand-400 dark:bg-brand-950 dark:text-brand-200'
    : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600',
]

// Вкладка хранится в URL (/settings/robot, /settings/interface) — ссылки и F5 работают.
const tab = computed({
  get: () => route.params.tab,
  set: (v) => router.replace(`/settings/${v}`),
})

const LOCALE_NAMES = { ru: 'Русский', en: 'English' }

const infoRows = computed(() => {
  const i = robot.info
  if (!i) return []
  return [
    [t('settings.robotName'), i.robotName],
    [t('settings.serialNumber'), i.serialNumber],
    [t('settings.manufacturer'), i.manufacturer],
    [t('settings.model'), i.model],
  ]
})
</script>

<template>
  <div class="max-w-4xl">
    <NTabs v-model:value="tab" type="line" animated>
      <!-- Робот: сведения и (позже) параметры по схеме из GET /api/config/schema -->
      <NTabPane name="robot" :tab="t('settings.tabRobot')">
        <div class="grid grid-cols-1 gap-4 pt-2">
          <NCard size="small" :title="t('settings.robotInfo')" class="!bg-white dark:!bg-slate-900">
            <dl v-if="robot.info" class="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2 text-sm">
              <template v-for="[label, value] in infoRows" :key="label">
                <dt class="text-slate-500 dark:text-slate-400">{{ label }}</dt>
                <dd class="font-medium">{{ value || '—' }}</dd>
              </template>
              <dt class="text-slate-500 dark:text-slate-400">{{ t('settings.versions') }}</dt>
              <dd class="font-mono text-xs leading-6">
                <span v-for="(v, k) in robot.info.versions" :key="k" class="mr-4">{{ k }} {{ v }}</span>
              </dd>
            </dl>
            <div v-else class="text-sm text-slate-400">{{ t('settings.noInfo') }}</div>
          </NCard>

          <RobotSettings />
        </div>
      </NTabPane>

      <!-- Интерфейс: хранится в браузере этого устройства -->
      <NTabPane name="interface" :tab="t('settings.tabInterface')">
        <div class="grid grid-cols-1 gap-4 pt-2">
          <NCard size="small" :title="t('settings.language')" class="!bg-white dark:!bg-slate-900">
            <NRadioGroup :value="locale" @update:value="setLocale">
              <NRadioButton v-for="l in LOCALES" :key="l.value" :value="l.value">
                {{ LOCALE_NAMES[l.value] }}
              </NRadioButton>
            </NRadioGroup>
          </NCard>
          <NCard size="small" :title="t('settings.theme')" class="!bg-white dark:!bg-slate-900">
            <NRadioGroup :value="theme.mode.value" @update:value="theme.setMode">
              <NRadioButton value="light">{{ t('settings.themeLight') }}</NRadioButton>
              <NRadioButton value="dark">{{ t('settings.themeDark') }}</NRadioButton>
              <NRadioButton value="system">{{ t('settings.themeSystem') }}</NRadioButton>
            </NRadioGroup>
          </NCard>
          <NCard size="small" :title="t('settings.scheme')" class="!bg-white dark:!bg-slate-900">
            <div class="flex flex-wrap gap-3">
              <button
                v-for="(colors, name) in SCHEMES"
                :key="name"
                type="button"
                :class="[tileClass(theme.scheme.value === name), 'w-40']"
                :aria-pressed="theme.scheme.value === name"
                @click="theme.setScheme(name)"
              >
                <span class="flex h-6 w-full overflow-hidden rounded">
                  <span v-for="step in SWATCH_STEPS" :key="step" class="flex-1" :style="{ backgroundColor: colors[step] }"></span>
                </span>
                {{ t(`settings.scheme_${name}`) }}
              </button>
            </div>
          </NCard>
          <NCard size="small" :title="t('settings.robotLook')" class="!bg-white dark:!bg-slate-900">
            <p class="mb-3 text-sm text-slate-500 dark:text-slate-400">{{ t('settings.robotLookHint') }}</p>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <button
                v-for="kind in ROBOT_KINDS"
                :key="kind"
                type="button"
                :class="tileClass(robotLook.kind.value === kind)"
                :aria-pressed="robotLook.kind.value === kind"
                @click="robotLook.setKind(kind)"
              >
                <RobotIcon :kind="kind" :color="robotColor" />
                <span class="text-center leading-tight">{{ t(`settings.robotKind_${kind}`) }}</span>
              </button>
            </div>
          </NCard>
        </div>
      </NTabPane>
    </NTabs>
  </div>
</template>
