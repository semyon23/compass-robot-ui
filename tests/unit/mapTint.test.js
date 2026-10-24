import { describe, it, expect } from 'vitest'
import { classify, parsePgm } from '../../src/lib/mapTint.js'

describe('mapTint.classify', () => {
  it('занятость OccupancyGrid: -1 неизвестно, ≤ 25 свободно, ≥ 65 занято', () => {
    expect(classify(-1)).toBe('unknown')
    expect(classify(0)).toBe('free')
    expect(classify(100)).toBe('occupied')
    expect(classify(50)).toBe('unknown')
  })
})

describe('mapTint.parsePgm', () => {
  it('цвета map_saver и переворот строк: строка 0 карты — низ картинки', () => {
    // 2 × 2: верх картинки — занято, свободно; низ — неизвестно, свободно
    const header = new TextEncoder().encode('P5\n# map_saver\n2 2\n255\n')
    const bytes = new Uint8Array([...header, 0, 254, 205, 254])
    const grid = parsePgm(bytes)
    expect(grid.width).toBe(2)
    expect(grid.height).toBe(2)
    expect(Array.from(grid.data)).toEqual([-1, 0, 100, 0])
  })

  it('не PGM — ошибка', () => {
    expect(() => parsePgm(new TextEncoder().encode('P2\n1 1\n255\n0'))).toThrow()
  })
})
