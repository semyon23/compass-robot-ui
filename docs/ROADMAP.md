# Compass — план разработки

2026-10-02. Что делаем, в каком порядке и как проверяем. Интерфейсы — [ROS_INTERFACES.md](ROS_INTERFACES.md).

Роли: **робот** (C++, ROS 2) — Семён; **UI** (Vue) — Claude. Граница — контракт.

## Как работаем

1. **Контракт первым.** Нужен новый топик или поле — сначала правим `ROS_INTERFACES.md`, потом код
   с обеих сторон.
2. **Симуляция раньше робота.** Всё, кроме драйверов, разрабатываем в Gazebo с Nav2 — она уже
   установлена: `ros2 launch nav2_bringup tb4_simulation_launch.py`. На реальный робот переносим
   готовое.
3. **Каждый этап сначала проверяется без UI** — `ros2 service call`, `ros2 topic echo`. Работает
   в CLI — подключаем UI.
4. **UI не ждёт робот.** UI разрабатывается против симуляции (`compass_sim sim.launch.py`):
   там настоящие compass_core, rosbridge и Nav2, мок не нужен.
5. **Этап закончен**, когда выполнен его сценарий проверки целиком.

Размер: **S** — небольшой, **M** — средний, **L** — большой.

---

## Этап 0. Окружение — S

**Итог:** рабочее пространство собирается, симуляция и rosbridge запускаются.

Робот:
- [ ] Рабочее пространство `~/compass_ws/src`:
  - `compass_interfaces` — msg/srv из контракта §7 как есть;
  - `compass_core` — пустая нода-заготовка;
  - `compass_bringup` — launch-файлы и конфиги (twist_mux, rosbridge, задачи оркестратора);
  - rosbridge — **из apt** (`ros-jazzy-rosbridge-server`, 2.7.x): ветка `ros2` из исходников
    (4.2.1) требует rosidl новее, чем в Jazzy, и не запускается. Запуск — своим launch-файлом:
    `actions_glob` — параметр ноды, штатный launch его не пробрасывает;
  - `task_orchestrator_msgs`, `task_orchestrator_core` 1.0.0 (`~/Downloads/ros2_task_orchestrator-master`).
- [x] `sudo apt install ros-jazzy-twist-mux` (nginx не нужен — веб-сервер `compass_web`).

UI:
- [x] API-слой на своём клиенте rosbridge (`src/api/rosbridge.js`); старый мок REST/WS удалён.

Проверка:
- `colcon build` проходит; `ros2 interface show compass_interfaces/msg/RobotStatus` показывает тип.
- `tb4_simulation_launch.py` поднимается, робот в Gazebo ездит из RViz.
- rosbridge стартует с белыми списками из §6; UI работает с симуляцией.

---

## Этап 1. «Робот на связи и едет с пульта» — M

**Итог:** открыли Compass — видно состояние робота, взяли управление и ездим джойстиком в Gazebo.

Робот — `compass_core`, первые модули:
- [ ] Каркас: `MultiThreadedExecutor`, отдельные callback group для сервисов и таймеров.
- [ ] **Status**: `/compass/status` (пока режим всегда `idle`, батарея из топика, если есть),
      `/compass/events`, `/compass/ping`, `/compass/get_info`.
- [ ] **Control Lease**: `/compass/control/acquire`, `release`, heartbeat, снятие аренды через 2 с.
- [ ] **Teleop Gate**: `/compass/teleop` → проверка аренды → лимиты → `cmd_vel_teleop`.
- [ ] Цепочка скоростей: `twist_mux` (teleop + nav, timeout 0.5) → `collision_monitor` → база.
- [ ] `/compass/pose` (TF `odom→base_link` + одометрия), `/compass/scan_points` (из `/scan`).
- [ ] `/compass/stop` — пока только обнулить teleop.

UI: Обзор и Управление (джойстик) на rosbridge.

Проверка:
- CLI: `ros2 service call /compass/control/acquire …` выдаёт `lease_id`;
  `ros2 topic pub /compass/teleop …` с ним — робот едет, с чужим — нет.
- UI против симуляции: статус и поза видны; взял управление — едет; закрыл вкладку — встал
  за 0,5 с (twist_mux); вторая вкладка видит «Управляет …» и может перехватить.

---

## Этап 2. «Картографирование» — L ✅ 2026-10-24

**Итог:** строим карту в симуляции из Compass, сохраняем, видим её в библиотеке.

Робот (`compass_core` 0.2.0):
- [x] SLAM дочерним процессом (`slam.launch.py`, своя группа процессов, SIGINT → SIGTERM → SIGKILL),
      готовность — первая `/map`, таймаут 60 с, падение → событие и возврат в `SERVICE`.
- [x] `SERVICE ⇄ TEACH_IN` через `/robot/set_operating_mode`, `status.transition`.
- [x] Библиотека карт: `/compass/mapping/save` (PGM+YAML из `/map` + `serialize_map` + `meta.yaml`),
      `list`, `rename`, `delete`, `import`, `/compass/mapping/set_paused`, `unsaved_changes`,
      продолжение карты (`continue_from`).
- [x] Хранилище `{data_dir}/maps/{id}/` (`/var/lib/robot`, в симуляции `~/.local/share/compass`).

UI: Картографирование на `/map` (OccupancyGrid, CBOR), экран **Карты** (превью из `map.pgm`,
переименование, удаление, экспорт `.zip`, импорт).

Проверено в симуляции: старт, карта растёт при езде, сохранение, конфликт имени, пауза (карта не
меняется), выход с несохранённой картой — подтверждение, «Сохранить и завершить», продолжение
карты, импорт копии, переименование, удаление; удалить строящуюся карту нельзя.

Продолжение карты: если это активная карта и робот локализован — с его текущей позы; иначе
робота ставят в точку начала карты.

---

## Этап 3. «Навигация: цели и маршруты» — L ✅ 2026-10-24

**Итог:** выбираем карту, задаём позу, отправляем робота в точку или по маршруту.

Робот (`compass_core` 0.3.0):
- [x] Стеки: один дочерний процесс — `slam` (TEACH_IN) или `nav` (map_server + AMCL + Nav2 на
      активной карте), готовность по `lifecycle_manager_*/is_active`, падение → `STACK_FAILED`.
- [x] `/robot/maps/activate` — активная карта (+ поза), переживает перезапуск; локализация по
      `/amcl_pose` в `status.localization`.
- [x] task_orchestrator с `tasks.yaml` (§4.2) в `core.launch.py`, история в `{data_dir}/tasks.db`.
- [x] `/compass/nav/start`, `/compass/nav/cancel`, `/compass/nav_status`, параметры допуска (§4.3),
      отмена цели ненулевым teleop и сменой режима, `/compass/stop` → `/task_orchestrator/stop`.

UI: панель «Навигация» (активная карта, локализация, цель, маршрут), инструменты на карте
(поза, цель, маршрут), путь Nav2 (`/plan`).

Сделано 2026-10-27: task_orchestrator убран — compass_core ставит цели прямо в Nav2 (контракт §4),
`NO_PATH` / `STUCK` различаются по коду ошибки Nav2, порог задач проверяет `NavStart`.
Сделано позже: СТОП блокирует twist_mux и снимается в Compass; лента событий переживает
перезагрузку; продолжение активной карты — с позы локализации.

---

## Этап 4. «Настройки робота» — M ✅ 2026-10-24

**Итог:** параметры робота меняются из Compass, применяются и попадают во все компоненты.

Робот — Config в compass_core (`config_store`, `settings.cpp`):
- [x] `{data_dir}/config/robot.yaml` + схема `compass_bringup/config/robot_schema.yaml` (поля,
      границы, подписи RU/EN), версии, история (`history.jsonl`), откат, `CONFLICT` по `baseVersion`.
- [x] `/compass/config/{get_schema, get, apply, history, rollback}` (§3.5), `/compass/config/changed`.
- [x] Применение: лимиты скорости — джойстик сразу, Nav2 через `velocity_smoother`; порог задач →
      `tasks.yaml` + `/task_orchestrator/reload_config`; `BATTERY_LOW`, `BATTERY_CRITICAL` (отмена цели).
- [x] Разделы `identity`, `motion`, `battery`.

UI: «Настройки → Робот» — формы по схеме, ошибки по полям, применение с комментарием, история, откат.

Отложено: раздел `fms` (с агентом), сеть с автооткатом, правка сырых YAML.

---

## Этап 5. «Флот» — L

**Итог:** робот выполняет заказы fleet-manager, а оператор в Compass может перехватить управление
и вернуть его флоту.

Робот:
- [ ] Адаптер VDA 5050 — отдельная нода, **клиент compass_core**, как UI: MQTT ⇄ ROS.
  - `order` → `/compass/nav/start` (маршрут по узлам), `cancelOrder` → `/compass/nav/cancel`,
    `initPosition` → `/initialpose`;
  - `state`, `visualization`, `connection` — из `/compass/status`, `/compass/nav_status`, `/compass/pose`.
- [ ] Аренда для флота (`holder = fms`) и `operatingMode`: `AUTOMATIC` / `MANUAL` / `TEACHIN` /
      `SERVICE`.
- [ ] Раздел конфига `fleet` (брокер, `interfaceName`, версия VDA); identity общий.

UI: «Управляет флот», «Передать флоту», источник задачи в статусе.

Проверка: локальный Mosquitto + fleet-manager → заказ выполняется; оператор перехватил — заказ
отменён, флот видит `MANUAL`; «Передать флоту» — флот снова ведёт робота.

---

## Развёртывание на ПК робота — M (по ходу этапов 1–3)

- [x] Веб-сервер `compass_web` (§5) вместо nginx: статика UI, `/files`, прокси `/rosbridge`.
- [x] Запуск по слоям: драйверы робота отдельно; `compass.launch.py robot_config:=…` =
      `core.launch.py` + `web.launch.py`; конфиги робота — отдельным каталогом (образец `compass_sim/config`).
- [ ] systemd: драйверы → `core.launch.py` → `web.launch.py`; порт 80 — `CAP_NET_BIND_SERVICE`.
- [ ] Перенос с симуляции на робот: свой bringup драйверов, URDF, лидар, одометрия, параметры Nav2.

## Потом

- Сценарии (миссии оркестратора, шаблоны) — пункт меню «Навигация».
- Импорт и экспорт карт (`PUT /files/uploads` + `ImportMap`, `.zip` в браузере).
- Журнал (`/rosout`) и история задач (`list_task_records`).
- Сетевые настройки с автооткатом.
