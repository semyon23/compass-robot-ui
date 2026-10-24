import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as ros from '../api/rosbridge'
import * as robotApi from '../api/robot'
import * as navApi from '../api/navigation'
import { clientId, clientName } from '../lib/clientIdentity'

const MAX_EVENTS = 50
const HEARTBEAT_MS = 500 // 2 Гц; робот снимает аренду, если тишина дольше 2 с
const PING_MS = 2000

// Потоки по запросу экранов (useSubscription): имя → топик rosbridge.
const STREAMS = {
  pose: { topic: '/compass/pose', type: 'robot_interfaces/msg/RobotPose' },
  scan: { topic: '/compass/scan_points', type: 'robot_interfaces/msg/ScanPoints' },
  // Карта большая: бинарно (CBOR) и не чаще раза в секунду.
  map: { topic: '/map', type: 'nav_msgs/msg/OccupancyGrid', options: { compression: 'cbor', throttle_rate: 1000 } },
  nav: { topic: '/compass/nav_status', type: 'robot_interfaces/msg/NavStatus' },
  path: { topic: '/plan', type: 'nav_msgs/msg/Path', options: { throttle_rate: 500 } },
  // Переходы узлов дерева поведения Nav2 — без троттлинга, иначе потеряем смену состояния.
  bt: { topic: '/behavior_tree_log', type: 'nav2_msgs/msg/BehaviorTreeLog' },
}

// Узлы дерева поведения Nav2 (navigate_to_pose_w_replanning_and_recovery.xml) → что делает робот.
// По приоритету: восстановление важнее, чем «едет», — они работают одновременно с FollowPath.
const BT_ACTIVITIES = [
  ['Spin', 'spin'],
  ['BackUp', 'backup'],
  ['DriveOnHeading', 'backup'],
  ['Wait', 'wait'],
  ['Clear', 'clearing'],
  ['ComputePath', 'planning'],
  ['FollowPath', 'driving'],
]

/** Угол поворота вокруг z из кватерниона. */
function yawOf(q) {
  return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z))
}

/**
 * Время ROS ({ sec, nanosec }) → ISO-строка. В симуляции время идёт от нуля (use_sim_time) —
 * тогда показываем момент получения, иначе в ленте было бы «03:00:00 1970».
 */
function isoOf(stamp) {
  const ms = (stamp?.sec ?? 0) * 1000 + Math.floor((stamp?.nanosec ?? 0) / 1e6)
  return new Date(ms > Date.UTC(2020, 0, 1) ? ms : Date.now()).toISOString()
}

/** diagnostic_msgs/KeyValue[] → объект. */
function objectOf(pairs) {
  return Object.fromEntries((pairs || []).map(({ key, value }) => [key, value]))
}

/**
 * Состояние робота по rosbridge: статус (/compass/status), поза и скан, события, аренда управления.
 * Сообщения ROS переводятся в формат, который ждут компоненты.
 */
export const useRobotStore = defineStore('robot', () => {
  const { state: connection } = ros.useRosbridge()

  const info = ref(null)
  const rawStatus = ref(null) // robot_interfaces/msg/RobotStatus как пришёл
  const pose = ref(null)
  const scan = ref(null)
  const liveMap = ref(null) // /map: { width, height, resolution, origin, data }
  const navStatus = ref(null) // /compass/nav_status: текущая или последняя цель Compass
  const navPath = ref([]) // /plan: путь планировщика Nav2
  const btRunning = ref([]) // узлы дерева поведения Nav2 в состоянии RUNNING
  const events = ref([])
  const latencyMs = ref(null)
  const leaseId = ref(null)

  const online = computed(() => connection.value === 'online')
  const robotName = computed(() => info.value?.robotName || 'Compass')
  const capabilities = computed(() => new Set(info.value?.capabilities || []))

  // Статус в форме для компонентов.
  const status = computed(() => {
    const s = rawStatus.value
    if (!s) return null
    const holder = s.control?.holder_id || ''
    const tr = s.transition
    return {
      mode: s.operating_mode,
      state: s.state,
      transition: tr?.active ? { from: tr.from_mode, to: tr.to_mode, step: tr.step, stack: tr.stack } : null,
      map: s.map?.id ? { id: s.map.id, name: s.map.name } : null,
      localization: { status: s.localization?.status || 'none', covariance: s.localization?.covariance ?? 0 },
      stacks: (s.stacks || []).map((x) => ({ name: x.name, state: x.state })),
      mapping: {
        active: !!s.mapping?.active,
        paused: !!s.mapping?.paused,
        unsavedChanges: !!s.mapping?.unsaved_changes,
      },
      battery: s.battery?.present
        ? { percent: s.battery.percent, voltage: s.battery.voltage, charging: s.battery.charging }
        : null,
      control: {
        owner: !holder ? 'none' : holder === clientId ? 'me' : 'other',
        client: s.control?.holder_name || '',
      },
      estop: s.estop,
      errors: (s.errors || []).map((e) => ({ code: e.code, message: e.message, details: objectOf(e.details) })),
    }
  })

  // Что делает Nav2 по цели прямо сейчас: planning | driving | spin | backup | wait | clearing | null.
  const navActivity = computed(() => {
    if (navStatus.value?.state !== 'active') return null
    const found = BT_ACTIVITIES.find(([node]) => btRunning.value.some((name) => name.includes(node)))
    return found ? found[1] : null
  })

  // Что показываем в бейдже: служебное состояние важнее режима.
  const displayMode = computed(() => {
    if (!online.value || !status.value) return 'unknown'
    if (status.value.state === 'switching') return 'switching'
    if (status.value.state === 'error') return 'error'
    return status.value.mode
  })

  // «Я управляю» — только если аренда у этой вкладки и робот это подтверждает.
  const controlOwner = computed(() => {
    const owner = status.value?.control?.owner || 'none'
    return owner === 'me' && !leaseId.value ? 'other' : owner
  })

  // ---------- Аренда управления ----------

  let heartbeatTimer = null
  let acquiredAt = 0

  function stopHeartbeat() {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }

  async function acquireControl(force = false) {
    const res = await robotApi.acquireControl(clientId, clientName, force)
    leaseId.value = res.lease_id
    acquiredAt = Date.now()
    stopHeartbeat()
    heartbeatTimer = setInterval(() => robotApi.sendHeartbeat(leaseId.value), HEARTBEAT_MS)
  }

  async function releaseControl() {
    const id = leaseId.value
    leaseId.value = null
    stopHeartbeat()
    if (id) await robotApi.releaseControl(id)
  }

  /** Цель (kind = goal) или маршрут (route, mode = waypoints | through_poses) — с арендой этой вкладки. */
  function navStart(kind, mode, poses) {
    return navApi.navStart(leaseId.value || '', kind, mode, poses)
  }

  /** Джойстик: без аренды робот команду всё равно проигнорирует — не шлём. */
  function sendTeleop(linear, angular) {
    if (leaseId.value) robotApi.sendTeleop(leaseId.value, linear, angular)
  }

  // ---------- Подписки ----------

  function onStatus(msg) {
    // Сменился режим — прежняя карта (SLAM остановлен) больше не текущая.
    if (rawStatus.value && rawStatus.value.operating_mode !== msg.operating_mode) liveMap.value = null
    rawStatus.value = msg
    // Аренду у нас забрали (перехват, снятие по таймауту, смена режима) — забываем свой ключ.
    // «Свободно» сразу после захвата — это статус, отправленный до него: пропускаем секунду.
    const holder = msg.control?.holder_id || ''
    const lost = holder ? holder !== clientId : Date.now() - acquiredAt > 1500
    if (leaseId.value && lost) {
      leaseId.value = null
      stopHeartbeat()
    }
  }

  function onEvent(msg) {
    const ev = {
      id: msg.id,
      time: isoOf(msg.stamp),
      level: msg.level,
      code: msg.code,
      message: msg.message,
      details: objectOf(msg.details),
    }
    events.value = [ev, ...events.value.filter((e) => e.id !== ev.id)].slice(0, MAX_EVENTS)
  }

  const streamHandlers = {
    pose: (msg) => {
      pose.value = { frame: msg.frame, x: msg.x, y: msg.y, theta: msg.theta, linear: msg.linear, angular: msg.angular }
    },
    scan: (msg) => {
      const pts = msg.points || []
      const pairs = []
      for (let i = 0; i + 1 < pts.length; i += 2) pairs.push([pts[i], pts[i + 1]])
      scan.value = pairs
    },
    nav: (msg) => {
      // Пустой goal_id — целей ещё не было
      navStatus.value = msg.goal_id
        ? {
            goalId: msg.goal_id,
            operatorName: msg.operator_name,
            kind: msg.kind,
            mode: msg.mode,
            poses: msg.poses.map(({ x, y, theta }) => ({ x, y, theta })),
            index: msg.index,
            state: msg.state,
            distanceRemaining: msg.distance_remaining >= 0 ? msg.distance_remaining : null,
            eta: msg.eta >= 0 ? msg.eta : null,
            recoveries: msg.recoveries,
            error: msg.error_code ? { code: msg.error_code, message: msg.error_message } : null,
          }
        : null
    },
    bt: (msg) => {
      const running = new Set(btRunning.value)
      for (const e of msg.event_log || []) {
        if (e.current_status === 'RUNNING') running.add(e.node_name)
        else running.delete(e.node_name)
      }
      btRunning.value = [...running]
    },
    path: (msg) => {
      navPath.value = (msg.poses || []).map((p) => [p.pose.position.x, p.pose.position.y])
    },
    map: (msg) => {
      const o = msg.info.origin
      liveMap.value = {
        width: msg.info.width,
        height: msg.info.height,
        resolution: msg.info.resolution,
        origin: [o.position.x, o.position.y, yawOf(o.orientation)],
        data: msg.data, // Int8Array из CBOR
      }
    },
  }

  /** Подписка экрана на потоки по именам (pose, scan). Неизвестные имена — следующие срезы. */
  function subscribeStreams(names) {
    const offs = names
      .filter((name) => STREAMS[name])
      .map((name) => ros.subscribe(STREAMS[name].topic, STREAMS[name].type, streamHandlers[name], STREAMS[name].options))
    return () => offs.forEach((off) => off())
  }

  async function loadInfo() {
    try {
      const r = await robotApi.getInfo()
      info.value = {
        robotName: r.robot_name,
        serialNumber: r.serial_number,
        manufacturer: r.manufacturer,
        model: r.model,
        versions: objectOf(r.versions),
        capabilities: r.capabilities || [],
      }
    } catch (_) {
      // compass_core ещё не поднялся — повторим при следующем подключении.
    }
  }

  // Задержка: время ответа /compass/ping (кружок + мс в шапке).
  async function measureLatency() {
    if (!online.value) return
    const t0 = performance.now()
    try {
      await robotApi.ping()
      latencyMs.value = Math.round(performance.now() - t0)
      if (!info.value) loadInfo()
    } catch (_) {
      latencyMs.value = null
    }
  }

  function init() {
    ros.subscribe('/compass/status', 'robot_interfaces/msg/RobotStatus', onStatus)
    ros.subscribe('/compass/events', 'robot_interfaces/msg/Event', onEvent)
    ros.onOpen(() => {
      loadInfo()
      measureLatency()
    })
    // Без связи не показываем устаревшее состояние как текущее.
    ros.onClose(() => {
      rawStatus.value = null
      pose.value = null
      scan.value = null
      liveMap.value = null
      navPath.value = []
      latencyMs.value = null
      leaseId.value = null
      stopHeartbeat()
    })
    setInterval(measureLatency, PING_MS)
    ros.connect()
  }

  return {
    info,
    status,
    pose,
    scan,
    liveMap,
    navStatus,
    navPath,
    navActivity,
    events,
    latencyMs,
    clientId,
    online,
    robotName,
    capabilities,
    displayMode,
    controlOwner,
    acquireControl,
    releaseControl,
    sendTeleop,
    navStart,
    subscribeStreams,
    loadInfo,
    init,
  }
})
