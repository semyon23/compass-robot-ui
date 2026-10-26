<script setup>
import { watch } from 'vue'
import { useMessage } from 'naive-ui'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useRobotStore } from '../stores/robot'

/**
 * Цель или маршрут Compass завершились, а оператор не на «Управлении» (там итог — в строке
 * движения над картой) — сообщение внизу экрана. Только новые события, не история.
 */
const { t, te } = useI18n()
const message = useMessage()
const route = useRoute()
const robot = useRobotStore()

const KINDS = {
  NAV_GOAL_SUCCEEDED: 'success',
  NAV_WAYPOINTS_MISSED: 'warning',
  NAV_GOAL_FAILED: 'error',
  NAV_GOAL_CANCELED: 'info',
}

watch(
  () => robot.events[0]?.id,
  (id, prev) => {
    const ev = robot.events[0]
    const fresh = ev && Date.now() - Date.parse(ev.time) < 10000
    if (!prev || !fresh || !KINDS[ev.code] || route.path === '/drive') return
    const text = te(`events.${ev.code}`) ? t(`events.${ev.code}`, ev.details) : ev.message
    message[KINDS[ev.code]](text, { duration: ev.code === 'NAV_GOAL_SUCCEEDED' ? 4000 : 8000, closable: true })
  },
)
</script>

<template>
  <span class="hidden"></span>
</template>
