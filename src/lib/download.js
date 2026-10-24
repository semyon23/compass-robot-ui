/** Отдать браузеру файл на сохранение (zip карты, архив логов). */
export function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
