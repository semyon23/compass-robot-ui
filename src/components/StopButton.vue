<script setup>
import { useI18n } from 'vue-i18n'
import { useMessage } from 'naive-ui'
import { stop } from '../api/robot'
import { errorText } from '../lib/errorText'

const { t } = useI18n()
const message = useMessage()

async function onStop() {
  try {
    await stop()
    message.warning(t('stop.done'))
  } catch (e) {
    message.error(errorText(e))
  }
}
</script>

<template>
  <button
    type="button"
    class="flex h-10 min-w-24 items-center justify-center gap-2 rounded-md bg-red-600 px-4 text-sm font-bold tracking-wider text-white shadow-sm transition select-none hover:bg-red-700 active:scale-95 active:bg-red-800"
    :title="t('stop.hint')"
    @click="onStop"
  >
    <span class="inline-block h-3 w-3 rounded-sm bg-white"></span>
    {{ t('stop.label') }}
  </button>
</template>
