# Compass — интерфейсы UI ↔ робот (rosbridge)

Контракт v1.5-черновик, 2026-10-28: режимы работы VDA 5050 (§3.1), агент VDA — клиент compass_core, как UI
(§3.6), цели compass_core ставит прямо в Nav2 (§4).
Архитектура всего бортового ПО — `~/fms_robot/ARCHITECTURE.md`; план работ — там же, §8
(этапы в [ROADMAP.md](ROADMAP.md) — более ранняя версия). Заменяет [archive/API_CONTRACT_v0.md](archive/API_CONTRACT_v0.md) (REST + свой WS).
Источник истины для обеих сторон: `compass-ui` (Vue + roslibjs) и `compass_core` (C++, rclcpp).

Статус: **черновик, ждёт ревью Семёна.**

---

## 0. Архитектура

Целиком бортовое ПО описано в `~/fms_robot/ARCHITECTURE.md`. Для UI важно:

```
Браузер (Vue, свой клиент rosbridge)
  │  http://robot/            статика UI, файлы карт и логов, загрузка
  │  ws://robot/rosbridge     протокол rosbridge v2.1 (JSON / CBOR)
  ▼
compass_web ───────┬──────────────────────────────┐
  │ /              │ /files/                      │ /rosbridge → 127.0.0.1:9090
  ▼                ▼                              ▼
dist/ UI     /var/lib/robot/                rosbridge_server (apt, 2.7.x)  
             maps, uploads, logs                    │ ROS 2
                                                    ▼
             compass_core ◄──── /robot/operating_mode, /robot/maps/activate ────► vda5050_adapter ── MQTT ──► fms
             режим, стеки, карты,                                                 (протокол VDA, движение
             конфиг, джойстик, СТОП                                                по рёбрам напрямую в Nav2)
                 │ сервисные цели (SERVICE)                                   │ FollowPath
                 ▼                                                            ▼
             Nav2: navigate_to_pose, follow_waypoints, follow_path (маршрут «по линии»)
```

- **rosbridge** — всё «живое» для UI: состояние, поза, скан, карта, путь, события, команды.
- **compass_web** — веб-сервер робота (вместо nginx): статика UI, файлы карт и логов, загрузка
  при импорте, прокси WebSocket rosbridge. Снаружи робота открыт только он.
- **compass_core** — сервисный узел. UI ходит в Nav2 и slam_toolbox **через него**,
  кроме стандартных топиков `/map`, `/plan`, `/initialpose`.
- **vda5050_adapter** — работа с fms. Для compass_core **клиент**, как UI: езду по order'у заказывает
  через `/compass/nav/start` (§3.6), сам Nav2 не трогает. UI видит агента через два его топика
  (`/vda5050/status`, `/vda5050/path`).

Кто командует роботом, определяет **режим работы** (§3.1) — `operatingMode` VDA 5050.

### Как устроен compass_core

Одна нода (один процесс), запускается systemd при старте ПК и живёт постоянно — стеки
режимов она поднимает и гасит сама. Сервисы и подписки — **тонкие обработчики**: разобрать
запрос → вызвать модуль → заполнить ответ. Вся логика — в модулях:

```
compass_core
├── Operating Mode   режим работы и переходы      ◄─ /robot/set_operating_mode ─► /robot/operating_mode
├── Stack Manager    стеки: launch, готовность, здоровье
├── Control Lease    аренда управления             ◄─ /compass/control/*, /compass/control/heartbeat
├── Teleop Gate      проверка аренды, лимиты       ◄─ /compass/teleop  ─► cmd_vel_teleop
├── Map Library      карты на диске, активная карта ◄─ /compass/mapping/*, /compass/maps/*, /robot/maps/activate
├── Navigation       цели Compass и fms в Nav2 (§4) ◄─ /compass/nav/* ─► /compass/nav_status
├── Config           схема, применение, история    ◄─ /compass/config/*
└── Status           сводка, поза, скан, события   ─► /compass/status, /compass/pose, …
```

Команды с ответом — **сервисы**; потоки без ответа (джойстик, heartbeat, начальная поза) —
**топики**. Ответ сервиса означает «принято / отказ»; фактическое состояние UI всегда берёт из
топиков (`/compass/status`, `/compass/nav_status`) — так все клиенты видят одно и то же.

Обработчики сервисов не должны блокировать executor: долгие вызовы (`map_saver`, `ExecuteTaskV1`) —
асинхронно или в отдельной callback group с `MultiThreadedExecutor`. Таймаут вызова в rosbridge
по умолчанию 5 с; для долгих сервисов (`mapping/save`, `maps/import`) UI передаёт `timeout: 30`.

## 1. Общие правила

### Имена и типы
- Все свои интерфейсы — в пакете **`robot_interfaces`** (общий для compass_core и агента).
  Префиксы: **`/robot/...`** — общее для всего робота (режим, активная карта), **`/compass/...`** —
  сервисная часть, **`/vda5050/...`** — агент.
- Координаты — во фрейме из поля `frame`: `map`, когда работает локализация или SLAM, иначе `odom`.
  Метры, радианы, м/с, рад/с.
- Время — `builtin_interfaces/Time` (в JSON rosbridge: `{ "sec", "nanosec" }`).

### Ответы сервисов
Все сервисы `robot_interfaces` возвращают одинаковую «шапку»:

```
bool success
string error_code   # пусто при success
string message      # для лога; пользователю UI показывает текст по error_code
```

Коды ошибок (UI переводит по коду, RU/EN):

| error_code | Когда |
|---|---|
| `INVALID_INPUT` | неверные аргументы (имя пустое, поз нет, …) |
| `NOT_FOUND` | нет такой карты / версии конфига / стека |
| `CONFLICT` | имя занято, карта используется |
| `MODE_NOT_ALLOWED` | действие недопустимо в текущем режиме |
| `BUSY` | идёт переключение режима или применение конфига |
| `CONTROL_LOCKED` | нет аренды управления или она чужая |
| `TIMEOUT` | нижележащий сервис / action не ответил |
| `INTERNAL` | всё остальное |

Стандартные `std_srvs/Trigger` и `std_srvs/SetBool` отвечают `success` + `message`; при отказе
compass_core кладёт **код ошибки в `message`** (например `MODE_NOT_ALLOWED`).

### QoS — важно
У rosbridge **издатели по умолчанию `reliable` + `transient_local`, глубина 100**. Для команд
это опасно: перезапущенный подписчик получит «повтор» старых команд. Поэтому UI при `advertise`
явно задаёт `volatile`, глубину 1 (§6). Свои латченые топики compass_core публикует с
`transient_local`, глубина 1 — новый клиент сразу получает последнее значение.

---

## 2. Топики

### 2.1 Робот → UI

| Топик | Тип | Частота | QoS издателя | UI подписывается |
|---|---|---|---|---|
| `/robot/operating_mode` | `std_msgs/msg/String` (значения VDA) | при смене | reliable, transient_local, 1 | всегда |
| `/compass/status` | `robot_interfaces/msg/RobotStatus` | при изменении + 1 Гц | reliable, transient_local, 1 | всегда |
| `/compass/pose` | `robot_interfaces/msg/RobotPose` | 10 Гц | best_effort, volatile | Управление, Картографирование |
| `/compass/scan_points` | `robot_interfaces/msg/ScanPoints` | 5 Гц | best_effort, volatile | там же, `compression: cbor` |
| `/compass/nav_status` | `robot_interfaces/msg/NavStatus` | при изменении + 2 Гц пока цель активна | reliable, transient_local, 1 | Управление |
| `/compass/events` | `robot_interfaces/msg/Event` | по событию | reliable, volatile, 50 | всегда |
| `/compass/config/changed` | `robot_interfaces/msg/ConfigChanged` | при `apply` | reliable, transient_local, 1 | Настройки |
| `/map` | `nav_msgs/msg/OccupancyGrid` | slam_toolbox / map_server | reliable, transient_local | `compression: cbor`, `throttle_rate: 1000` |
| `/plan` | `nav_msgs/msg/Path` | planner_server | — | `throttle_rate: 500` |
| `/optimal_trajectory` | `nav_msgs/msg/Path` | controller_server (MPPI) — куда ведёт робота сейчас | — | слой «Траектория контроллера», `throttle_rate: 200` |
| `/particle_cloud` | `nav2_msgs/msg/ParticleCloud` | AMCL | — | слой «Частицы локализации», `compression: cbor`, `throttle_rate: 1000` |
| `/local_costmap/costmap` | `nav_msgs/msg/OccupancyGrid` | локальная карта стоимости (вокруг робота) | — | слой, `compression: cbor`, `throttle_rate: 500` |
| `/global_costmap/costmap` | `nav_msgs/msg/OccupancyGrid` | глобальная карта стоимости | — | слой, `compression: cbor`, `throttle_rate: 2000` |
| `/vda5050/status` | `robot_interfaces/msg/VdaStatus` | при изменении + 1 Гц | reliable, transient_local, 1 | всегда |
| `/vda5050/path` | `nav_msgs/msg/Path` | при новом order'е / update'е | reliable, transient_local, 1 | Управление |
| `/behavior_tree_log` | `nav2_msgs/msg/BehaviorTreeLog` | bt_navigator, при смене состояний | — | Управление, без троттлинга |
| `/rosout` | `rcl_interfaces/msg/Log` | все ноды | reliable | Журнал |

Слои карты «Управления» (кнопка «Слои») включаются и выключаются в UI, выбор хранится в браузере.
Карты стоимости, частицы и траектория — подписка, только пока слой включён: это самые тяжёлые потоки.

Заметки:
- **`/robot/operating_mode`** — публикует только compass_core; значения — строки `operatingMode`
  VDA 5050 (§3.1). Тот же топик читает агент.
- **`/compass/pose`** — compass_core берёт TF `map→base_link` (без локализации — `odom→base_link`)
  и скорость из одометрии. TF в браузер не тянем.
- **`/vda5050/status`, `/vda5050/path`** — публикует агент: связь с fms, order, узел, base-маршрут.
- **`/compass/scan_points`** — скан, уже переведённый в мировые координаты фрейма позы
  и прореженный (~360 точек). Так UI не нужны TF лазера.
- **`/map`** — UI рисует `OccupancyGrid` сам (CBOR: `data` приходит как `Int8Array`).
  Большие карты: `max_message_size` rosbridge по умолчанию 10 МБ — карта 3000×3000 (9 МБ)
  ещё влезает, больше — поднять параметр.
  **UI подписывается, только когда издатель уже есть** (`TEACH_IN`, `state: ready`): rosbridge
  выбирает QoS подписки по издателям в момент подписки, а slam_toolbox публикует `/map` лишь при
  изменениях. Подписка до запуска SLAM получится volatile — и пока робот стоит, карты не будет.
- **`/plan`** — путь планировщика Nav2 для сервисных целей; пустой `poses` — пути нет.
- **`/behavior_tree_log`** — переходы узлов дерева поведения Nav2. UI держит множество узлов в
  `RUNNING` и показывает «Nav2 сейчас: …» по приоритету: `Spin`, `BackUp`/`DriveOnHeading`,
  `Wait`, `Clear*` (восстановления) → `ComputePath*` (планирует) → `FollowPath` (едет). Имена —
  из стандартного дерева `navigate_to_pose_w_replanning_and_recovery.xml`.
- **`/rosout`** — логи всех нод, экран «Журнал». Фильтр по уровню, группе нод и тексту — в
  браузере, хранятся последние 2000 строк вкладки. Что было до открытия — `/compass/logs/history`.
  Не попадает вывод мимо логгера ROS (`print`, сообщения самого `ros2 launch`).

### 2.2 UI → робот

| Топик | Тип | Частота | Кто может |
|---|---|---|---|
| `/compass/teleop` | `robot_interfaces/msg/TeleopCommand` | 10 Гц, пока джойстик отклонён | только с действующей арендой |
| `/compass/control/heartbeat` | `robot_interfaces/msg/ControlHeartbeat` | 2 Гц, пока аренда у клиента | владелец аренды |
| `/initialpose` | `geometry_msgs/msg/PoseWithCovarianceStamped` | по действию «Поза» | любой (только в `SERVICE`) |

`/initialpose` — стандартный вход AMCL, ковариация как у RViz:
`covariance[0] = covariance[7] = 0.25`, `covariance[35] = 0.06853891909122467`.

---

## 3. Сервисы `compass_core`

| Сервис | Тип | Аренда | Назначение |
|---|---|---|---|
| `/compass/ping` | `std_srvs/srv/Trigger` | — | раз в 2 с; по времени ответа UI считает задержку (кружок + мс) |
| `/compass/get_info` | `GetInfo` | — | имя, серийник, версии, возможности |
| `/robot/set_operating_mode` | `SetOperatingMode` | — | сменить режим работы (асинхронно, ход — в `status.transition`) |
| `/robot/maps/activate` | `ActivateMap` | — | загрузить карту для локализации (Compass в `SERVICE`; агент по команде fms) |
| `/compass/stop` | `std_srvs/srv/Trigger` | — | СТОП: блокировка twist_mux, обнулить teleop, отмена цели Compass (§4.5) |
| `/compass/stop/release` | `std_srvs/srv/Trigger` | — | снять СТОП |
| `/compass/control/acquire` | `AcquireControl` | — | взять / перехватить управление |
| `/compass/control/release` | `ReleaseControl` | владелец | отдать |
| `/compass/mapping/set_paused` | `std_srvs/srv/SetBool` | — | пауза приёма сканов в SLAM (`TEACH_IN`); код ошибки — в `message` |
| `/compass/mapping/save` | `SaveMap` | — | сохранить карту (PGM+YAML+posegraph) |
| `/compass/maps/list` | `ListMaps` | — | библиотека карт |
| `/compass/maps/rename` | `RenameMap` | — | переименовать |
| `/compass/maps/delete` | `DeleteMap` | — | удалить (`CONFLICT`, если используется) |
| `/compass/maps/import` | `ImportMap` | — | зарегистрировать загруженные файлы (§5) |
| `/compass/nav/start` | `NavStart` | **владелец** (`source` compass) | цель или маршрут: Compass — в `SERVICE`, агент (`source` fms) — в `AUTOMATIC` (§3.4) |
| `/compass/nav/cancel` | `std_srvs/srv/Trigger` | — | отменить текущую цель |
| `/compass/events/history` | `GetEvents` | — | последние события (до 200, в памяти и в `{data_dir}/events.jsonl`) — лента после перезагрузки страницы |
| `/compass/logs/history` | `GetLogs` | — | WARN+ из `/rosout`, последние 1000 (память + файлы `logs/`, переживают перезапуск); то же сообщение ноды — не чаще раза в минуту |
| `/compass/config/*` | `JsonCall` | — | конфигурация, §3.5 |
| `/compass/system/restart_stack` | `RestartStack` | — | перезапустить стек |
| `/compass/system/reboot` | `std_srvs/srv/Trigger` | — | перезагрузить ПК робота |
| `/compass/system/shutdown` | `std_srvs/srv/Trigger` | — | выключить |

### 3.1 Режим работы

Кто командует роботом — `operatingMode` VDA 5050. Подробно — `~/fms_robot/ARCHITECTURE.md` §3.

- **`/robot/operating_mode`** — текущий режим (строка VDA). Публикует только compass_core.
- **`/robot/set_operating_mode`** (`SetOperatingMode`) — так режим меняет Compass. compass_core
  проверяет условия, переключает стеки и только потом публикует. Ответ сразу («принято»),
  ход перехода — в `status.transition`.

| Режим | Кто командует | Стек | Что можно в Compass |
|---|---|---|---|
| `STARTUP` | никто (после включения) | — | смотреть |
| `AUTOMATIC` | fms через агента | локализация | смотреть, СТОП, «Перехватить» |
| `INTERVENED` | оператор, посреди order'а (order fms сохраняется) | локализация | джойстик |
| `MANUAL` | оператор | локализация | джойстик |
| `SERVICE` | оператор | локализация | джойстик, поза, смена карты, сервисные цели, функции, настройки |
| `TEACH_IN` | оператор | SLAM | картографирование, джойстик |

Переходы:
- `STARTUP` → `SERVICE` — сам, когда поднят базовый стек.
- **«Передать fms»** → `AUTOMATIC`: робот локализован, карта загружена, не `TEACH_IN`, e-stop не
  активен, нет сервисной цели. Иначе `MODE_NOT_ALLOWED` с причиной в `message`.
- **«Перехватить»** из `AUTOMATIC`: есть order — `INTERVENED`, нет — `MANUAL` (UI спрашивает
  подтверждение). Обратно — «Передать fms».
- `SERVICE` ⇄ `TEACH_IN`: compass_core запускает SLAM (`ros2 launch compass_bringup slam.launch.py`)
  дочерним процессом и гасит его при выходе; режим публикуется, когда пришла первая карта
  (таймаут 60 с). Из других режимов в `TEACH_IN` и из `TEACH_IN` не в `SERVICE` — `MODE_NOT_ALLOWED`,
  во время переключения — `BUSY`. Падение стека — событие `STACK_FAILED` (`stack`), не поднялся
  вовремя — `STACK_TIMEOUT`; SLAM — возврат в `SERVICE`.
  `continue_from` — достроить сохранённую карту: slam_toolbox грузит её posegraph. Если это
  активная карта и робот на ней локализован, SLAM стартует с текущей позы робота
  (`map_start_pose`); иначе считает, что робот стоит **там, где эту карту начинали** (`map_start_at_dock`). Выход с несохранённой картой
  UI подтверждает по `status.mapping.unsaved_changes`. В бейдже режима `TEACH_IN` нет — только
  с экрана «Картографирование».
- `MANUAL`, `INTERVENED`, `SERVICE` — между собой свободно (кроме `INTERVENED`: только из `AUTOMATIC`).

**Стеки.** compass_core держит один стек дочерним процессом (`ros2 launch compass_bringup …`):
`slam` в `TEACH_IN` или `nav` (`nav.launch.py`: map_server + AMCL + Nav2 из `nav2_bringup`)
при активной карте — SLAM и AMCL никогда не публикуют `map→odom` одновременно. Вход в `TEACH_IN`
гасит навигацию, выход — поднимает её снова. Процесс `nav` в статусе — два стека:
`localization` (map_server + AMCL) — `running`, когда `lifecycle_manager_localization` отвечает
`is_active` (таймаут 120 с); `navigation` (planner, controller, bt_navigator, …) — запускается с
`autostart: false`, compass_core поднимает его (`manage_nodes STARTUP`), когда у AMCL появилась
поза: без TF `map→odom` костмапы не активируются и lifecycle_manager бросает запуск. До этого
`navigation` — `starting`, цели отклоняются (`BUSY`). Упавшую навигацию compass_core сам не перезапускает —
до новой активации карты (`stacks[nav].state = failed`). Пока стек запускается или
останавливается — `state: switching`.

**Активная карта** (`ActivateMap`): из Compass в любом режиме, кроме `STARTUP` и `TEACH_IN`; в
`AUTOMATIC` — агентом по команде fms. compass_core (пере)запускает навигацию с картой и, если
передана поза, после запуска отдаёт её AMCL (`/initialpose`). Та же карта при работающей
навигации — только поза, без перезапуска: так UI задаёт позу (инструмент «Поза»).
Активная карта хранится в `{data_dir}/active_map` и после перезапуска робота поднимается снова
(позу задаёт оператор). Карта, сохранённая или достроенная в `TEACH_IN`, при выходе становится
активной. Активную карту удалить нельзя (`CONFLICT`).

### 3.2 Аренда управления

Одновременно ведёт робот один клиент. rosbridge не сообщает ROS, от какой вкладки пришло
сообщение, поэтому личность клиента — его собственный `client_id`, а право — `lease_id`:

1. UI создаёт `client_id` (uuid на вкладку) и `client_name` (подпись устройства, «Chrome · Linux»).
2. `acquire(client_id, client_name, force)` → `lease_id`. Если аренда чужая и `force = false` —
   `CONTROL_LOCKED`. С `force = true` старая аренда отзывается, событие `CONTROL_TAKEN`
   с `details: previous_holder_id`.
3. Пока аренда у клиента, он шлёт `heartbeat(lease_id)` **2 Гц**. Нет heartbeat и teleop
   **2 с** — compass_core снимает аренду (закрыли вкладку, пропал Wi-Fi).
4. `TeleopCommand` и `NavStart` проверяются по `lease_id`. Чужой или устаревший `lease_id` —
   teleop игнорируется, `NavStart` отвечает `CONTROL_LOCKED`.
5. `status.control.holder_id` — `client_id` владельца: UI сравнивает со своим и показывает
   «Вы управляете» / «Управляет {holder_name}».

В UI аренда держится, пока открыта вкладка, — и при переходе между экранами. Отдать: кнопка на
экране «Управление» или «✕» у метки «Вы управляете» в верхней панели. Закрытие или перезагрузка
вкладки отдаёт аренду сразу (`pagehide`), иначе её снимет робот через 2 с. Джойстик и клавиатура
работают только на экране «Управление»: при уходе с него ручное движение останавливается.

Аренда нужна только в режимах, где можно ездить джойстиком: `MANUAL`, `INTERVENED`, `SERVICE`,
`TEACH_IN`. В `AUTOMATIC` и `STARTUP` `acquire` отвечает `MODE_NOT_ALLOWED`; чтобы взять робота
у fms, сначала «Перехватить» (§3.1).

Снятие и перехват аренды **не отменяют** сервисную цель — робот доезжает сам. Остановить —
`/compass/nav/cancel` или `/compass/stop`.

### 3.3 Телеуправление и цепочка скоростей

```
UI ─/compass/teleop─► compass_core ─cmd_vel_teleop─► twist_mux ─cmd_vel─► база
                          (проверка аренды,           ▲
                           лимиты из конфига)  Nav2 ─cmd_vel_auto (controller → velocity_smoother →
                                                                    collision_monitor, config/nav2.yaml)
```

Тип скорости — флаг `cmd_vel_stamped` в `compass_core.yaml` робота: `false` — `Twist`, `true` —
`TwistStamped` (ros2_control в Jazzy) у `cmd_vel_teleop` и twist_mux (`use_stamped` задаёт
`core.launch.py` по тому же флагу); Nav2 — `enable_stamped_cmd_vel` в `nav2.yaml` робота.
`holonomic: true` (меканум, омни) — джойстик шлёт `lateral` (UI: Q/E и режим «Вбок»), лимит
`velocity_smoother` по y = `motion.max_linear`; иначе y всегда 0.

`cmd_vel_nav` — внутреннее имя Nav2 для сырого выхода контроллера, поэтому вход twist_mux от Nav2
называется `cmd_vel_auto`. Джойстик идёт мимо collision_monitor (он — часть стека навигации,
которого может не быть).

- compass_core **обрезает** скорость по лимитам из конфига (раздел `motion`) и публикует `Twist`
  в `cmd_vel_teleop` при каждом полученном `TeleopCommand`.
- **Сторожевой таймер — у twist_mux**: `timeout: 0.5` на входе teleop. Перестали приходить
  команды (отпустили джойстик, обрыв связи) — робот стоит.
- Ненулевой teleop во время сервисной цели — compass_core **отменяет её** (`NavStatus.state = canceled`).
- В `AUTOMATIC` Nav2 ведёт compass_core по маршрутам агента (§3.6); джойстик там запрещён режимом.

Пример `twist_mux`:
```yaml
twist_mux:
  ros__parameters:
    topics:
      navigation: { topic: cmd_vel_auto,   timeout: 0.5, priority: 10 }
      teleop:     { topic: cmd_vel_teleop, timeout: 0.5, priority: 100 }
```

### 3.4 Цели и маршруты

Цели ставят двое — `NavStart.source`:
- **`compass`** (или пусто) — оператор Compass, только в `SERVICE`, с действующей арендой;
- **`fms`** — агент VDA 5050, только в `AUTOMATIC`, без аренды: отрезки order'а как маршрут `line`
  (§3.6).

`NavStart`: `kind` = `goal` (одна поза) или `route` (`mode` = `waypoints` | `line`).
compass_core проверяет источник, режим и аренду, ставит цель в Nav2 (§4) и ведёт
`/compass/nav_status` по её прогрессу (`source` — чья цель).

- Перед целью: режим источника, аренда (для `compass`), нет СТОП, стек навигации запущен,
  локализация `ok`, для `compass` — заряд не ниже `battery.min_task_percent`; иначе
  `MODE_NOT_ALLOWED` / `CONTROL_LOCKED` с причиной. Точек — до 100 (`fms` — до 1000).
- Новая цель заменяет предыдущую (§4.2). Смена режима работы отменяет текущую цель: цель Compass
  живёт только в `SERVICE`, цель fms — только в `AUTOMATIC`.
- `NavStatus.error_code` при `failed`: `NO_PATH`, `STUCK` или `NAV_FAILED` — по коду ошибки Nav2 (§4.4).

### 3.5 Конфигурация — `JsonCall`

Схему конфига задаёт робот (`compass_bringup/config/robot_schema.yaml`), UI строит по ней формы,
поэтому сервисы — один тип с JSON внутри строки. Значения — плоские ключи `раздел.поле`.

| Сервис | request_json | response_json |
|---|---|---|
| `/compass/config/get_schema` | `{}` | `{ sections: [ { id, title {ru,en}, fields: [ { key, type, label {ru,en}, help?, unit?, min?, max?, step?, maxLength?, required?, default } ] } ] }` |
| `/compass/config/get` | `{}` | `{ version, values: { "motion.max_linear": 0.5, … } }` |
| `/compass/config/apply` | `{ baseVersion, values, comment, client }` | `{ version, changed: [ключи] }` |
| `/compass/config/history` | `{}` | `[ { version, createdAt (мс), client, comment, changes: [ { key, from, to } ] } ]`, новые сверху |
| `/compass/config/rollback` | `{ version, client }` | как у `apply` |

- `type`: `string` (`maxLength`, `required`) | `number` | `integer` (`min`, `max`, `step`, `unit`).
- `apply` — только изменённые ключи. Проверка — в `apply` (отдельного `validate` нет): ошибки по
  полям → `INVALID_INPUT` и `{ errors: { ключ: { code, message, min?, max? } } }`, коды
  `REQUIRED`, `TOO_LONG`, `NOT_A_STRING`, `NOT_A_NUMBER`, `NOT_INTEGER`, `OUT_OF_RANGE`,
  `UNKNOWN_KEY`, `ORDER` (пороги батареи: критический ≤ минимум для задач ≤ предупреждение).
- `baseVersion` устарел (кто-то применил раньше) → `CONFLICT`. Значения не изменились — версия
  та же. Откат = новая версия со значениями старой.
- `client` — подпись автора в истории (`client_name` вкладки). Аренда не нужна.

**Один файл на всех.** `{data_dir}/config/robot.yaml` (на роботе `/var/lib/robot/config/`) — по
разделам, с `version`; хозяин — compass_core, остальные компоненты только читают. Рядом
`history.jsonl` — строка на версию со всеми значениями. Пока файла нет, compass_core создаёт его
из `default` схемы, а `identity` и `motion` берёт из своих параметров (`compass_core.yaml`).
После `apply` — `/compass/config/changed` (`ConfigChanged`: версия + ключи) и событие `CONFIG_APPLIED`.

| Раздел | Ключи | Как применяется |
|---|---|---|
| `identity` | `name`, `serial_number`, `manufacturer`, `model` | сразу: `get_info`, шапка UI; позже — агент VDA (`serialNumber`, `manufacturer`) |
| `motion` | `max_linear` (м/с), `max_angular` (рад/с) | джойстик — сразу; Nav2 — `velocity_smoother` (`max_velocity`, `min_velocity`) через `set_parameters`, и при каждом подъёме навигации |
| `battery` | `warn_percent`, `min_task_percent`, `critical_percent` | см. ниже |

Пороги батареи (гистерезис 2 %):

| Ключ | Что делает |
|---|---|
| `battery.warn_percent` | событие `BATTERY_LOW` |
| `battery.min_task_percent` | новые цели Compass не принимаются (`NavStart` → `MODE_NOT_ALLOWED`). Задания fms порог не ограничивает: на зарядку робота отправляет fms |
| `battery.critical_percent` | текущая цель Compass (не fms) отменяется, событие `BATTERY_CRITICAL` (позже — робот сам едет на зарядку) |

Отложено: раздел `fms` (брокер MQTT, `interfaceName`; пароль — только в окружении агента,
`$MQTT_PASS`) — вместе с агентом; сеть с автооткатом (`apply_network`, `confirm_network`);
правка сырых YAML (`list_files`, `get_file`, `put_file`).

### 3.6 Агент VDA 5050 и Compass

Агент (`vda5050_adapter`) — **клиент** compass_core, как UI. Протокол VDA (order'а, узлы, action'ы,
state для fms) — в агенте (`~/fms_robot/README.md`); роботом и Nav2 командует только compass_core.
Агент заказывает езду маршрутом «по линии» и получает от него ту же нарезку петель, ожидание перед
препятствием и путь в `/plan`, что и маршрут из Compass. Общие интерфейсы:

| Интерфейс | Кто → кому | Зачем |
|---|---|---|
| `/robot/operating_mode` | compass_core → агент | режим для `state.operatingMode`; агент принимает order'а только в `AUTOMATIC` (в `INTERVENED` order сохраняется) |
| `/compass/nav/start` (`source` fms), `/compass/nav/cancel` | агент → compass_core | ехать по отрезку order'а: от робота через узлы до первого узла, где надо стоять (action) или до конца base; курс в узле — вдоль подъезда. fms продлил base — агент шлёт удлинённый отрезок, compass_core заменяет линию на ходу (§4.2) |
| `/compass/nav_status` | compass_core → агент | итог отрезка: `succeeded` — доехал; `failed` — ошибка `NODE_UNREACHABLE` для fms; `canceled` (СТОП, смена режима) — агент поставит отрезок заново, когда снова можно ехать |
| `/robot/maps/activate` | агент → compass_core | `enableMap`, `initializePosition` с другой картой. Другая карта: в статусе сразу `map` = новая, `localization.status` = `none`, `state` = `switching` до перезапуска навигации; `enableMap` агент завершает, когда снова `ready` |

Для UI агент публикует:
- **`/vda5050/status`** (`VdaStatus`) — связь с брокером, `orderId`, `lastNodeId`, едет / пауза, ошибки;
- **`/vda5050/path`** — base-маршрут от узла, где робот, до конца base (узлы графа; меньше двух узлов —
  пустой): UI рисует его на карте в `AUTOMATIC` и `INTERVENED`.

Узел пройден, когда робот вошёл в его допуск из order'а (`allowedDeviationXY`), — это решает агент,
а не прогресс в `NavStatus`. Цели `source` fms UI не показывает как цель Compass: задание видно в
карточке fms и маршрутом fms на карте, линия — в `/plan`.

UI: карточка **fms** («Обзор», панель «Управления») — связь, задание, ошибки, кнопки «Передать fms» /
«Перехватить»; те же действия — в бейдже режима. «Перехватить» спрашивает подтверждение и выбирает
`INTERVENED` при `order_active`, иначе `MANUAL`. Агента нет (статус не приходил 3 с) — «Агент не запущен».

СТОП из Compass агент видит как `safetyState.eStop = REMOTE` (через блокировку twist_mux и статус
compass_core) — fms узнаёт об остановке по протоколу.

---

## 4. Цели — action'ы Nav2

### 4.1 Как устроено

Цели Compass и агента compass_core ставит **прямо в Nav2** — типизированными action-клиентами
(`navigation.cpp`). До 2026-10-27 между ними стоял `ros2_task_orchestrator` (Python); убран: из
него использовались три action'а Nav2, он не передавал коды ошибок Nav2, не умел заменять цель и
съедал ~60 % CPU во время езды. Допуск (режим, аренда, локализация, СТОП, заряд) compass_core и
так проверял сам.

| kind / mode | Action Nav2 | Сервер |
|---|---|---|
| `goal` | `/navigate_to_pose` (`NavigateToPose`) | bt_navigator |
| `route` / `waypoints` | `/follow_waypoints` (`FollowWaypoints`) — остановка в каждой точке | waypoint_follower |
| `route` / `line` | `/follow_path` (`FollowPath`) — по линии через точки, без остановки | controller_server |

Позы `Pose2D` → `PoseStamped` (`frame_id` = `map_frame`, θ → кватернион, stamp нулевой — последний TF).

**Маршрут «по линии»** (`line`, с 2026-10-27 вместо `through_poses`). `navigate_through_poses` не
держит линию маршрута: раз в секунду планировщик строит новый путь от робота к оставшимся точкам,
точка засчитана, если робот прошёл в `radius` от неё, — в комнате с точками через 0,5 м робот
срезал на 20–45 см. Поэтому compass_core сам строит ломаную: от позы робота через точки, шаг 5 см,
ориентация вдоль отрезков, в последней точке — её θ; и отдаёт её контроллеру (`FollowPath`),
без планировщика (так же едут отрезки order'а fms, §3.6). Этот путь compass_core публикует
в `/plan` — на карте Compass он рисуется так же, как путь планировщика. Прогресс (`index`,
`distance_remaining`) — проекция позы робота на линию: `distance_to_goal` контроллера для этого
не годится (завышен в начале, замирает на поворотах).

- **Препятствия.** MPPI обходит мелкие, если рядом есть место, и возвращается на линию. Перед
  непроходимым встаёт (collision_monitor); контроллер через ~10 с сдаётся — compass_core перезапускает
  остаток части от позы робота, до 6 раз (около минуты), потом `failed` / `STUCK`. Число
  перезапусков — в `NavStatus.recoveries`.
- **Петли.** MPPI и goal_checker в Jazzy меряют расстояние до конца пути по прямой: если линия задолго
  до конца проходит ближе `threshold_to_consider` (GoalCritic, PathFollowCritic) к нему, робот поехал
  бы прямо к концу. Поэтому линия режется на части в точке, после которой она подошла бы к концу
  части ближе `route_loop_gap` (`compass_core.yaml`, не меньше этого порога); части едут подряд,
  на стыке короткое торможение.

Функции робота (докинг, лифт, зарядка), когда появятся, — так же: типизированный клиент своего
action'а (для докинга — `DockRobot` из Nav2) в compass_core или в агенте.

### 4.2 Постановка и замена

- **Ответ `NavStart`** — когда Nav2 принял цель: `success` + `goal_id` (его выдаёт compass_core).
  Nav2 отклонил — `INTERNAL`; не ответил за 5 с — `INTERNAL` («Nav2 не ответил на цель»), а если
  он примет её позже, compass_core её сразу отменит.
- **Новая цель заменяет предыдущую**: compass_core отменяет прежнюю и отправляет новую через
  0,3–0,8 с после того, как Nav2 её завершил. Сразу нельзя: `follow_waypoints` отвечает «отменено»
  раньше, чем bt_navigator закончил свою `navigate_to_pose`, — цель в эти миллисекунды
  прерывается. Прежняя не завершилась за 5 с — `BUSY`.
- **Исключение — линия того же источника.** Если идёт маршрут `line` и приходит новый `line` с тем же
  `source` (агент продлил отрезок, оператор поправил маршрут), compass_core сразу отдаёт контроллеру
  новый путь от робота: контроллер заменяет его на ходу, робот не тормозит. Новый `goal_id`; ответы
  Nav2 на прежнюю цель отбрасываются.
- Отмена, пришедшая раньше, чем Nav2 принял цель, выполняется сразу после приёма.

### 4.3 Прогресс

Feedback Nav2 → `/compass/nav_status`, не чаще 2 Гц:

| Action | Поля Nav2 → `NavStatus` |
|---|---|
| `navigate_to_pose` | `distance_remaining`, `estimated_time_remaining` → `eta`, `number_of_recoveries` → `recoveries` |
| `follow_path` (`line`) | поза робота проецируется на линию (окно −0.3…+1 м от прошлого положения) → `distance_remaining`; `index` — первая точка, до которой не доехали по линии (с запасом 15 см); `eta = остаток / speed` |
| `follow_waypoints` | `current_waypoint` → `index`; расстояния в feedback нет → `distance_remaining = -1` (UI скрывает) |

### 4.4 Итог и коды ошибок

| Результат action'а | `NavStatus.state` | Событие |
|---|---|---|
| `SUCCEEDED` | `succeeded` | `NAV_GOAL_SUCCEEDED` или `NAV_WAYPOINTS_MISSED` |
| `CANCELED` | `canceled` | `NAV_GOAL_CANCELED` |
| `ABORTED` | `failed` | `NAV_GOAL_FAILED` (`code`, `nav2_code`) |

`error_code` результата Nav2 → `NavStatus.error_code` по сотням (`nav2_msgs/action`); bt_navigator
передаёт коды серверов из `error_code_names` (`nav2.yaml`: `compute_path_error_code`,
`follow_path_error_code`):

| Код Nav2 | Сервер | `NavStatus.error_code` |
|---|---|---|
| 2xx, 3xx | планировщик: нет пути, старт / цель в препятствии или вне карты | `NO_PATH` |
| 1xx, 7xx | контроллер (нет прогресса, нет допустимой скорости), восстановления | `STUCK` |
| прочее | | `NAV_FAILED` |

Текст Nav2 — в `error_message`; в Jazzy он обычно пуст — тогда `Nav2 error <код>`.

`follow_waypoints` с `stop_on_failure: false` заканчивается `SUCCEEDED`, даже если пропустил точки
(`missed_waypoints`) — тогда событие `NAV_WAYPOINTS_MISSED` (warning) с номерами точек (с 1).

Навигация остановилась во время цели (смена карты, падение стека) — результата Nav2 уже не будет:
compass_core сам ставит `canceled`.

### 4.5 СТОП и отмена

- `/compass/stop` → блокировка twist_mux (`locks.stop`: `compass_stop_lock`, `std_msgs/Bool`,
  приоритет 255 — ни джойстик, ни Nav2) + обнулить teleop + отмена текущей цели (и fms). Агент видит
  `status.estop`, новых отрезков не шлёт и сообщает fms `safetyState.eStop = REMOTE`. Пока СТОП нажат:
  `status.estop = true`, цели отклоняются (`MODE_NOT_ALLOWED`). Снимается `/compass/stop/release`
  (в UI кнопка становится «Снять СТОП», с подтверждением). События `STOP_PRESSED`, `STOP_RELEASED`.
- `/compass/nav/cancel` → отмена goal Nav2 (`async_cancel_goal`).
- Цель отменяется также: ненулевым teleop, сменой режима из `SERVICE`, активацией другой карты,
  стартом картографирования, `BATTERY_CRITICAL`.

Action'ы Nav2 UI сам не вызывает — они закрыты белыми списками rosbridge; только через
compass_core (аренда).

---

## 5. HTTP (compass_web)

Веб-сервер робота — нода `compass_web` (пакет `compass_web`, Python + Tornado из зависимостей
rosbridge, отдельного веб-сервера ставить не нужно). Запускается в `web.launch.py` (входит в `compass.launch.py`), параметры —
`compass_web.yaml` в каталоге конфигов робота (`robot_config`, образец — `compass_sim/config`): `port` (8080; на роботе 80 —
`AmbientCapabilities=CAP_NET_BIND_SERVICE` в unit-файле), `ui_dir` (собранный `dist/`),
`rosbridge_url`, `ros_log_dir`, `max_upload_mb`; `data_dir` — из launch, общий с compass_core.
В разработке Vite проксирует `/rosbridge` и `/files` на него же — dev и робот работают одинаково.

| Путь | Метод | Что |
|---|---|---|
| `/` и всё неизвестное | GET | статика UI; **SPA fallback** на `index.html` |
| `/rosbridge` | WS | прокси на `127.0.0.1:9090` |
| `/files/maps/{id}/{map.yaml, map.pgm, map.posegraph, map.data}` | GET | файлы карты; превью UI рисует из `map.pgm`, экспорт `.zip` собирает в браузере |
| `/files/logs/` | GET | журнал compass_core: WARN+ со всех нод, `compass-YYYY-MM-DD.log` (JSON-строки), 7 дней; каталог — JSON-листингом |
| `/files/ros_log/` | GET | логи ROS 2 (`ROS_LOG_DIR`): файл на процесс ноды + папка на запуск с `launch.log`; «Журнал → Скачать логи» собирает zip за период по `mtime` |
| `/files/uploads/{upload_id}/{map.yaml, map.pgm, map.posegraph, map.data}` | PUT | загрузка для импорта (из `.zip` экспорта или отдельных файлов); затем `/compass/maps/import` |

Каталоги на чтение отдаются JSON-листингом (формат nginx `autoindex_format json`):
`[{ name, type: file | directory, mtime, size }]`. Путь не может выйти за каталог (`../` → 404),
`uploads` — только PUT, остальное — только GET.

Хранилище — общее для compass_core и compass_web:
```
/var/lib/robot/
  maps/{id}/map.yaml, map.pgm, map.posegraph, map.data, meta.yaml
  uploads/{upload_id}/...        # compass_core чистит после импорта и по возрасту (> 1 ч)
  logs/compass-YYYY-MM-DD.log    # журнал WARN+, compass_core чистит старше 7 дней
  ros_log/                       # ROS_LOG_DIR сервиса; чистит systemd-tmpfiles (14 дней)
  active_map, events.jsonl
```

- `map.pgm` + `map.yaml` — как у map_saver (trinary), но `free_thresh: 0.196`: при 0.25
  «неизвестно» (205) map_server читал бы как свободное (1 − 205/255 ≈ 0.196 < 0.25).
- `map.posegraph` + `map.data` — `/slam_toolbox/serialize_map`; без них карту можно только
  использовать, но не продолжить (`has_posegraph = false`).
- `meta.yaml` — имя, размер, origin, время создания и изменения.
- В симуляции `data_dir` — `~/.local/share/compass` (`compass_sim sim.launch.py`).

## 6. rosbridge: запуск и белые списки

**Версия:** rosbridge из apt для Jazzy (`ros-jazzy-rosbridge-server`, 2.7.x). Ветка `ros2` из
исходников (4.2.1) требует `rosidl_pycommon.interface_base_classes` — его в Jazzy нет, нода не
стартует (проверено 2026-10-24).

**Запуск — своим launch-файлом в `compass_bringup`, не штатным.** Белые списки — параметры ноды
`rosbridge_websocket`; `actions_glob` штатный launch не пробрасывает.
Штатный launch ещё и запускает `rosapi`, а rosbridge **сам разрешает `/rosapi/*`** — через него
видны все топики и сервисы робота. Поэтому запускаем только ноду `rosbridge_websocket`:

Слушает только localhost — снаружи доступен лишь через `compass_web` (`/rosbridge`). Разрешено ровно то, что нужно UI.

```yaml
# параметры ноды rosbridge_server/rosbridge_websocket (в launch compass_bringup)
address: "127.0.0.1"
port: 9090
topics_sub_glob: "[/robot/operating_mode, /compass/status, /compass/pose, /compass/scan_points, /compass/nav_status, /compass/events, /compass/config/changed, /behavior_tree_log, /vda5050/status, /vda5050/path, /map, /plan, /optimal_trajectory, /particle_cloud, /local_costmap/costmap, /global_costmap/costmap, /rosout]"
topics_pub_glob: "[/compass/teleop, /compass/control/heartbeat, /initialpose]"
services_glob: "[/compass/*, /robot/set_operating_mode, /robot/maps/activate]"
actions_glob: "[]"
params_glob: "[]"
```

**Внимание: пустая строка = «разрешено всё».** Запрет — только явным `"[]"` (так устроен
`parse_glob_string` в rosbridge_server, проверено в 2.7.x).

UI при `advertise` своих топиков задаёт QoS:
```json
{ "op": "advertise", "topic": "/compass/teleop", "type": "robot_interfaces/msg/TeleopCommand",
  "qos": { "reliability": "reliable", "durability": "volatile", "history": "keep_last", "depth": 1 } }
```
То же для `/compass/control/heartbeat` и `/initialpose`.

---

## 7. `robot_interfaces`

### msg

```
# Pose2D.msg — поза на плоскости
float64 x
float64 y
float64 theta
```

```
# RobotStatus.msg — /compass/status
builtin_interfaces/Time stamp
string operating_mode            # как /robot/operating_mode: STARTUP | AUTOMATIC | INTERVENED | MANUAL | SERVICE | TEACH_IN
string state                     # ready | switching | error
Transition transition            # active = false, если не переключаемся
MapRef map                       # TEACH_IN — карта, которую строим (id пустой — новая); иначе — активная
Localization localization
Battery battery
ControlState control
bool estop
StatusError[] errors
MappingState mapping             # active = false вне TEACH_IN
StackState[] stacks              # [slam] в TEACH_IN, [localization, navigation] с активной картой, [] — ничего
```

```
# Transition.msg
bool active
string from_mode
string to_mode
string step                      # starting_stack | stopping_stack
string stack                     # slam | nav
builtin_interfaces/Time started_at
```

```
# MapRef.msg
string id                        # uuid
string name
```

```
# Localization.msg — по /amcl_pose: σ = √max(cov_xx, cov_yy); ok — σ и σ_θ < 0.6, lost — σ ≥ 2 м
string status                    # ok | uncertain | lost | none (навигация не запущена или позы ещё не было)
float32 covariance               # σ положения, м
```

```
# Battery.msg — из топика батареи робота
bool present                     # false — данных нет, UI пишет «Нет данных»
float32 percent                  # 0..100
float32 voltage
bool charging
```

```
# StackState.msg
string name                      # slam | localization | navigation
string state                     # starting | running | stopping | failed
```

```
# ControlState.msg
string holder_id                 # client_id владельца; пусто — управление свободно
string holder_name
```

```
# StatusError.msg
string code
string message
diagnostic_msgs/KeyValue[] details
```

```
# MappingState.msg
bool active
bool paused
bool unsaved_changes             # карта (/map) изменилась после последнего save; робот стоит — не меняется
```

```
# RobotPose.msg — /compass/pose
builtin_interfaces/Time stamp
string frame                     # map | odom
float64 x
float64 y
float64 theta
float32 linear                   # фактическая, м/с
float32 angular                  # рад/с
```

```
# ScanPoints.msg — /compass/scan_points
builtin_interfaces/Time stamp
string frame
float32[] points                 # x0, y0, x1, y1, … в мировых координатах frame
```

```
# NavStatus.msg — /compass/nav_status
string goal_id                   # id цели, выдаёт compass_core; пусто — цели не было
string source                    # compass — оператор Compass | fms — агент VDA 5050
string operator_name             # для source = compass — client_name владельца аренды; для fms — пусто
string kind                      # goal | route
string mode                      # waypoints | line (для route)
Pose2D[] poses                   # для goal — одна
uint32 index                     # к какой точке едем
string state                     # active | succeeded | failed | canceled
float32 distance_remaining       # м до конца; -1 — неизвестно (UI не показывает)
float32 eta                      # с
uint16 recoveries
string error_code                # NO_PATH | STUCK | NAV_FAILED (по коду ошибки Nav2); пусто без ошибки
string error_message
```

```
# Event.msg — /compass/events
string id
builtin_interfaces/Time stamp
string level                     # info | warning | error
string code                      # MODE_CHANGED, MAP_SAVED, NAV_GOAL_SUCCEEDED, … (архив §9)
string message
diagnostic_msgs/KeyValue[] details
```

```
# ConfigChanged.msg — /compass/config/changed (reliable, transient_local, 1)
# при старте compass_core — текущая версия и пустой changed_keys
uint32 version
string[] changed_keys            # например ["battery.min_task_percent"]
```

```
# VdaStatus.msg — /vda5050/status (публикует агент; при изменении и раз в секунду)
string connection                # ONLINE | OFFLINE — связь агента с брокером fms
string order_id                  # пусто — order'ов ещё не было; после завершения остаётся последний
uint32 order_update_id
bool order_active                # order выполняется (робот не idle, VDA 6.6.8): «Перехватить» → INTERVENED
string last_node_id
bool driving
bool paused
bool new_base_request            # робот на decision point, ждёт продления маршрута от fms
StatusError[] errors             # ошибки VDA: code — errorType, message — errorDescription
```

```
# MapInfo.msg
string id
string name
uint32 width                     # px
uint32 height
float32 resolution               # м/px
Pose2D origin                    # как origin в map.yaml
bool has_posegraph               # можно продолжить картографирование
uint64 size_bytes
builtin_interfaces/Time created_at
builtin_interfaces/Time updated_at
```

```
# TeleopCommand.msg — /compass/teleop
string lease_id
float32 linear                   # м/с, compass_core обрежет по лимитам
float32 angular                  # рад/с
float32 lateral                  # м/с вбок, влево — плюс; только у робота с capability holonomic
```

```
# ControlHeartbeat.msg — /compass/control/heartbeat
string lease_id
```

### srv

Шапка ответа `success / error_code / message` — во всех.

```
# GetInfo.srv
---
bool success
string error_code
string message
string robot_name
string serial_number
string manufacturer
string model
float32 robot_radius                         # м, параметр robot_radius compass_core — значок робота на карте
diagnostic_msgs/KeyValue[] versions          # compass, ros, firmware, …
string[] capabilities                        # mapping, navigation, continue_mapping, scan_stream, holonomic
```

```
# SetOperatingMode.srv — /robot/set_operating_mode
string mode                                  # строка VDA: AUTOMATIC | INTERVENED | MANUAL | SERVICE | TEACH_IN
string continue_from                         # для TEACH_IN: id карты, которую достраиваем; пусто — новая
---
bool success
string error_code
string message                               # причина отказа для человека («робот не локализован»)
```

```
# ActivateMap.srv — /robot/maps/activate
string map_id
bool has_initial_pose
Pose2D initial_pose
---
bool success
string error_code
string message
```

```
# AcquireControl.srv
string client_id
string client_name
bool force
---
bool success
string error_code
string message
string lease_id
```

```
# ReleaseControl.srv
string lease_id
---
bool success
string error_code
string message
```

```
# SaveMap.srv — /compass/mapping/save (TEACH_IN, есть карта; UI ждёт до 30 с)
# Имя занято другой картой: overwrite=false — CONFLICT, true — перезаписать её.
# Новое имя — новая карта (прежняя остаётся); имя текущей — пересохранить её.
string name                                  # 1..64 символа
bool overwrite
---
bool success
string error_code
string message
MapInfo map
```

```
# ListMaps.srv
---
bool success
string error_code
string message
MapInfo[] maps                               # новые сверху
```

```
# RenameMap.srv
string id
string name
---
bool success
string error_code
string message
MapInfo map
```

```
# DeleteMap.srv — CONFLICT, если карту сейчас строят
string id
---
bool success
string error_code
string message
```

```
# ImportMap.srv
string upload_id                             # каталог /var/lib/robot/uploads/{upload_id}: map.yaml + map.pgm (P5),
                                             # по желанию map.posegraph + map.data; [0-9a-zA-Z-]
string name                                  # CONFLICT, если занято
---
bool success
string error_code
string message
MapInfo map
```

```
# NavStart.srv
string source                                # compass (пусто — тоже) | fms
string lease_id                              # для compass
string kind                                  # goal | route
string mode                                  # waypoints | line (для route)
Pose2D[] poses                               # 1..100 (fms — до 1000)
---
bool success
string error_code
string message
string goal_id
```

```
# GetLogs.srv — /compass/logs/history
uint8 min_level                              # 30 (WARN) и выше; меньше — как 30
uint32 limit                                 # 0 — все
---
bool success
string error_code
string message
rcl_interfaces/Log[] entries                 # новые в конце; stamp — время получения по часам робота
```

```
# GetEvents.srv
uint16 limit
---
bool success
string error_code
string message
Event[] events                               # новые первыми; stamp — по часам робота (не sim time)
```

```
# RestartStack.srv
string stack
---
bool success
string error_code
string message
```

```
# JsonCall.srv
string request_json
---
bool success
string error_code
string message
string response_json
```

---

## 8. Что меняется по сравнению с v0

- Нет своего REST и своего WS: **rosbridge + compass_web** (файлы и прокси). Писать на C++ — только `compass_core`.
- `clientId` больше не id WS-сессии: клиент сам себя называет, право подтверждает `lease_id`,
  жизнь аренды — heartbeat.
- Сторожевой таймер джойстика — **twist_mux**, а не свой код.
- Карта в UI — `nav_msgs/OccupancyGrid` с топика `/map` (CBOR), а не PNG по ревизиям.
  PNG остаётся только для превью в библиотеке.
- Путь — стандартный `/plan`. Начальная поза — стандартный `/initialpose`.
- Экспорт карты — UI собирает `.zip` из файлов; импорт — `PUT` файлов + `ImportMap`.
- Задачи движения исполняет **ros2_task_orchestrator** (§4); в compass_core вместо action-клиентов
  Nav2 — один клиент `ExecuteTaskV1`. `NavStatus` дополнен `source` и `operator_name`.

v1.3 (2026-10-24):
- Режимы `idle` / `mapping` / `navigation` заменены **режимом работы VDA 5050** (§3.1):
  `/robot/operating_mode`, `/robot/set_operating_mode`, `SetMode` → `SetOperatingMode` + `ActivateMap`.
- Агент VDA — **сосед** compass_core (§3.6); «аренда для fms» убрана — её роль играет `AUTOMATIC`.
- Оркестратор — только сервисные цели (`SERVICE`) и функции робота; движение агента — мимо него.
- Пакет `compass_interfaces` → **`robot_interfaces`**; хранилище `/var/lib/compass` → `/var/lib/robot`;
  раздел конфига `fleet` → `fms`. Новые: `VdaStatus`, `/vda5050/path`.

v1.4 (2026-10-27):
- `ros2_task_orchestrator` убран: compass_core ставит сервисные цели прямо в Nav2 (§4). Настоящие
  коды ошибок (`NO_PATH`, `STUCK`), замена цели без очереди; нет `tasks.yaml`, `tasks.db`,
  `/task_orchestrator/*` в белых списках.
- Маршрут `through_poses` (NavigateThroughPoses) заменён на `line`: ломаная через точки в `FollowPath`
  контроллера (§4.1) — робот едет точно по линии, а не срезает.

v1.5 (2026-10-28):
- Агент VDA — **клиент** compass_core, как UI (§3.6): `NavStart.source` (`compass` | `fms`), цели fms —
  только в `AUTOMATIC`, без аренды. Агент больше не ставит `FollowPath` сам.
- Маршрут `line` того же источника заменяется на ходу, без остановки (§4.2). Смена режима отменяет
  текущую цель.

## 9. Открытые вопросы к Семёну

1. Аппаратный E-stop: есть ли сигнал, чтобы заполнять `status.estop`?
2. Батарея: какой топик и тип (`sensor_msgs/BatteryState`?) — compass_core переводит в `Battery`.
3. Цепочка скоростей (§3.3): совпадает с вашим bringup или там уже другие имена топиков?

Вопросы по архитектуре робота (`INTERVENED`, `mapId` с робота в fms, нужны ли сервисные цели) —
в `~/fms_robot/ARCHITECTURE.md` §9.

### Решено

| Дата | Вопрос | Решение |
|---|---|---|
| 2026-10-02 | Задачи от флота | да, агент VDA 5050 в разработке |
| 2026-10-24 | Агент и compass_core | соседи; кто командует — режим работы VDA (§3.1, §3.6) |
| 2026-10-27 | task_orchestrator | убран: цели прямо в Nav2 из compass_core (§4) |
| 2026-10-28 | Агент и compass_core | агент — клиент compass_core, как UI: Nav2 командует только compass_core (§3.6) |
| 2026-10-24 | HTTP на роботе | ~~nginx~~ → нода `compass_web` (Tornado): статика, файлы, прокси WebSocket rosbridge; без лишнего пакета при развёртывании |
| 2026-10-24 | SLAM в TEACH_IN | дочерний процесс compass_core (`slam.launch.py`), свой на каждый вход |
| 2026-10-24 | Сохранение карты | compass_core сам пишет PGM+YAML из `/map`, posegraph — `serialize_map`; без `map.png`: превью UI рисует из `map.pgm` |
| 2026-10-02 | Порог батареи | настраивается в Compass, общий файл конфига для всех компонентов (§3.5) |
