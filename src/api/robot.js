import { call, publish } from './rosbridge'

// Сервисы и команды compass_core (docs/ROS_INTERFACES.md §3).

export const getInfo = () => call('/compass/get_info')
export const ping = () => call('/compass/ping', {}, 2)
// continueFrom — для TEACH_IN: id карты, которую достраиваем.
export const setOperatingMode = (mode, continueFrom = '') =>
  call('/robot/set_operating_mode', { mode, continue_from: continueFrom })
export const stop = () => call('/compass/stop')

export const acquireControl = (clientId, clientName, force = false) =>
  call('/compass/control/acquire', { client_id: clientId, client_name: clientName, force })
export const releaseControl = (leaseId) => call('/compass/control/release', { lease_id: leaseId })

export const sendHeartbeat = (leaseId) =>
  publish('/compass/control/heartbeat', 'robot_interfaces/msg/ControlHeartbeat', { lease_id: leaseId })
export const sendTeleop = (leaseId, linear, angular) =>
  publish('/compass/teleop', 'robot_interfaces/msg/TeleopCommand', { lease_id: leaseId, linear, angular })
