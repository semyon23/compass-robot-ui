# Compass UI

Веб-консоль робота на ROS 2: картографирование, навигация, конфигурация.
Vue 3 + Vite + Pinia + naive-ui + Tailwind v4, JavaScript.

UI раздаётся с робота nginx'ом и общается с ROS через **rosbridge** (свой тонкий клиент
`src/api/rosbridge.js`): состояние, поза, скан, команды — топики и сервисы `compass_core`.
Контракт — [docs/ROS_INTERFACES.md](docs/ROS_INTERFACES.md).

## Запуск

Робот в симуляции (workspace `~/compass_ws`, rosbridge из apt — `ros-jazzy-rosbridge-server`):

```bash
ros2 launch compass_bringup sim.launch.py
```

UI:

```bash
npm install
npm run dev      # http://localhost:5176, /rosbridge проксируется на ws://127.0.0.1:9090
```

На настоящем роботе (через его nginx):

```bash
COMPASS_ROBOT=http://192.168.0.120 npm run dev
```

Экраны карт, картографирования и навигации появляются, только когда робот объявляет
соответствующие `capabilities` в `/compass/get_info` (следующие срезы).

## Сборка и тесты

```bash
npm run build    # dist/ — раздаёт nginx робота
npm test
```

nginx должен отдавать `index.html` на любой путь вне `/rosbridge` и `/files`
(SPA fallback), иначе обновление страницы на `/drive` даст 404.
