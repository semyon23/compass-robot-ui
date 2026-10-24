import { describe, it, expect } from 'vitest'
import { SCHEMES, DEFAULT_SCHEME } from '../../src/lib/schemes.js'
import { ROBOT_KINDS, DEFAULT_ROBOT_KIND } from '../../src/lib/robotShapes.js'
import ru from '../../src/locales/ru.js'

describe('цветовые гаммы', () => {
  it('у каждой гаммы полная шкала brand 50–950 и подпись', () => {
    const steps = Object.keys(SCHEMES[DEFAULT_SCHEME])
    expect(steps).toHaveLength(11)
    for (const [name, scale] of Object.entries(SCHEMES)) {
      expect(Object.keys(scale)).toEqual(steps)
      expect(ru.settings[`scheme_${name}`]).toBeTruthy()
    }
  })
})

describe('внешний вид робота', () => {
  it('у каждого вида есть подпись, вид по умолчанию — из списка', () => {
    expect(ROBOT_KINDS).toContain(DEFAULT_ROBOT_KIND)
    for (const kind of ROBOT_KINDS) expect(ru.settings[`robotKind_${kind}`]).toBeTruthy()
  })
})
