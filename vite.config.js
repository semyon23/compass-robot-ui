import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// Куда проксировать /rosbridge и /files в разработке — на веб-сервер робота compass_web
// (compass_bringup), как в работе. По умолчанию — симуляция на этой машине (порт из
// config/compass_web.yaml), иначе робот: COMPASS_ROBOT=http://192.168.0.120 npm run dev
const target = process.env.COMPASS_ROBOT || 'http://127.0.0.1:8080'

export default defineConfig({
  base: '/',
  plugins: [vue(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { 'naive-ui': ['naive-ui'] },
      },
    },
  },
  server: {
    port: 5176,
    proxy: {
      '/rosbridge': { target: target.replace(/^http/, 'ws'), ws: true, changeOrigin: true },
      '/files': { target, changeOrigin: true },
    },
  },
  test: {
    environment: 'node',
  },
})
