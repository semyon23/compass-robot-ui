import { zipSync } from 'fflate'
import { ApiError } from './errors'

// Файлы логов по HTTP (docs/ROS_INTERFACES.md §5, веб-сервер робота compass_web):
//   /files/ros_log/ — логи ROS 2 (ROS_LOG_DIR): файл на процесс ноды + папка на запуск с launch.log;
//   /files/logs/    — журнал WARN+ compass_core, файл на день.
// Каталог отдаётся JSON-листингом (формат nginx autoindex): [{ name, type: file | directory, mtime, size }].

async function list(url) {
  const res = await fetch(url)
  if (!res.ok) throw new ApiError('NOT_FOUND')
  return res.json()
}

async function bytes(url) {
  const res = await fetch(url)
  if (!res.ok) throw new ApiError('NOT_FOUND')
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Архив логов, изменявшихся после since (мс): берём файл целиком, если в него писали в этот период.
 * Возвращает { zip: Uint8Array, count, size } или null, если за период ничего нет.
 */
export async function collectLogs(since) {
  const files = {}
  const fresh = (e) => Date.parse(e.mtime) >= since
  for (const e of (await list('/files/ros_log/')).filter(fresh)) {
    if (e.type === 'file') {
      files[`ros_log/${e.name}`] = await bytes(`/files/ros_log/${encodeURIComponent(e.name)}`)
    } else {
      for (const f of await list(`/files/ros_log/${encodeURIComponent(e.name)}/`)) {
        if (f.type === 'file') {
          files[`ros_log/${e.name}/${f.name}`] = await bytes(`/files/ros_log/${encodeURIComponent(e.name)}/${encodeURIComponent(f.name)}`)
        }
      }
    }
  }
  for (const e of (await list('/files/logs/')).filter((e) => e.type === 'file' && fresh(e))) {
    files[`compass/${e.name}`] = await bytes(`/files/logs/${encodeURIComponent(e.name)}`)
  }
  const names = Object.keys(files)
  if (!names.length) return null
  const size = names.reduce((sum, n) => sum + files[n].length, 0)
  return { zip: zipSync(files), count: names.length, size }
}
