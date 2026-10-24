/**
 * Внешний вид робота на карте. Рисуем в начале координат, «вперёд» — по +x; r — радиус робота
 * в пикселях, всё остальное — в долях r, чтобы фигура масштабировалась вместе с картой.
 * На поведение робота не влияет — только как его видит оператор.
 */
export const ROBOT_KINDS = ['diff', 'mecanum', 'omni', 'ackermann', 'tracked', 'round']
export const DEFAULT_ROBOT_KIND = 'diff'

export function drawRobotShape(ctx, kind, r, color) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = Math.max(1.5, r / 12)
  ctx.lineJoin = 'round'
  ;(SHAPES[kind] || SHAPES.round)(ctx, r)
  arrow(ctx, r)
  ctx.restore()
}

// Корпус: полупрозрачная заливка + контур.
function body(ctx, path) {
  ctx.beginPath()
  path()
  ctx.globalAlpha = 0.18
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.stroke()
}

// Колесо — сплошной прямоугольник (x, y — центр, w — вдоль хода, h — поперёк), angle — поворот.
function wheel(ctx, x, y, w, h, angle = 0) {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.beginPath()
  ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.3)
  ctx.fill()
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

// Стрелка «вперёд»: выходит за корпус, но не закрывает колёса.
function arrow(ctx, r) {
  ctx.beginPath()
  ctx.moveTo(r * 1.35, 0)
  ctx.lineTo(r * 0.7, -r * 0.34)
  ctx.lineTo(r * 0.7, r * 0.34)
  ctx.closePath()
  ctx.fill()
}

const SHAPES = {
  // Круг — как было до выбора внешнего вида.
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

  // Автомобильная схема (Аккерман): вытянутый корпус, поворотные колёса спереди, бампер.
  ackermann(ctx, r) {
    body(ctx, () => rect(ctx, -r * 0.95, -r * 0.5, r * 0.95, r * 0.5, r * 0.18))
    for (const [x, y] of [[0.55, -0.62], [0.55, 0.62], [-0.55, -0.62], [-0.55, 0.62]]) {
      wheel(ctx, x * r, y * r, r * 0.42, r * 0.2)
    }
    ctx.beginPath()
    ctx.moveTo(r * 0.55, -r * 0.62)
    ctx.lineTo(r * 0.55, r * 0.62)
    ctx.stroke()
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
