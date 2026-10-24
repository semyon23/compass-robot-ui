import { describe, it, expect } from 'vitest'
import { worldToScreen, screenToWorld, zoomAt, pan, niceStep, MAX_SCALE } from '../../src/lib/view2d.js'

const W = 800
const H = 600
const view = { cx: 2, cy: -1, scale: 50 }

describe('view2d', () => {
  it('центр вида — в центре экрана, ось Y мира смотрит вверх', () => {
    expect(worldToScreen(view, W, H, 2, -1)).toEqual([400, 300])
    const [, syUp] = worldToScreen(view, W, H, 2, 0)
    expect(syUp).toBeLessThan(300)
  })

  it('screenToWorld обратна worldToScreen', () => {
    const [sx, sy] = worldToScreen(view, W, H, 5.5, 3.25)
    const [x, y] = screenToWorld(view, W, H, sx, sy)
    expect(x).toBeCloseTo(5.5)
    expect(y).toBeCloseTo(3.25)
  })

  it('zoomAt оставляет точку под курсором на месте', () => {
    const before = screenToWorld(view, W, H, 100, 450)
    const next = zoomAt(view, W, H, 100, 450, 2)
    expect(next.scale).toBe(100)
    const after = screenToWorld(next, W, H, 100, 450)
    expect(after[0]).toBeCloseTo(before[0])
    expect(after[1]).toBeCloseTo(before[1])
  })

  it('zoomAt не выходит за пределы масштаба', () => {
    expect(zoomAt(view, W, H, 0, 0, 1000).scale).toBe(MAX_SCALE)
  })

  it('pan: тянем карту вправо-вниз — мир уезжает за пальцем', () => {
    const next = pan(view, 50, 50)
    expect(next.cx).toBeCloseTo(1)
    expect(next.cy).toBeCloseTo(0)
  })

  it('niceStep выбирает круглый шаг сетки', () => {
    expect(niceStep(50, 40)).toBe(1)
    expect(niceStep(10, 40)).toBe(5)
    expect(niceStep(400, 40)).toBe(0.1)
  })
})

import { heading } from '../../src/lib/view2d.js'

describe('heading', () => {
  it('направление между точками в радианах (REP-103: против часовой от оси X)', () => {
    expect(heading({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0)
    expect(heading({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2)
    expect(heading({ x: 1, y: 1 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI)
  })
})
