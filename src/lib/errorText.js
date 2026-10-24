import { i18n } from '../locales'

/** Человеческий текст ошибки по её code (HTTP-коды и сырые ответы не показываем). */
export function errorText(err) {
  const { t, te } = i18n.global
  const code = err?.code || 'UNKNOWN'
  if (!te(`errors.${code}`)) return err?.message || t('errors.UNKNOWN')
  // Робот объясняет причину отказа («управляет Chrome · Linux», «робот ещё запускается») —
  // показываем её рядом с переведённым кодом.
  // Для обрыва связи и таймаута причина — технический текст rosbridge, его не показываем.
  const technical = code === 'TIMEOUT' || code === 'NETWORK'
  const reason = !technical && err?.message && err.message !== code ? err.message : ''
  return reason ? `${t(`errors.${code}`)}: ${reason}` : t(`errors.${code}`)
}
