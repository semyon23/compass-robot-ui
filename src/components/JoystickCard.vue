<script setup>
import { computed } from 'vue'
import { NSlider } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useLocalStorage } from '@vueuse/core'
import JoystickPad from './JoystickPad.vue'
import { useRobotStore } from '../stores/robot'
import { useTeleop } from '../composables/useTeleop'

/** Ручное управление: джойстик, клавиатура (WASD / стрелки, пробел — стоп), скорость. */

// Предельные скорости ручного управления при ползунке 100 %.
// TODO: брать из конфига робота (раздел motion), когда появится GET /api/config.
const TELEOP_MAX = { linear: 0.5, angular: 1.0 }

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

const limits = computed(() => ({
  linear: (TELEOP_MAX.linear * speedPercent.value) / 100,
  angular: (TELEOP_MAX.angular * speedPercent.value) / 100,
}))

const { joystick, command } = useTeleop({ enabled, limits })

defineExpose({ command })
</script>

<template>
  <section class="panel-card flex flex-col items-center">
    <JoystickPad :disabled="!enabled" :size="180" @change="joystick = $event" />
    <div class="mt-3 min-h-5 text-center text-xs text-slate-500 dark:text-slate-400">
      {{ blockReason || t('drive.keysHint') }}
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
