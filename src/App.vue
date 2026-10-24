<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import { NConfigProvider, NMessageProvider, darkTheme } from 'naive-ui'
import { useMediaQuery } from '@vueuse/core'
import AppSidebar from './components/AppSidebar.vue'
import AppTopbar from './components/AppTopbar.vue'
import OfflineBanner from './components/OfflineBanner.vue'
import { useTheme } from './composables/useTheme'
import { useRobotStore } from './stores/robot'

const { isDark, brand } = useTheme()
const naiveTheme = computed(() => (isDark.value ? darkTheme : null))
const robot = useRobotStore()

// На планшете (уже 1280 px) меню по умолчанию свёрнуто до иконок.
const wide = useMediaQuery('(min-width: 1280px)')
const collapsed = ref(!wide.value)
watch(wide, (w) => (collapsed.value = !w))

onMounted(() => robot.init())

// Основной цвет naive-ui — из выбранной гаммы (Настройки → Интерфейс).
const themeOverrides = computed(() => ({
  common: {
    primaryColor: brand.value[800],
    primaryColorHover: brand.value[700],
    primaryColorPressed: brand.value[900],
    primaryColorSuppl: brand.value[500],
    borderRadius: '6px',
    fontFamily: 'Inter, system-ui, sans-serif',
    fontFamilyMono: 'JetBrains Mono, ui-monospace, monospace',
  },
}))
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <NMessageProvider placement="bottom-right">
      <div class="flex h-screen w-screen overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <AppSidebar :collapsed="collapsed" @toggle="collapsed = !collapsed" />
        <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
          <AppTopbar />
          <OfflineBanner />
          <main class="flex-1 overflow-auto p-4 lg:p-6">
            <RouterView />
          </main>
        </div>
      </div>
    </NMessageProvider>
  </NConfigProvider>
</template>
