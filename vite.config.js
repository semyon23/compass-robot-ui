import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Куда проксировать /rosbridge в разработке (на роботе это делает nginx):
//   симуляция на этой машине (по умолчанию)  — rosbridge на ws://127.0.0.1:9090
//   робот                                     — COMPASS_ROBOT=http://192.168.0.120 npm run dev
const robot = process.env.COMPASS_ROBOT
const rosbridge = robot
  ? { target: robot.replace(/^http/, 'ws'), ws: true, changeOrigin: true } // nginx робота сам знает /rosbridge
  : { target: 'ws://127.0.0.1:9090', ws: true, rewrite: () => '/' } // rosbridge слушает корень

// Без робота /files отдаём сами, как nginx (docs/ROS_INTERFACES.md §5): карты, журнал compass_core
// и логи ROS — на чтение (каталог — JSON-листингом, как autoindex_format json), загрузки — PUT.
// Каталог данных — тот же, что data_dir у compass_core в sim.launch.py.
const dataDir = process.env.COMPASS_DATA_DIR || path.join(os.homedir(), '.local/share/compass')
const roots = {
  maps: path.join(dataDir, 'maps'),
  logs: path.join(dataDir, 'logs'),
  uploads: path.join(dataDir, 'uploads'),
  ros_log: process.env.ROS_LOG_DIR || path.join(os.homedir(), '.ros/log'),
}

function listing(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).map((d) => {
    const st = fs.statSync(path.join(dir, d.name))
    return d.isDirectory()
      ? { name: d.name, type: 'directory', mtime: st.mtime.toUTCString() }
      : { name: d.name, type: 'file', mtime: st.mtime.toUTCString(), size: st.size }
  })
}

function localFiles() {
  return {
    name: 'compass-local-files',
    configureServer(server) {
      server.middlewares.use('/files', (req, res) => {
        const [top, ...rest] = decodeURIComponent(req.url.split('?')[0]).split('/').filter(Boolean)
        const root = roots[top]
        const file = root && path.join(root, ...rest)
        if (!root || (file !== root && !file.startsWith(root + path.sep))) {
          res.statusCode = 404
          return res.end()
        }
        if (req.method === 'GET' && top !== 'uploads' && fs.existsSync(file)) {
          res.setHeader('Cache-Control', 'no-cache')
          if (fs.statSync(file).isDirectory()) {
            res.setHeader('Content-Type', 'application/json')
            return res.end(JSON.stringify(listing(file)))
          }
          return fs.createReadStream(file).pipe(res)
        }
        if (req.method === 'PUT' && top === 'uploads') {
          fs.mkdirSync(path.dirname(file), { recursive: true })
          const out = fs.createWriteStream(file)
          out.on('finish', () => {
            res.statusCode = 201
            res.end()
          })
          return req.pipe(out)
        }
        res.statusCode = 404
        res.end()
      })
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [vue(), tailwindcss(), ...(robot ? [] : [localFiles()])],
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
      '/rosbridge': rosbridge,
      // Файлы карт — nginx робота (без робота — localFiles выше).
      ...(robot ? { '/files': { target: robot, changeOrigin: true } } : {}),
    },
  },
  test: {
    environment: 'node',
  },
})
