<script setup>
import { NButton, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRobotStore } from '../stores/robot'
import { errorText } from '../lib/errorText'

/** «Вы управляете» в верхней панели: управление держится на всех экранах, отдать — отсюда. */
const { t } = useI18n()
const message = useMessage()
const robot = useRobotStore()

async function release() {
  try {
    await robot.releaseControl()
  } catch (e) {
    message.error(errorText(e))
  }
}
</script>

<template>
  <div
    v-if="robot.controlOwner === 'me'"
    class="flex h-8 items-center gap-2 rounded-md border border-emerald-600/40 bg-emerald-50 pr-1 pl-2.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
  >
    <span class="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
    <span class="hidden md:inline">{{ t('control.me') }}</span>
    <NButton quaternary size="tiny" :title="t('drive.release')" @click="release">✕</NButton>
  </div>
</template>
