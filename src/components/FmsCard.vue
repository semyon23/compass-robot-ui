<script setup>
import { computed } from 'vue'
import { NButton, NCard } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRobotStore } from '../stores/robot'
import { useFmsHandover } from '../composables/useFmsHandover'

/** Работа с fms: связь агента VDA 5050 с брокером, задание, ошибки; «Передать fms» / «Перехватить». */
const { t } = useI18n()
const robot = useRobotStore()
const { handOver, takeOver } = useFmsHandover()

const fms = computed(() => robot.fms)
const mode = computed(() => robot.status?.mode)
const ready = computed(() => robot.online && robot.status?.state === 'ready')

// Что сейчас с заданием fms.
const orderState = computed(() => {
  const f = fms.value
  if (!f?.orderActive) return null
  if (mode.value === 'INTERVENED') return 'intervened'
  if (f.paused) return 'paused'
  if (f.driving) return 'driving'
  if (f.waitingForUpdate) return 'waiting'
  return 'standing'
})
</script>

<template>
  <NCard size="small" :title="t('fms.title')" class="!bg-white dark:!bg-slate-900">
    <template #header-extra>
      <NButton v-if="mode === 'AUTOMATIC'" size="small" :disabled="!ready" @click="takeOver">
        {{ t('modeSwitch.takeOver') }}
      </NButton>
      <NButton
        v-else-if="fms && ['SERVICE', 'MANUAL', 'INTERVENED'].includes(mode)"
        size="small"
        type="primary"
        :disabled="!ready"
        @click="handOver"
      >
        {{ t('modeSwitch.handOver') }}
      </NButton>
    </template>

    <div v-if="!fms" class="text-sm text-slate-400">{{ t('fms.noAgent') }}</div>
    <div v-else class="space-y-2 text-sm">
      <div class="flex items-center gap-2">
        <span
          class="inline-block h-2 w-2 rounded-full"
          :class="fms.connection === 'ONLINE' ? 'bg-emerald-500' : 'bg-red-500'"
        ></span>
        {{ t(fms.connection === 'ONLINE' ? 'fms.online' : 'fms.offline') }}
      </div>

      <div v-if="fms.orderActive">
        <div>
          {{ t('fms.order') }} <span class="font-mono">{{ fms.orderId }}</span> ·
          <span :class="orderState === 'intervened' ? 'text-orange-600' : ''">{{ t(`fms.${orderState}`) }}</span>
        </div>
        <div class="text-slate-500 dark:text-slate-400">
          {{ t('fms.node') }}: <span class="font-mono">{{ fms.lastNodeId || '—' }}</span>
        </div>
      </div>
      <div v-else-if="fms.orderId" class="text-slate-500 dark:text-slate-400">
        {{ t('fms.lastOrder') }} <span class="font-mono">{{ fms.orderId }}</span> — {{ t('fms.finished') }}
      </div>
      <div v-else class="text-slate-500 dark:text-slate-400">{{ t('fms.noOrders') }}</div>

      <ul v-if="fms.errors.length" class="space-y-1">
        <li v-for="e in fms.errors" :key="e.code" class="text-red-600 dark:text-red-400">
          <span class="font-mono">{{ e.code }}</span><span v-if="e.message"> — {{ e.message }}</span>
        </li>
      </ul>
    </div>
  </NCard>
</template>
