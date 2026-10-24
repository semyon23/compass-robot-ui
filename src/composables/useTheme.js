import { ref, computed, watch } from 'vue'
import { DEFAULT_SCHEME, SCHEMES, brandScale } from '../lib/schemes'

const LS_KEY = 'compass.theme'
const SCHEME_KEY = 'compass.scheme'
const media = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null

function systemPrefersDark() {
  return media ? media.matches : false
}

function loadMode() {
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch (_) {}
  return 'system'
}

// mode — что выбрал пользователь (light | dark | system), effective — что применяется.
const mode = ref(loadMode())
const effective = ref(resolve(mode.value))

function resolve(m) {
  return m === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : m
}

function apply(m) {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', m === 'dark')
}
apply(effective.value)

watch(mode, (m) => {
  effective.value = resolve(m)
  apply(effective.value)
  try {
    if (m === 'system') localStorage.removeItem(LS_KEY)
    else localStorage.setItem(LS_KEY, m)
  } catch (_) {}
})

media?.addEventListener?.('change', () => {
  if (mode.value !== 'system') return
  effective.value = resolve('system')
  apply(effective.value)
})

// Цветовая гамма: подменяем CSS-переменные --color-brand-* (из них Tailwind строит brand-*).
function loadScheme() {
  try {
    const saved = localStorage.getItem(SCHEME_KEY)
    if (SCHEMES[saved]) return saved
  } catch (_) {}
  return DEFAULT_SCHEME
}

const scheme = ref(loadScheme())

const brand = computed(() => brandScale(scheme.value, effective.value === 'dark'))

function applyScheme(scale) {
  if (typeof document === 'undefined') return
  for (const [step, color] of Object.entries(scale)) {
    document.documentElement.style.setProperty(`--color-brand-${step}`, color)
  }
}
applyScheme(brand.value)
watch(brand, applyScheme)

watch(scheme, (name) => {
  try {
    localStorage.setItem(SCHEME_KEY, name)
  } catch (_) {}
})

export function useTheme() {
  return {
    isDark: computed(() => effective.value === 'dark'),
    mode: computed(() => mode.value),
    setMode(m) {
      if (m === 'light' || m === 'dark' || m === 'system') mode.value = m
    },
    scheme: computed(() => scheme.value),
    brand, // { 50: '#…', …, 950: '#…' } с учётом темы — для canvas и naive-ui
    setScheme(name) {
      if (SCHEMES[name]) scheme.value = name
    },
  }
}
