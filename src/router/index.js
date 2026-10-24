import { createRouter, createWebHistory } from 'vue-router'

// meta.title — ключ i18n; meta.capability — экран показывается, только если робот это умеет.
const routes = [
  { path: '/', redirect: '/overview' },
  { path: '/overview', component: () => import('../views/OverviewView.vue'), meta: { title: 'nav.overview', icon: '◎' } },
  { path: '/drive', component: () => import('../views/DriveView.vue'), meta: { title: 'nav.drive', icon: '✥' } },
  { path: '/mapping', component: () => import('../views/MappingView.vue'), meta: { title: 'nav.mapping', icon: '▦', capability: 'mapping' } },
  { path: '/maps', component: () => import('../views/MapsView.vue'), meta: { title: 'nav.maps', icon: '▤', capability: 'mapping' } },
  { path: '/logs', component: () => import('../views/LogsView.vue'), meta: { title: 'nav.logs', icon: '≡' } },
  // Настройки робота и интерфейса — один раздел с вкладками (/settings/robot, /settings/interface).
  { path: '/settings', redirect: '/settings/robot' },
  { path: '/settings/:tab(robot|interface)', component: () => import('../views/SettingsView.vue'), meta: { title: 'nav.settings', icon: '⚙', secondary: true, navPath: '/settings' } },
  { path: '/:pathMatch(.*)*', redirect: '/overview' },
]

const router = createRouter({
  history: createWebHistory('/'),
  routes,
})

export default router
