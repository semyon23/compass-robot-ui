/**
 * Вид 2D-карты: мир (метры, ось Y вверх) ↔ экран (CSS-пиксели, ось Y вниз).
 * view = { cx, cy, scale } — точка мира в центре экрана и пикселей на метр.
 */

export const MIN_SCALE = 5
export const MAX_SCALE = 400

export function worldToScreen(view, w, h, x, y) {
  return [w / 2 + (x - view.cx) * view.scale, h / 2 - (y - view.cy) * view.scale]
}

export function screenToWorld(view, w, h, sx, sy) {
  return [view.cx + (sx - w / 2) / view.scale, view.cy - (sy - h / 2) / view.scale]
}

/** Масштаб с сохранением точки мира под (sx, sy) — под курсором или пальцами. */
export function zoomAt(view, w, h, sx, sy, factor) {
  const [bx, by] = screenToWorld(view, w, h, sx, sy)
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor))
  const next = { ...view, scale }
  const [ax, ay] = screenToWorld(next, w, h, sx, sy)
  return { cx: next.cx + bx - ax, cy: next.cy + by - ay, scale }
}

/** Сдвиг вида на (dx, dy) экранных пикселей — «тащим карту рукой». */
export function pan(view, dx, dy) {
  return { ...view, cx: view.cx - dx / view.scale, cy: view.cy + dy / view.scale }
}

const NICE = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]

/** Наименьший «круглый» шаг в метрах, который на экране не меньше minPx. */
export function niceStep(scale, minPx) {
  return NICE.find((s) => s * scale >= minPx) ?? NICE[NICE.length - 1]
}

/** Направление от точки a к точке b, рад. */
export function heading(a, b) {
  return Math.atan2(b.y - a.y, b.x - a.x)
}
