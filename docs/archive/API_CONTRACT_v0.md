# API Contract v0 (REST + WS) — АРХИВ

> **Устарел 2026-10-01.** Взаимодействие переведено на rosbridge — актуальный контракт в
> [../ROS_INTERFACES.md](../ROS_INTERFACES.md). Файл оставлен ради форматов JSON конфигурации (§7),
> на которые ссылается новый контракт, и как история решений.

Черновик v0.2, 2026-10-01. Источник истины для обеих сторон: `compass-ui` (Vue) и
`compass_web` (C++, Boost.Beast + rclcpp). Мок-сервер в `compass-ui` повторяет этот
контракт один в один.

Статус: черновик. Решения Семёна от 2026-10-01 учтены: без авторизации в v1, цели Nav2
во время картографирования — позже, скан лидара — в v1, id карт — uuid, батарея — из топика робота.

---

## 0. Общее

### Транспорт

| Канал | Адрес | Для чего |
|---|---|---|
| HTTP | `/api/*` | команды и запросы (разовые действия с результатом) |
| WebSocket | `/ws` | потоки: статус, поза, карта, путь, события, джойстик |
| HTTP | `/*` | статика Vue; любой неизвестный путь вне `/api` и `/ws` → `index.html` (SPA fallback) |

- UI раздаётся с того же адреса, что и API, поэтому **CORS в продакшене не нужен**.
  В разработке Vite проксирует `/api` и `/ws` на робота, CORS тоже не нужен.
- JSON, UTF-8, `Content-Type: application/json`.
- Время — ISO 8601 с таймзоной (`2026-10-01T10:15:00+03:00`).
- Расстояния — метры, углы — радианы, скорости — м/с и рад/с.
- Все координаты — во фрейме `map` (если карты нет, то `odom`; см. поле `frame`).

### Формат ошибок

Любой ответ не 2xx:

```json
{
  "code": "MODE_NOT_ALLOWED",
  "message": "Cannot start navigation without a map",
  "details": { "mode": "idle" }
}
```

- `code` — машинная строка. **UI переводит по `code`** (RU/EN); `message` — запасной
  вариант на английском, если код UI неизвестен. HTTP-коды пользователю не показываются.
- `details` — необязательно.

Общие коды:

| code | HTTP | Когда |
|---|---|---|
| `INVALID_INPUT` | 400 | не прошла валидация; в `details` — `{ field: reason }` |
| `NOT_FOUND` | 404 | нет такой карты / версии конфига и т.п. |
| `CONFLICT` | 409 | имя занято, объект используется |
| `MODE_NOT_ALLOWED` | 409 | действие недопустимо в текущем режиме |
| `BUSY` | 409 | идёт переключение режима или применение конфига |
| `CONTROL_LOCKED` | 409 | управление удерживает другой клиент |
| `TIMEOUT` | 504 | ROS-сервис не ответил вовремя |
| `INTERNAL` | 500 | всё остальное |

### Авторизация

**В v1 авторизации нет.** Любой, кто открыл UI в сети робота, может всё.
Защита — на уровне сети (робот в закрытой сети/VLAN).

Позже: роли `viewer` / `operator` / `admin`, токен в заголовке `Authorization: Bearer`,
по WS — первым сообщением `auth` (не в URL). Поле `info.authRequired` уже есть,
чтобы UI мог включить экран входа без смены контракта.

---

## 1. Система

#### `GET /api/health`
`200 {}` — сервер жив. Используется индикатором связи вместе с ping по WS.

#### `GET /api/info`
Статические сведения о роботе.

```json
{
  "robotName": "AMR-01",
  "serialNumber": "SN-000123",
  "manufacturer": "Acme",
  "model": "AMR-500",
  "versions": { "compass": "0.1.0", "ros": "jazzy", "firmware": "1.4.2" },
  "authRequired": false,
  "capabilities": ["mapping", "navigation", "continue_mapping", "scan_stream"]
}
```

`capabilities` — UI скрывает то, чего робот не умеет:

| capability | Что включает в UI |
|---|---|
| `mapping` | картографирование |
| `navigation` | навигация |
| `continue_mapping` | «Продолжить картографирование» для карт с `hasPosegraph` |
| `mapping_navigation` | цели Nav2 во время картографирования (**позже**, не в v1) |
| `scan_stream` | отображение скана лидара (WS `scan`) |

---

## 2. Статус и режимы

### Режимы

| mode | Что работает на роботе |
|---|---|
| `idle` | базовый стек: драйверы, одометрия, лидар. Можно ездить джойстиком |
| `mapping` | + SLAM (slam_toolbox, mapping). Джойстик (цели Nav2 — позже, capability `mapping_navigation`) |
| `navigation` | + карта, локализация, Nav2. Цели и джойстик (джойстик отменяет активную цель) |

Служебные состояния (их нельзя запросить, только наблюдать):

| state | Значение |
|---|---|
| `switching` | идёт переход между режимами |
| `error` | стек упал / переход не удался; выход — только в `idle` |

> Решение: «Teleop» не отдельный режим. Ручное управление доступно в любом режиме, если
> клиент держит управление (§3).

### Допустимые переходы

```
idle ──► mapping ──► idle
idle ──► navigation ──► idle
mapping ──► navigation   (только после сохранения карты; иначе MODE_NOT_ALLOWED)
navigation ──► mapping   (continue_mapping с текущей карты)
error ──► idle
```

#### `GET /api/status`
Полный снимок. Тот же объект приходит по WS сообщением `status` (§9).

```json
{
  "mode": "navigation",
  "state": "ready",                       // ready | switching | error
  "transition": null,                      // см. ниже, если state = switching
  "map": { "id": "warehouse-f1", "name": "Склад, этаж 1" },   // null в idle
  "localization": { "status": "ok", "covariance": 0.04 },     // ok | uncertain | lost | none
  "battery": { "percent": 82, "voltage": 48.1, "charging": false },   // из топика робота; null — данных нет
  "stacks": [
    { "name": "base", "state": "running" },   // stopped | starting | running | stopping | failed
    { "name": "localization", "state": "running" },
    { "name": "nav2", "state": "running" }
  ],
  "control": { "owner": "none" },           // none | me | other (+ "client": "192.168.0.50")
  "estop": false,                            // аппаратная/программная кнопка стоп активна
  "errors": [ { "code": "STACK_FAILED", "message": "...", "details": { "stack": "slam" } } ],
  "mapping": null                            // только в режиме mapping, см. ниже
}
```

`mapping` (в режиме `mapping`, иначе `null`):
```json
{
  "paused": false,          // приём сканов приостановлен (§4)
  "rev": 42,                // ревизия живой карты, та же, что в map_meta
  "unsavedChanges": true    // карта менялась после последнего сохранения
}
```
`unsavedChanges` — «есть что терять»: с момента последнего `save` (или начала
картографирования) в карту добавились новые данные. Если робот стоит и карта не
меняется, флаг не должен включаться. Нужен, чтобы UI предупредил при выходе без
сохранения — в том числе после перезагрузки страницы и с другого устройства.

`transition`:
```json
{
  "from": "idle",
  "to": "navigation",
  "step": "starting_stack",     // stopping_stack | starting_stack | waiting_ready | activating
  "stack": "nav2",
  "progress": 0.6,              // 0..1, для полосы прогресса
  "startedAt": "2026-10-01T10:15:00+03:00"
}
```

#### `POST /api/mode`
Запросить переход. Ответ сразу, сам переход идёт асинхронно; прогресс — по WS `status`.

```json
Request:  { "mode": "navigation", "params": { "mapId": "warehouse-f1" } }
Response 202: { "accepted": true }
Errors:   MODE_NOT_ALLOWED, BUSY, NOT_FOUND (нет карты)
```

`params` по режимам:

| mode | params |
|---|---|
| `idle` | `{}` |
| `mapping` | `{}` — новая карта; `{ "continueFrom": "<mapId>" }` — достраивать существующую (нужен `hasPosegraph`) |
| `navigation` | `{ "mapId": "..." }`; `{ "initialPose": {x,y,theta} }` — необязательно |

---

## 3. Управление движением

Одновременно управлять может **только один клиент**. Остальные — наблюдатели.

#### `POST /api/control/acquire`
```json
Request:  { "clientId": "c-7", "force": false }   // force=true — перехватить у другого (UI спрашивает подтверждение)
Response: { "owner": "me" }
Errors:   CONTROL_LOCKED (если занято и force=false),
          NOT_FOUND (нет WS-сессии с таким clientId)
```
Управление привязано к WS-сессии `clientId` (из `hello`, §9): закрылся WS — управление
освобождается и **ручное движение** останавливается. По HTTP-запросу сервер не может сам
понять, какой WS-сессии он принадлежит, поэтому `clientId` передаётся явно.

Отдача, перехват и потеря управления **не отменяют** активную цель или маршрут Nav2:
робот доезжает сам (UI отдаёт управление, когда оператор уходит с экрана). Остановить
автономное движение — `POST /api/navigation/cancel` или СТОП.

`status.control.owner` сервер считает для каждой WS-сессии отдельно: `me` — эта сессия,
`other` — другая (с `client` — её адресом).

#### `POST /api/control/release`
```json
Request:  { "clientId": "c-7" }
Response: 204
```

#### `POST /api/stop`
**Доступен всегда** и любому клиенту, без захвата управления.
Обнуляет скорость, отменяет активную цель Nav2. Режим не меняется.
Дублируется WS-сообщением `stop` (быстрее).

```json
Response: { "stopped": true }
```

Джойстик — только по WS (`cmd_vel`, §9).

---

## 4. Картографирование

Работает только в режиме `mapping`, иначе `MODE_NOT_ALLOWED`.

#### `POST /api/mapping/pause` → `204`
Перестать добавлять сканы в карту (люди, открытые двери). Робот может ехать.

#### `POST /api/mapping/resume` → `204`

#### `POST /api/mapping/save`
Сохраняет и PGM+YAML, и posegraph slam_toolbox. Режим не меняется — можно сохранять
промежуточные версии.

```json
Request:  { "name": "Склад, этаж 1", "overwrite": false }
Response: Map
Errors:   CONFLICT (имя занято и overwrite=false)
```

`id` — uuid, генерирует робот. Имя можно менять, `id` — нет. Имя уникально (без учёта регистра).

#### Живая карта

Во время картографирования сервер шлёт по WS лёгкое сообщение `map_meta` с номером
ревизии и адресом картинки, а PNG UI забирает отдельно по `url`:

#### `GET /api/live/map.png?rev=<n>`
PNG текущей SLAM-карты. Цвета: свободно — белый `#fefefe`, занято — чёрный `#000`,
неизвестно — серый `#cdcdcd` (как у `map_saver`). `rev` нужен только для кэша браузера.
Errors: `MODE_NOT_ALLOWED` — не в режиме mapping; `NOT_FOUND` — карта ещё пустая.

Ревизия растёт, только когда картинка действительно изменилась.

#### `POST /api/mapping/save` — после сохранения
`status.map` становится `{ id, name }` сохранённой карты, `status.mapping.unsavedChanges` — `false`,
событие `MAP_SAVED` с `details: { name, mapId }`. Повторное сохранение под тем же именем —
с `overwrite: true` (UI так и делает, если карта уже была сохранена в этой сессии).

> Почему так, а не base64 в WS: браузер сам декодирует и кэширует PNG, WS не забивается
> мегабайтами, а Beast просто отдаёт буфер из памяти.

---

## 5. Карты

#### `GET /api/maps` → `Map[]`

#### `GET /api/maps/:id` → `Map`

#### `GET /api/maps/:id/image.png`
PNG карты (те же цвета, что у живой карты).

#### `PATCH /api/maps/:id`
```json
Request:  { "name": "Новое имя" }
Response: Map
Errors:   CONFLICT (имя занято)
```

#### `DELETE /api/maps/:id` → `204`
Errors: `CONFLICT` — карта сейчас используется (навигация или continue_mapping).

#### `GET /api/maps/:id/export`
Архив `.zip`: `map.pgm`, `map.yaml`, `map.posegraph`, `map.data`. Для переноса на
другого робота или во fleet-manager.

#### `POST /api/maps/import`
`multipart/form-data`, поле `file` — тот же `.zip` (или пара pgm+yaml). → `Map`

**Map:**
```ts
type Map = {
  id: string
  name: string
  width: number            // px
  height: number           // px
  resolution: number       // м/px
  origin: [number, number, number]   // [x, y, theta] — как в map.yaml
  hasPosegraph: boolean    // можно продолжить картографирование
  sizeBytes: number
  createdAt: string
  updatedAt: string
}
```

Пересчёт координат (ROS: начало карты — **левый нижний** угол, у PNG строка 0 — верхняя):
```
px = (x - origin[0]) / resolution
py = height - (y - origin[1]) / resolution
```
`origin[2]` (поворот) считаем равным 0 — slam_toolbox и map_saver пишут 0.

---

## 6. Навигация

Работает только в режиме `navigation`, иначе `MODE_NOT_ALLOWED`.
Цели и маршруты отправляет только клиент, который держит управление (§3), — поэтому
в теле есть `clientId`. Отмена и СТОП доступны всем.

Ручное управление (`cmd_vel`) во время движения к цели **отменяет** цель (`state: canceled`).

#### `POST /api/navigation/initial-pose`
Задать позу робота на карте (как «2D Pose Estimate» в RViz) — для AMCL `/initialpose`.
Не требует управления.
```json
Request: { "x": 1.2, "y": 3.4, "theta": 1.57 }
Response: 204
```

#### `POST /api/navigation/goal`
Одна цель — `NavigateToPose`.
```json
Request:  { "clientId": "c-7", "x": 5.0, "y": 2.0, "theta": 0.0 }
Response: { "goalId": "g-17" }
Errors:   MODE_NOT_ALLOWED, CONTROL_LOCKED, INVALID_INPUT
```

#### `POST /api/navigation/route`
Маршрут из точек. Два режима — как в панели Nav2 в RViz2:

| `mode` | Действие Nav2 | Поведение |
|---|---|---|
| `waypoints` | `FollowWaypoints` | едет к каждой точке по очереди и **останавливается** в ней |
| `through_poses` | `NavigateThroughPoses` | проезжает через точки **без остановки**, ориентация важна только в последней |

```json
Request:  {
  "clientId": "c-7",
  "mode": "waypoints",
  "poses": [ { "x": 1.0, "y": 2.0, "theta": 0.0 }, { "x": 4.0, "y": 2.5, "theta": 1.57 } ]
}
Response: { "goalId": "g-18" }
Errors:   MODE_NOT_ALLOWED, CONTROL_LOCKED, INVALID_INPUT (пустой список, > 100 точек)
```

Новая цель или маршрут заменяет предыдущие. Прогресс — WS `nav_status` (§9).

#### `POST /api/navigation/cancel` → `204`
Отменить текущую цель или маршрут. Доступно любому клиенту.

> Позже: именованные точки и сохранённые маршруты на карте.

---

## 7. Конфигурация

### Подход: схема от робота

Что можно настраивать, решает робот, а не UI. Робот отдаёт **схему** (разделы, поля, типы,
границы, подписи на двух языках), UI по ней строит формы. Добавить параметр — значит
поправить схему на роботе, UI пересобирать не нужно.

#### `GET /api/config/schema`
```json
{
  "sections": [
    {
      "id": "identity",
      "title": { "ru": "Робот", "en": "Robot" },
      "fields": [
        {
          "key": "identity.name",
          "type": "string",                      // string | number | integer | boolean | enum | ip | ipcidr | host_port
          "label": { "ru": "Имя робота", "en": "Robot name" },
          "help":  { "ru": "Отображается в интерфейсе и во флоте", "en": "Shown in UI and fleet" },
          "required": true,
          "maxLength": 32,
          "apply": "live"                        // live | restart_stack | reboot
        }
      ]
    },
    {
      "id": "motion",
      "title": { "ru": "Движение", "en": "Motion" },
      "fields": [
        {
          "key": "motion.max_linear_vel",
          "type": "number",
          "label": { "ru": "Макс. линейная скорость", "en": "Max linear velocity" },
          "unit": "m/s",
          "min": 0.05, "max": 2.0, "step": 0.05,
          "apply": "restart_stack",
          "stacks": ["nav2"]                     // какие стеки перезапустятся
        }
      ]
    }
  ]
}
```

Поля `number`: `min`, `max`, `step`, `unit`. Поля `enum`: `options: [{ value, label: {ru,en} }]`.

Ожидаемые разделы (что конкретно внутри — решает робот):

| Раздел | Примеры полей |
|---|---|
| `identity` | имя, серийный номер, производитель, модель (те же, что identity во флоте) |
| `network` | IP/маска, шлюз, DNS, адрес FMS, MQTT-брокер, логин MQTT |
| `motion` | макс. линейная/угловая скорость, ускорения, скорость ручного управления |
| `navigation` | допуск цели, inflation radius, footprint padding |
| `mapping` | разрешение карты, макс. дальность лидара |
| `safety` | параметры collision monitor, таймаут джойстика |

#### `GET /api/config`
```json
{
  "version": 12,
  "values": {
    "identity.name": "AMR-01",
    "motion.max_linear_vel": 0.8
  }
}
```

#### `POST /api/config/validate`
Сухой прогон: ничего не применяет, показывает, что произойдёт.
```json
Request:  { "values": { "motion.max_linear_vel": 1.0 } }
Response: {
  "valid": true,
  "errors": {},                                   // { key: { code, message } }
  "changes": [ { "key": "motion.max_linear_vel", "from": 0.8, "to": 1.0 } ],
  "effects": { "restartStacks": ["nav2"], "reboot": false, "networkChange": false }
}
```

#### `PUT /api/config`
```json
Request:  { "baseVersion": 12, "values": { "motion.max_linear_vel": 1.0 }, "comment": "быстрее" }
Response: { "version": 13, "effects": { "restartStacks": ["nav2"], "reboot": false } }
Errors:   INVALID_INPUT (details — ошибки по ключам),
          CONFLICT (baseVersion устарел — кто-то поменял конфиг параллельно),
          BUSY, MODE_NOT_ALLOWED (например, перезапуск nav2 во время движения к цели)
```
Частичное обновление: присылаются только изменённые ключи. Перезапуск стеков робот
делает сам; ход — по WS `status`.

#### Сетевые настройки — с автооткатом

Ключи раздела `network` через `PUT /api/config` не меняются (`INVALID_INPUT`), только так:

#### `POST /api/config/network`
```json
Request:  { "values": { "network.ip": "192.168.0.120/24", "network.gateway": "192.168.0.1" } }
Response: {
  "pendingId": "n-5",
  "rollbackAt": "2026-10-01T10:16:00+03:00",     // через 60 с
  "newUrl": "http://192.168.0.120/"
}
```
Робот применяет сеть и ждёт подтверждения. UI переходит по `newUrl` и вызывает:

#### `POST /api/config/network/confirm`
```json
Request:  { "pendingId": "n-5" }
Response: { "version": 14 }
```
Нет подтверждения до `rollbackAt` — робот сам возвращает старые настройки и пишет
событие `NETWORK_ROLLED_BACK`.

#### История и откат

#### `GET /api/config/history`
```json
[ { "version": 13, "createdAt": "…", "client": "192.168.0.50", "comment": "быстрее",
    "changes": [ { "key": "motion.max_linear_vel", "from": 0.8, "to": 1.0 } ] } ]
```

#### `POST /api/config/rollback`
```json
Request:  { "version": 12 }
Response: тот же, что у PUT /api/config
```

#### Экспорт и импорт

- `GET /api/config/export` → `.zip` со всем конфигом (бэкап, перенос на другой робот).
- `POST /api/config/import` (`multipart/form-data`, `file`) → то же, что `validate`;
  применение — отдельным `PUT` с полученными `values`.

#### Продвинутое: сырые файлы параметров

Для тонкой настройки Nav2/SLAM, которую нет смысла выносить в схему.

- `GET /api/config/files` → `[ { "name": "nav2_params.yaml", "stacks": ["nav2"], "updatedAt": "…" } ]`
- `GET /api/config/files/:name` → `text/plain` (YAML)
- `PUT /api/config/files/:name` — тело `text/plain`; робот проверяет, что YAML валиден.
  → `{ "version": 15, "effects": { … } }`. Попадает в общую историю версий.

---

## 8. Журнал и система

#### `GET /api/logs?stack=nav2&level=warn&since=<iso>&limit=500`
```json
[ { "time": "…", "stack": "nav2", "node": "controller_server", "level": "warn", "message": "…" } ]
```
`level`: `debug | info | warn | error`. Живой поток — подписка `logs` по WS.

#### `GET /api/events?limit=100`
История событий (те же объекты, что WS `event`).

#### `POST /api/system/restart-stack` — `{ "stack": "nav2" }` → `202`
#### `POST /api/system/reboot` → `202`
#### `POST /api/system/shutdown` → `202`

---

## 9. WebSocket `/ws`

Все сообщения — JSON-объекты с полем `type`.

### Подключение

1. Сервер сразу после подключения → `{ "type": "hello", "clientId": "c-7", "status": { …как GET /api/status… }, "serverTime": "…" }`.
2. Клиент → `subscribe` на нужные потоки.

`clientId` — идентификатор WS-сессии; к нему привязано управление (§3).

UI переподключается сам с паузой 1 → 2 → 5 → 10 с.

### Клиент → сервер

| type | Поля | Комментарий |
|---|---|---|
| `subscribe` | `topics: string[]` | заменяет текущий набор подписок |
| `ping` | `t` (число, мс клиента) | раз в 2 с; сервер отвечает `pong` с тем же `t` → задержка |
| `cmd_vel` | `linear`, `angular` | м/с, рад/с. 10–20 Гц, пока джойстик отклонён. Сервер обрезает до лимитов из конфига. Нужно управление (§3), иначе `error CONTROL_LOCKED` |
| `stop` | — | то же, что `POST /api/stop` |

**Сторожевой таймер:** если `cmd_vel` не приходил **500 мс** — сервер публикует нулевую
скорость. Отпустили джойстик — UI шлёт одно `cmd_vel` с нулями и перестаёт слать.

### Темы подписки

| topic | Сообщение | Частота |
|---|---|---|
| — (всегда) | `status`, `event`, `control`, `pong`, `error` | по изменению |
| `pose` | `pose` | 10 Гц |
| `map` | `map_meta` | сразу при подписке, затем при изменении карты (не чаще 1 Гц) |
| `path` | `path` | при новом пути Nav2, не чаще 2 Гц; пустой `points` — пути нет |
| `nav` | `nav_status` | сразу при подписке, затем 2 Гц, пока цель активна, и при завершении |
| `scan` | `scan` | 5 Гц (только при capability `scan_stream`) |
| `logs` | `log` | по мере появления |

### Сервер → клиент

```jsonc
// Полный статус — при любом изменении и раз в 1 с
{ "type": "status", ...как GET /api/status }

// Поза робота
{ "type": "pose", "frame": "map", "x": 1.23, "y": 4.56, "theta": 0.78,
  "linear": 0.3, "angular": 0.0, "t": "…" }

// Текущая карта режима. UI загружает PNG по url.
// mapping    → url = /api/live/map.png?rev=42, приходит при каждом изменении (≤ 1 Гц)
// navigation → url = /api/maps/:id/image.png, приходит при смене карты
// Карты нет (idle, или mapping ещё пустой) → { "type": "map_meta", "rev": 0, "url": null }
// Новому подписчику на тему map сервер сразу шлёт текущий map_meta.
{ "type": "map_meta", "rev": 42, "url": "/api/live/map.png?rev=42",
  "width": 812, "height": 640, "resolution": 0.05, "origin": [-10.0, -8.0, 0.0] }

// Путь Nav2, прореженный до ~200 точек
{ "type": "path", "points": [[1.2, 3.4], [1.3, 3.5]] }

// Ход навигации. Последний статус (в т.ч. завершённый) сервер шлёт новому подписчику
// темы nav сразу — чтобы после перезагрузки страницы цель и маршрут были видны.
// Нет и не было цели в этом режиме → { "type": "nav_status", "goalId": null }
{ "type": "nav_status", "goalId": "g-18",
  "kind": "route",                // goal | route
  "mode": "waypoints",            // только для route: waypoints | through_poses
  "poses": [ { "x": 1.0, "y": 2.0, "theta": 0.0 }, { "x": 4.0, "y": 2.5, "theta": 1.57 } ],
                                  // для goal — одна поза
  "index": 0,                     // к какой точке едем сейчас (0..poses.length-1)
  "state": "active",              // active | succeeded | failed | canceled
  "distanceRemaining": 7.4,       // м до конца (цели или последней точки маршрута)
  "eta": 21.0,                    // с, оценка
  "recoveries": 0,
  "error": null }                 // { code, message } при failed: NO_PATH | STUCK | ...

// Скан лидара в мировых координатах того же фрейма, что и поза (map или odom), прореженный
{ "type": "scan", "frame": "odom", "points": [[2.1, 0.4], [2.1, 0.5]] }

// Кто управляет
{ "type": "control", "owner": "other", "client": "192.168.0.51" }

// Событие для уведомлений
{ "type": "event", "id": "e-301", "time": "…",
  "level": "warning",             // info | warning | error
  "code": "LOCALIZATION_LOST", "message": "…", "details": {} }

// Строка журнала
{ "type": "log", "time": "…", "stack": "nav2", "node": "…", "level": "warn", "message": "…" }

// Ошибка на сообщение клиента
{ "type": "error", "code": "CONTROL_LOCKED", "message": "…" }
```

### Коды событий (UI переводит по коду)

| code | level |
|---|---|
| `MODE_CHANGED` | info |
| `MAP_SAVED` | info |
| `CONFIG_APPLIED` | info |
| `NAV_GOAL_SUCCEEDED` | info |
| `NAV_GOAL_FAILED` | warning |
| `NAV_GOAL_CANCELED` | info — отменена (кнопкой, СТОП или ручным управлением) |
| `LOCALIZATION_LOST` | warning |
| `BATTERY_LOW` | warning |
| `CONTROL_TAKEN` | warning — управление перехватил другой |
| `NETWORK_ROLLED_BACK` | warning |
| `STACK_FAILED` | error |
| `STACK_RESTARTED` | warning |
| `ESTOP_ACTIVE` | error |

---

## 10. Открытые вопросы к Семёну

1. Аппаратный E-stop: есть ли сигнал в ROS, чтобы показать `estop: true`?
2. Батарея: какой тип сообщения в топике (`sensor_msgs/BatteryState`?) — чтобы договориться,
   какие поля из него попадают в `status.battery`.

### Решено

| Дата | Вопрос | Решение |
|---|---|---|
| 2026-10-01 | Авторизация в v1 | нет; `authRequired: false` |
| 2026-10-01 | Цели Nav2 во время картографирования | позже |
| 2026-10-01 | Скан лидара в UI | да, в v1 |
| 2026-10-01 | `id` карт | uuid |
| 2026-10-01 | Источник данных батареи | топик робота |
