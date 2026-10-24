import { createI18n } from 'vue-i18n'
import ru from './ru'
import en from './en'

const LS_KEY = 'compass.locale'
export const LOCALES = [
  { value: 'ru', label: 'RU' },
  { value: 'en', label: 'EN' },
]

function initialLocale() {
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (saved === 'ru' || saved === 'en') return saved
  } catch (_) {}
  return navigator.language?.toLowerCase().startsWith('ru') ? 'ru' : 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'en',
  messages: { ru, en },
})

export function setLocale(locale) {
  i18n.global.locale.value = locale
  document.documentElement.lang = locale
  try {
    localStorage.setItem(LS_KEY, locale)
  } catch (_) {}
}
