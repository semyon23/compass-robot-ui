import { computed, ref } from 'vue'
import { DEFAULT_ROBOT_KIND, ROBOT_KINDS } from '../lib/robotShapes'

// Внешний вид робота на карте — настройка интерфейса этого браузера (как тема и язык).
const KEY = 'compass.robotKind'

function load() {
  try {
    const saved = localStorage.getItem(KEY)
    if (ROBOT_KINDS.includes(saved)) return saved
  } catch (_) {}
  return DEFAULT_ROBOT_KIND
}

const kind = ref(load())

export function useRobotLook() {
  return {
    kind: computed(() => kind.value),
    setKind(k) {
      if (!ROBOT_KINDS.includes(k)) return
      kind.value = k
      try {
        localStorage.setItem(KEY, k)
      } catch (_) {}
    },
  }
}
