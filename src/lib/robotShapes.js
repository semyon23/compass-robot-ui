/**
 * Внешний вид робота на карте. Рисуем в начале координат, «вперёд» — по +x; r — радиус робота
 * в пикселях, всё остальное — в долях r, чтобы фигура масштабировалась вместе с картой.
 * На поведение робота не влияет — только как его видит оператор.
 */
export const ROBOT_KINDS = ['diff', 'mecanum', 'omni', 'ackermann', 'tracked', 'round']
export const DEFAULT_ROBOT_KIND = 'diff'

// Корпус — сплошной цвет робота с белым контуром, колёса — графит, «вперёд» — белая стрелка
// на корпусе. Ореол и конус направления рисует карта (MapCanvas), в иконке их нет.
const OUTLINE = '#ffffff'
const WHEEL = '#1e293b'

export function drawRobotShape(ctx, kind, r, color) {
  ctx.save()
  ctx.strokeStyle = OUTLINE
  ctx.fillStyle = color
  ctx.lineWidth = Math.max(1.5, r / 10)
  ctx.lineJoin = 'round'
  ;(SHAPES[kind] || SHAPES.round)(ctx, r)
  dart(ctx, r)
  ctx.restore()
}

// Корпус: сплошная заливка + белый контур — виден и на стенах, и на свободном месте.
function body(ctx, path) {
  ctx.beginPath()
  path()
  ctx.fill()
  ctx.stroke()
}

// Колесо — графитовый прямоугольник с тонким белым контуром (x, y — центр, w — вдоль хода,
// h — поперёк), angle — поворот.
function wheel(ctx, x, y, w, h, angle = 0) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.3)
  ctx.fillStyle = WHEEL
  ctx.fill()
  ctx.lineWidth = Math.max(1, h / 8)
  ctx.stroke()
  ctx.restore()
}

// Ролики меканум- и омни-колёс — светлые штрихи поверх колеса.
function rollers(ctx, x, y, w, h, slope, angle = 0) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.lineWidth = Math.max(1, h / 6)
  ctx.beginPath()
  for (let i = -1; i <= 1; i++) {
    const cx = (i * w) / 3.2
    ctx.moveTo(cx - (h / 2) * slope, -h / 2.6)
    ctx.lineTo(cx + (h / 2) * slope, h / 2.6)
  }
  ctx.stroke()
  ctx.restore()
}

function rect(ctx, x0, y0, x1, y1, radius) {
  ctx.roundRect(x0, y0, x1 - x0, y1 - y0, radius)
}

// «Вперёд» — белая стрелка с вырезом сзади, как значок навигатора.
function dart(ctx, r) {
  ctx.save()
  ctx.fillStyle = OUTLINE
  ctx.beginPath()
  ctx.moveTo(r * 0.5, 0)
  ctx.lineTo(-r * 0.3, -r * 0.36)
  ctx.lineTo(-r * 0.1, 0)
  ctx.lineTo(-r * 0.3, r * 0.36)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

const SHAPES = {
  // Круг — без колёс.
  round(ctx, r) {
    body(ctx, () => ctx.arc(0, 0, r, 0, Math.PI * 2))
  },

  // Дифференциальный привод: круглый корпус, два ведущих колеса по бокам, опорное сзади.
  diff(ctx, r) {
    body(ctx, () => ctx.arc(0, 0, r, 0, Math.PI * 2))
    wheel(ctx, 0, -r * 0.78, r * 0.62, r * 0.24)
    wheel(ctx, 0, r * 0.78, r * 0.62, r * 0.24)
    ctx.beginPath()
    ctx.arc(-r * 0.62, 0, r * 0.12, 0, Math.PI * 2)
    ctx.fillStyle = WHEEL
    ctx.fill()
  },

  // Меканум: прямоугольная платформа, четыре колеса с роликами под 45° (крест-накрест).
  mecanum(ctx, r) {
    body(ctx, () => rect(ctx, -r * 0.8, -r * 0.55, r * 0.8, r * 0.55, r * 0.1))
    for (const [x, y] of [[0.5, -0.72], [0.5, 0.72], [-0.5, -0.72], [-0.5, 0.72]]) {
      const w = r * 0.5
      const h = r * 0.26
      wheel(ctx, x * r, y * r, w, h)
      rollers(ctx, x * r, y * r, w, h, x * y > 0 ? 1 : -1)
    }
  },

  // Омни (kiwi): круглый корпус, три омни-колеса через 120°, ролики поперёк хода.
  omni(ctx, r) {
    body(ctx, () => ctx.arc(0, 0, r, 0, Math.PI * 2))
    for (const a of [Math.PI / 3, Math.PI, -Math.PI / 3]) {
      const x = Math.cos(a) * r * 0.78
      const y = Math.sin(a) * r * 0.78
      // Колесо катится по касательной к корпусу
      wheel(ctx, x, y, r * 0.5, r * 0.22, a + Math.PI / 2)
      rollers(ctx, x, y, r * 0.5, r * 0.22, 0, a + Math.PI / 2)
    }
  },

  // Автомобильная схема (Аккерман): вытянутый корпус, четыре колеса.
  ackermann(ctx, r) {
    body(ctx, () => rect(ctx, -r * 0.95, -r * 0.5, r * 0.95, r * 0.5, r * 0.18))
    for (const [x, y] of [[0.55, -0.62], [0.55, 0.62], [-0.55, -0.62], [-0.55, 0.62]]) {
      wheel(ctx, x * r, y * r, r * 0.42, r * 0.2)
    }
  },

  // Гусеничный: корпус между двумя гусеницами с траками.
  tracked(ctx, r) {
    body(ctx, () => rect(ctx, -r * 0.75, -r * 0.45, r * 0.75, r * 0.45, r * 0.08))
    for (const side of [-1, 1]) {
      const y = side * r * 0.66
      wheel(ctx, 0, y, r * 1.85, r * 0.32)
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'
      ctx.lineWidth = Math.max(1, r / 20)
      ctx.beginPath()
      for (let x = -r * 0.75; x <= r * 0.76; x += r * 0.25) {
        ctx.moveTo(x, y - r * 0.12)
        ctx.lineTo(x, y + r * 0.12)
      }
      ctx.stroke()
      ctx.restore()
    }
  },
}
