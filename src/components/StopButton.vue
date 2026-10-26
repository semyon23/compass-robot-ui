<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NPopconfirm, useMessage } from 'naive-ui'
import { releaseStop, stop } from '../api/robot'
import { useRobotStore } from '../stores/robot'
import { errorText } from '../lib/errorText'

/**
 * СТОП: робот встаёт, задачи отменяются, twist_mux блокирует и джойстик, и Nav2.
 * Пока СТОП нажат (status.estop), кнопка жёлтая и мигает; нажатие снимает СТОП — с подтверждением.
 */
const { t } = useI18n()
const message = useMessage()
const robot = useRobotStore()
const stopped = computed(() => !!robot.status?.estop)
const busy = ref(false)

async function run(action, done) {
  busy.value = true
  try {
    await action()
    message.warning(t(done))
  } catch (e) {
    message.error(errorText(e))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <NPopconfirm
    v-if="stopped"
    :positive-text="t('stop.release')"
    :negative-text="t('common.cancel')"
    @positive-click="run(releaseStop, 'stop.released')"
  >
    <template #trigger>
      <button
        type="button"
        class="flex h-10 min-w-24 animate-pulse items-center justify-center gap-2 rounded-md border-2 border-red-600 bg-amber-400 px-4 text-sm font-bold tracking-wider text-red-800 shadow-sm transition select-none hover:bg-amber-300"
        :title="t('stop.releaseHint')"
        :disabled="busy"
      >
        <span class="inline-block h-3 w-3 rounded-sm bg-red-700"></span>
        {{ t('stop.label') }}
      </button>
    </template>
    {{ t('stop.releaseConfirm') }}
  </NPopconfirm>
  <button
    v-else
    type="button"
    class="flex h-10 min-w-24 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-bold tracking-wider text-white shadow-sm transition select-none hover:bg-red-700 active:scale-95 active:bg-red-800"
    :title="t('stop.hint')"
    :disabled="busy"
    @click="run(stop, 'stop.done')"
  >
    <span class="inline-block h-3 w-3 rounded-sm bg-white"></span>
    {{ t('stop.label') }}
  </button>
</template>
