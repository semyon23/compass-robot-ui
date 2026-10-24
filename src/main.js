import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { i18n } from './locales'
// Шрифт логотипа — локально, робот может работать без интернета.
import '@fontsource/michroma/latin-400.css'
import './assets/main.css'

document.documentElement.lang = i18n.global.locale.value

createApp(App).use(createPinia()).use(router).use(i18n).mount('#app')
// Заставка из index.html уходит, когда загружен первый экран (lazy-чанк роута).
router.isReady().finally(() => window.__hideSplash?.())
