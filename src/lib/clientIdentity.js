/**
 * Кто мы для робота (контракт §3.2): client_id — свой на каждую вкладку и переживает F5;
 * client_name — подпись для других: «Chrome · Linux».
 */

function makeId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
}

function loadClientId() {
  try {
    const saved = sessionStorage.getItem('compass.clientId')
    if (saved) return saved
    const id = makeId()
    sessionStorage.setItem('compass.clientId', id)
    return id
  } catch (_) {
    return makeId()
  }
}

function browserName(ua) {
  if (/Edg\//.test(ua)) return 'Edge'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Chrome\//.test(ua)) return 'Chrome'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'Browser'
}

function osName(ua) {
  if (/Android/.test(ua)) return 'Android'
  if (/iPad|iPhone/.test(ua)) return 'iOS'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Mac OS X/.test(ua)) return 'macOS'
  if (/Linux/.test(ua)) return 'Linux'
  return ''
}

export const clientId = loadClientId()
export const clientName = [browserName(navigator.userAgent), osName(navigator.userAgent)].filter(Boolean).join(' · ')
