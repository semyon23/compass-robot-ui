# Compass UI

Веб-консоль робота на ROS 2: картографирование, навигация, конфигурация.
Vue 3 + Vite + Pinia + naive-ui + Tailwind v4, JavaScript.

UI раздаётся с робота нодой `compass_web` (веб-сервер в `compass_ws`) и общается с ROS через **rosbridge** (свой тонкий клиент
`src/api/rosbridge.js`): состояние, поза, скан, команды — топики и сервисы `compass_core`.
Контракт — [docs/ROS_INTERFACES.md](docs/ROS_INTERFACES.md).

## Запуск

Робот в симуляции (workspace `~/compass_ws`, rosbridge из apt — `ros-jazzy-rosbridge-server`):

```bash
ros2 launch compass_sim sim.launch.py
```

UI:

```bash
npm install
npm run dev      # http://localhost:5176
```

Vite проксирует `/rosbridge` и `/files` на `compass_web` симуляции (`http://127.0.0.1:8080`).
Собранный UI можно открыть и без Vite — прямо с `compass_web`: `http://localhost:8080`.

На настоящем роботе:

```bash
COMPASS_ROBOT=http://192.168.0.120 npm run dev
```

Экраны карт, картографирования и навигации появляются, только когда робот объявляет
соответствующие `capabilities` в `/compass/get_info`.

## Сборка и тесты

```bash
npm run build    # dist/ — раздаёт compass_web (параметр ui_dir в compass_web.yaml)
npm test
```

