import { call } from './rosbridge'

// Навигация (docs/ROS_INTERFACES.md §3.1, §3.4): активная карта, поза, сервисные цели.

const pose2d = ({ x, y, theta }) => ({ x, y, theta })

/**
 * Сделать карту активной (робот перезапустит навигацию с ней) и/или задать позу робота.
 * Та же активная карта + поза — только передать позу AMCL, без перезапуска.
 */
export const activateMap = (mapId, pose = null) =>
  call('/robot/maps/activate', {
    map_id: mapId,
    has_initial_pose: !!pose,
    initial_pose: pose ? pose2d(pose) : { x: 0, y: 0, theta: 0 },
  })

// Цель или маршрут — только у владельца управления (lease_id). Ответ — когда оркестратор начал задачу.
export const navStart = (leaseId, kind, mode, poses) =>
  call('/compass/nav/start', { lease_id: leaseId, kind, mode, poses: poses.map(pose2d) }, 10)

export const navCancel = () => call('/compass/nav/cancel')
