<script setup>
import { computed } from 'vue'
import { NRadioButton, NRadioGroup, NSlider } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useLocalStorage } from '@vueuse/core'
import JoystickPad from './JoystickPad.vue'
import { useRobotStore } from '../stores/robot'
import { useTeleop } from '../composables/useTeleop'

/**
 * Ручное управление: джойстик, клавиатура (WASD / стрелки, пробел — стоп), скорость.
 * У робота, который ездит боком (capability holonomic): Q/E — вбок, переключатель джойстика
 * «поворот / вбок».
 */

// Предельные скорости при ползунке 100 % — из настроек робота (motion.*); пока не загрузились —
// осторожные значения по умолчанию (робот всё равно обрежет по своим лимитам).
const FALLBACK_MAX = { linear: 0.5, angular: 1.0 }

const { t } = useI18n()
const robot = useRobotStore()

const speedPercent = useLocalStorage('compass.driveSpeed', 50)
const status = computed(() => robot.status)

// Почему ехать нельзя (null — можно).
const blockReason = computed(() => {
  if (!robot.online || !status.value) return t('drive.blockOffline')
  if (status.value.estop) return t('drive.blockEstop')
  if (status.value.state === 'switching') return t('drive.blockSwitching')
  if (robot.controlOwner !== 'me') return t('drive.blockNoControl')
  return null
})
const enabled = computed(() => blockReason.value === null)

const limits = computed(() => {
  const max = robot.motionLimits || FALLBACK_MAX
  return {
    linear: (max.linear * speedPercent.value) / 100,
    angular: (max.angular * speedPercent.value) / 100,
  }
})

const holonomic = computed(() => robot.capabilities.has('holonomic'))
const strafe = useLocalStorage('compass.joystickStrafe', false)

const { joystick, command } = useTeleop({ enabled, limits, holonomic, strafe })

defineExpose({ command })
</script>

<template>
  <section class="panel-card flex flex-col items-center">
    <NRadioGroup v-if="holonomic" v-model:value="strafe" size="small" class="mb-3">
      <NRadioButton :value="false">{{ t('drive.modeTurn') }}</NRadioButton>
      <NRadioButton :value="true">{{ t('drive.modeStrafe') }}</NRadioButton>
    </NRadioGroup>
    <JoystickPad :disabled="!enabled" :size="180" @change="joystick = $event" />
    <div class="mt-3 min-h-5 text-center text-xs text-slate-500 dark:text-slate-400">
      {{ blockReason || (holonomic ? t('drive.keysHintHolonomic') : t('drive.keysHint')) }}
    </div>
    <div class="mt-4 w-full">
      <div class="mb-1 flex items-baseline justify-between text-sm">
        <span class="text-slate-500 dark:text-slate-400">{{ t('drive.speed') }}</span>
        <span class="font-mono text-xs">{{ speedPercent }}% · {{ limits.linear.toFixed(2) }} m/s</span>
      </div>
      <NSlider v-model:value="speedPercent" :min="10" :max="100" :step="5" :tooltip="false" />
    </div>
  </section>
</template>
