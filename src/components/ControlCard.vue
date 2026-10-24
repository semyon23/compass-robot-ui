<script setup>
import { computed, ref, onBeforeUnmount } from 'vue'
import { NButton, NPopconfirm, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRobotStore } from '../stores/robot'
import { errorText } from '../lib/errorText'

/**
 * Захват / отдача / перехват управления. При уходе с экрана управление отдаётся
 * (ручное движение останавливается, активная цель Nav2 продолжается — ROS_INTERFACES §3.2).
 */
const { t } = useI18n()
const message = useMessage()
const robot = useRobotStore()

const busy = ref(false)
const owner = computed(() => robot.controlOwner)
const status = computed(() => robot.status)

async function run(action) {
  busy.value = true
  try {
    await action()
  } catch (e) {
    message.error(errorText(e))
  } finally {
    busy.value = false
  }
}
const acquire = (force = false) => run(() => robot.acquireControl(force))
const release = () => run(() => robot.releaseControl())

onBeforeUnmount(() => {
  if (owner.value === 'me') robot.releaseControl().catch(() => {})
})
</script>

<template>
  <section class="panel-card">
    <h2 class="panel-title">{{ t('drive.control') }}</h2>
    <template v-if="owner === 'me'">
      <div class="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
        <span class="inline-block h-2 w-2 rounded-full bg-emerald-500"></span>
        {{ t('control.me') }}
      </div>
      <NButton block size="large" :loading="busy" @click="release">{{ t('drive.release') }}</NButton>
    </template>
    <template v-else-if="owner === 'other'">
      <div class="mb-3 text-sm text-amber-700 dark:text-amber-400">
        {{ t('control.other', { client: status?.control?.client || '—' }) }}
      </div>
      <NPopconfirm :positive-text="t('drive.takeOver')" :negative-text="t('common.cancel')" @positive-click="acquire(true)">
        <template #trigger>
          <NButton block size="large" type="warning" :loading="busy" :disabled="!robot.online">
            {{ t('drive.takeOver') }}
          </NButton>
        </template>
        {{ t('drive.takeOverConfirm') }}
      </NPopconfirm>
    </template>
    <template v-else>
      <div class="mb-3 text-sm text-slate-500 dark:text-slate-400">{{ t('drive.freeHint') }}</div>
      <NButton block size="large" type="primary" :loading="busy" :disabled="!robot.online" @click="acquire(false)">
        {{ t('drive.take') }}
      </NButton>
    </template>
  </section>
</template>
