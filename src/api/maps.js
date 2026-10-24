import { call } from './rosbridge'
import { ApiError } from './errors'

// Картографирование и библиотека карт (docs/ROS_INTERFACES.md §3, §5).
// Сервисы — через rosbridge, файлы карт — по HTTP (/files, nginx робота).

const SAVE_TIMEOUT_S = 30 // posegraph большой карты пишется долго

const isoOf = (t) => new Date((t?.sec ?? 0) * 1000).toISOString()

/** robot_interfaces/MapInfo → карта для экранов. */
function toMap(m) {
  return {
    id: m.id,
    name: m.name,
    width: m.width,
    height: m.height,
    resolution: m.resolution,
    origin: [m.origin.x, m.origin.y, m.origin.theta],
    hasPosegraph: m.has_posegraph,
    sizeBytes: m.size_bytes,
    createdAt: isoOf(m.created_at),
    updatedAt: isoOf(m.updated_at),
  }
}

export const listMaps = async () => (await call('/compass/maps/list')).maps.map(toMap)
export const renameMap = async (id, name) => toMap((await call('/compass/maps/rename', { id, name })).map)
export const deleteMap = (id) => call('/compass/maps/delete', { id })

export const saveMapping = async (name, overwrite = false) =>
  toMap((await call('/compass/mapping/save', { name, overwrite }, SAVE_TIMEOUT_S)).map)
export const setMappingPaused = (paused) => call('/compass/mapping/set_paused', { data: paused })

/** Файл карты: map.pgm, map.yaml, map.posegraph, map.data. version — сбросить кэш браузера. */
export async function fetchMapFile(id, file, version = '') {
  const res = await fetch(`/files/maps/${id}/${file}${version ? `?v=${encodeURIComponent(version)}` : ''}`)
  if (!res.ok) throw new ApiError('NOT_FOUND')
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Импорт: файлы кладём в /files/uploads/{uploadId}/ (PUT в nginx), потом робот их регистрирует.
 * files — { 'map.yaml': Uint8Array, 'map.pgm': …, 'map.posegraph'?: …, 'map.data'?: … }.
 */
export async function importMap(name, files) {
  const uploadId = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  for (const [file, data] of Object.entries(files)) {
    let res
    try {
      res = await fetch(`/files/uploads/${uploadId}/${file}`, { method: 'PUT', body: data })
    } catch (_) {
      throw new ApiError('NETWORK')
    }
    if (!res.ok) throw new ApiError('INTERNAL')
  }
  return toMap((await call('/compass/maps/import', { upload_id: uploadId, name }, SAVE_TIMEOUT_S)).map)
}
