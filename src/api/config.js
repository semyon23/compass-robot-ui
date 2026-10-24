import { callService } from './rosbridge'
import { ApiError } from './errors'
import { clientName } from '../lib/clientIdentity'

// Настройки робота (docs/ROS_INTERFACES.md §3.5): JsonCall — JSON внутри строки, схему задаёт робот.
async function jsonCall(op, request = {}) {
  const v = await callService(`/compass/config/${op}`, { request_json: JSON.stringify(request) })
  const body = v.response_json ? JSON.parse(v.response_json) : null
  // INVALID_INPUT — в details ошибки по полям: { ключ: { code, message, min?, max? } }
  if (!v.success) throw new ApiError(v.error_code || 'UNKNOWN', v.message, body?.errors)
  return body
}

export const getSchema = () => jsonCall('get_schema')
export const getConfig = () => jsonCall('get') // { version, values }
export const getHistory = () => jsonCall('history') // [{ version, createdAt, client, comment, changes }]
// values — только изменённые ключи; baseVersion — версия, от которой правили (иначе CONFLICT)
export const applyConfig = (baseVersion, values, comment) =>
  jsonCall('apply', { baseVersion, values, comment, client: clientName })
export const rollbackConfig = (version) => jsonCall('rollback', { version, client: clientName })
