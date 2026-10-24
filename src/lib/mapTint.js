/**
 * Карта → canvas в палитре темы. Неизвестные клетки прозрачные: сквозь них видна сетка,
 * а исследованная область «проявляется» поверх неё.
 *
 * Карта везде одного вида — как nav_msgs/OccupancyGrid:
 *   { width, height, data } — data: -1 неизвестно, 0..100 занятость; строка 0 — низ карты.
 * Живая карта приходит такой с /map, сохранённая (map.pgm) переводится parsePgm.
 */

// Пороги как у map_saver / map_server: занято ≥ 65, свободно ≤ 25.
export function classify(v) {
  if (v < 0) return 'unknown'
  if (v >= 65) return 'occupied'
  if (v <= 25) return 'free'
  return 'unknown'
}

export const PALETTES = {
  light: { free: [255, 255, 255, 255], occupied: [30, 41, 59, 255], unknown: [0, 0, 0, 0] },
  dark: { free: [30, 41, 59, 255], occupied: [226, 232, 240, 255], unknown: [0, 0, 0, 0] },
}

/** Возвращает canvas размером width × height: верхняя строка — верх карты. */
export function gridCanvas(grid, palette) {
  const { width, height, data } = grid
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g = canvas.getContext('2d')
  const img = g.createImageData(width, height)
  const px = img.data
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width
    for (let x = 0; x < width; x++) {
      const color = palette[classify(data[src + x])]
      const i = (y * width + x) * 4
      px[i] = color[0]
      px[i + 1] = color[1]
      px[i + 2] = color[2]
      px[i + 3] = color[3]
    }
  }
  g.putImageData(img, 0, 0)
  return canvas
}

/**
 * map.pgm (P5, 8 бит, как пишет map_saver) → { width, height, data }.
 * Пиксель → занятость как у map_server (trinary, negate 0, пороги 0.65 / 0.196 — как пишет
 * compass_core): 0 — занято, 254 — свободно, 205 — неизвестно.
 */
export function parsePgm(bytes) {
  let pos = 0
  const token = () => {
    for (;;) {
      while (pos < bytes.length && /\s/.test(String.fromCharCode(bytes[pos]))) pos++
      if (bytes[pos] !== 0x23) break // '#' — комментарий до конца строки
      while (pos < bytes.length && bytes[pos] !== 0x0a) pos++
    }
    const start = pos
    while (pos < bytes.length && !/\s/.test(String.fromCharCode(bytes[pos]))) pos++
    return String.fromCharCode(...bytes.subarray(start, pos))
  }
  const magic = token()
  const width = Number(token())
  const height = Number(token())
  const maxval = Number(token())
  pos++ // один пробельный символ перед данными
  if (magic !== 'P5' || !width || !height || maxval > 255 || bytes.length < pos + width * height) {
    throw new Error('not a P5 PGM')
  }
  const data = new Int8Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = pos + (height - 1 - y) * width // в картинке строка 0 — верх
    for (let x = 0; x < width; x++) {
      const occ = (255 - bytes[row + x]) / 255
      data[y * width + x] = occ > 0.65 ? 100 : occ < 0.196 ? 0 : -1
    }
  }
  return { width, height, data }
}
