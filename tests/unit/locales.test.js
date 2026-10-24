import { describe, it, expect } from 'vitest'
import ru from '../../src/locales/ru.js'
import en from '../../src/locales/en.js'

function keys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

describe('locales', () => {
  it('ru и en содержат одинаковый набор ключей', () => {
    expect(keys(ru).sort()).toEqual(keys(en).sort())
  })
})
