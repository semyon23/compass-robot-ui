<script setup>
import { computed } from 'vue'
import { NDropdown } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRobotStore } from '../stores/robot'
import { MODE_COLORS } from '../lib/modes'
import { useFmsHandover } from '../composables/useFmsHandover'

/** Бейдж режима работы; по нажатию — смена режима (робот проверяет, можно ли). */
const { t, te } = useI18n()
const robot = useRobotStore()
const { change, takeOver } = useFmsHandover()

const mode = computed(() => robot.displayMode)
const color = computed(() => MODE_COLORS[mode.value] || MODE_COLORS.unknown)
const label = computed(() => (te(`mode.${mode.value}`) ? t(`mode.${mode.value}`) : mode.value))
// Из TEACH_IN выходят на экране «Картографирование» — там предупреждение о несохранённой карте.
const canSwitch = computed(
  () => robot.online && robot.status && !['STARTUP', 'switching', 'TEACH_IN'].includes(mode.value),
)

// Из AUTOMATIC — только «Перехватить»; INTERVENED выбирает он сам. TEACH_IN — с экрана «Картографирование».
const options = computed(() => {
  const current = robot.status?.mode
  if (current === 'AUTOMATIC') {
    return [{ key: 'takeOver', label: `${t('modeSwitch.takeOver')} — ${t('modeSwitch.hint_takeOver')}` }]
  }
  return ['AUTOMATIC', 'MANUAL', 'SERVICE']
    .filter((m) => m !== current)
    .map((m) => ({
      key: m,
      label:
        m === 'AUTOMATIC'
          ? `${t('modeSwitch.handOver')} — ${t('modeSwitch.hint_AUTOMATIC')}`
          : `${t(`mode.${m}`)} — ${t(`modeSwitch.hint_${m}`)}`,
    }))
})

const select = (key) => (key === 'takeOver' ? takeOver() : change(key))
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
