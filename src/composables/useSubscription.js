import { onMounted, onBeforeUnmount } from 'vue'
import { useRobotStore } from '../stores/robot'

/** Подписка экрана на потоки робота (pose, scan, …) на время, пока экран открыт. */
export function useSubscription(names) {
  const robot = useRobotStore()
  let unsubscribe = null
  onMounted(() => {
    unsubscribe = robot.subscribeStreams(names)
  })
  onBeforeUnmount(() => unsubscribe?.())
}
