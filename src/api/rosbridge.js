import { ref, readonly } from 'vue'
import { decode } from 'cbor-x'
import { ApiError } from './errors'

/**
 * Тонкий клиент протокола rosbridge v2 (docs/ROS_INTERFACES.md).
 * Свой, а не roslibjs: нужен QoS при advertise (volatile, depth 1 — чтобы перезапущенный
 * подписчик не получил «повтор» старых команд джойстика), а roslibjs его не передаёт.
 *
 * - Одно WebSocket-соединение, автопереподключение 1 → 2 → 5 → 10 с.
 * - Подписки и объявления помнятся и восстанавливаются после переподключения.
 * - Сервисы — Promise: ответ робота или ApiError с кодом.
 * - Подписка с compression: 'cbor' приходит бинарным кадром (карта: int8[] → Int8Array).
 */

const BACKOFF_MS = [1000, 2000, 5000, 10000]
const SERVICE_TIMEOUT_S = 5

const state = ref('connecting') // connecting | online | offline

let ws = null
let attempt = 0
let reconnectTimer = null
let seq = 0
const subscriptions = new Map() // topic -> { type, options, handlers: Set }
const advertised = new Map() // topic -> { type, qos }
const pending = new Map() // id запроса сервиса -> { resolve, reject, timer }
const listeners = { open: new Set(), close: new Set() }

function url() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/rosbridge`
}

function nextId(prefix) {
  seq += 1
  return `${prefix}-${seq}`
}

function sendRaw(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
    return true
  }
  return false
}

function sendSubscribe(topic, sub) {
  sendRaw({ op: 'subscribe', id: `sub-${topic}`, topic, type: sub.type, ...sub.options })
}

function sendAdvertise(topic, adv) {
  sendRaw({ op: 'advertise', id: `adv-${topic}`, topic, type: adv.type, qos: adv.qos })
}

export function connect() {
  clearTimeout(reconnectTimer)
  if (ws) return
  if (state.value !== 'offline') state.value = 'connecting'
  const sock = new WebSocket(url())
  sock.binaryType = 'arraybuffer'
  ws = sock

  sock.onopen = () => {
    attempt = 0
    state.value = 'online'
    subscriptions.forEach((sub, topic) => sendSubscribe(topic, sub))
    advertised.forEach((adv, topic) => sendAdvertise(topic, adv))
    listeners.open.forEach((fn) => fn())
  }
  sock.onmessage = (ev) => {
    let msg
    try {
      msg = typeof ev.data === 'string' ? JSON.parse(ev.data) : decode(new Uint8Array(ev.data))
    } catch (_) {
      return
    }
    if (msg.op === 'publish') {
      subscriptions.get(msg.topic)?.handlers.forEach((fn) => fn(msg.msg))
    } else if (msg.op === 'service_response') {
      const p = pending.get(msg.id)
      if (!p) return
      pending.delete(msg.id)
      clearTimeout(p.timer)
      if (msg.result) p.resolve(msg.values)
      // result=false — вызов не дошёл: сервиса нет (узел не запущен) или он не ответил.
      else p.reject(new ApiError('TIMEOUT', String(msg.values ?? '')))
    }
  }
  sock.onclose = () => {
    if (ws !== sock) return
    ws = null
    state.value = 'offline'
    pending.forEach((p) => {
      clearTimeout(p.timer)
      p.reject(new ApiError('NETWORK'))
    })
    pending.clear()
    listeners.close.forEach((fn) => fn())
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
    attempt += 1
    reconnectTimer = setTimeout(connect, delay)
  }
  sock.onerror = () => {
    // onclose придёт следом — там и переподключаемся.
  }
}

/** Подписка на топик. options — throttle_rate, queue_length, compression. Возвращает отписку. */
export function subscribe(topic, type, handler, options = {}) {
  let sub = subscriptions.get(topic)
  if (!sub) {
    sub = { type, options, handlers: new Set() }
    subscriptions.set(topic, sub)
    sendSubscribe(topic, sub)
  }
  sub.handlers.add(handler)
  return () => {
    sub.handlers.delete(handler)
    if (sub.handlers.size === 0) {
      subscriptions.delete(topic)
      sendRaw({ op: 'unsubscribe', id: `sub-${topic}`, topic })
    }
  }
}

// Команды UI: без «повтора» для поздних подписчиков (контракт §1, QoS).
const COMMAND_QOS = { reliability: 'reliable', durability: 'volatile', history: 'keep_last', depth: 1 }

/** Публикация. Первый раз объявляет топик с QoS команд. */
export function publish(topic, type, msg) {
  if (!advertised.has(topic)) {
    const adv = { type, qos: COMMAND_QOS }
    advertised.set(topic, adv)
    sendAdvertise(topic, adv)
  }
  return sendRaw({ op: 'publish', topic, msg })
}

/** Вызов сервиса. Возвращает values ответа как есть. */
export function callService(service, args = {}, timeoutS = SERVICE_TIMEOUT_S) {
  return new Promise((resolve, reject) => {
    const id = nextId('call')
    if (!sendRaw({ op: 'call_service', id, service, args, timeout: timeoutS })) {
      reject(new ApiError('NETWORK'))
      return
    }
    // Свой таймер — на случай, если rosbridge не ответит совсем.
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new ApiError('TIMEOUT'))
    }, (timeoutS + 1) * 1000)
    pending.set(id, { resolve, reject, timer })
  })
}

/**
 * Сервис compass_interfaces / std_srvs: success=false → ApiError с error_code
 * (у std_srvs кода нет — код в message, контракт §1).
 */
export async function call(service, args = {}, timeoutS) {
  const values = await callService(service, args, timeoutS)
  if (values && values.success === false) {
    const code = values.error_code || values.message || 'UNKNOWN'
    throw new ApiError(code, values.message)
  }
  return values
}

export function onOpen(fn) {
  listeners.open.add(fn)
  return () => listeners.open.delete(fn)
}

export function onClose(fn) {
  listeners.close.add(fn)
  return () => listeners.close.delete(fn)
}

export function useRosbridge() {
  return { state: readonly(state) }
}
