<script setup>
import { computed } from 'vue'
import { NDropdown, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRobotStore } from '../stores/robot'
import { MODE_COLORS, SWITCHABLE_MODES } from '../lib/modes'
import { setOperatingMode } from '../api/robot'
import { errorText } from '../lib/errorText'

/** Бейдж режима работы; по нажатию — смена режима (робот проверяет, можно ли). */
const { t, te } = useI18n()
const message = useMessage()
const robot = useRobotStore()

const mode = computed(() => robot.displayMode)
const color = computed(() => MODE_COLORS[mode.value] || MODE_COLORS.unknown)
const label = computed(() => (te(`mode.${mode.value}`) ? t(`mode.${mode.value}`) : mode.value))
// Из TEACH_IN выходят на экране «Картографирование» — там предупреждение о несохранённой карте.
const canSwitch = computed(
  () => robot.online && robot.status && !['STARTUP', 'switching', 'TEACH_IN'].includes(mode.value),
)

const options = computed(() =>
  SWITCHABLE_MODES.filter((m) => m !== robot.status?.mode).map((m) => ({
    key: m,
    label: `${t(`mode.${m}`)} — ${t(`modeSwitch.hint_${m}`)}`,
  })),
)

async function select(target) {
  try {
    await setOperatingMode(target)
    message.success(t('modeSwitch.changed', { mode: t(`mode.${target}`) }))
  } catch (e) {
    message.error(errorText(e))
  }
}
</script>

<template>
  <NDropdown trigger="click" :options="options" :disabled="!canSwitch" @select="select">
    <button
      type="button"
      class="relative flex h-8 items-center gap-2 overflow-hidden rounded-md border px-3 text-xs font-semibold tracking-wide uppercase transition enabled:hover:bg-slate-50 disabled:cursor-default dark:enabled:hover:bg-slate-800"
      :style="{ borderColor: color, color }"
      :disabled="!canSwitch"
      :title="t('modeSwitch.title')"
    >
      <span
        class="inline-block h-2 w-2 rounded-full"
        :class="{ 'animate-pulse': mode === 'switching' }"
        :style="{ backgroundColor: color }"
      ></span>
      <span>{{ label }}</span>
      <span v-if="canSwitch" class="text-[10px] opacity-70">▾</span>
    </button>
  </NDropdown>
</template>
