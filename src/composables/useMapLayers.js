import { useLocalStorage } from '@vueuse/core'

// Слои карты «Управления»: что показывать. Выбор запоминается в браузере.
// Тяжёлые слои (карты стоимости, частицы) по умолчанию выключены: на них подписываемся, только когда видны.
export const MAP_LAYERS = [
  'map', 'globalCostmap', 'localCostmap', 'scan', 'camera', 'particles', 'plan', 'localPlan', 'goals', 'fmsRoute', 'telemetry', 'video',
]

const layers = useLocalStorage(
  'compass.map.layers',
  {
    map: true, globalCostmap: false, localCostmap: false, scan: true, camera: true, particles: false,
    plan: true, localPlan: true, goals: true, fmsRoute: true, telemetry: true, video: false,
  },
  { mergeDefaults: true },
)

export function useMapLayers() {
  return layers
}
