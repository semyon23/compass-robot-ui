// Цвета режимов работы — docs/DESIGN.md.
export const MODE_COLORS = {
  STARTUP: '#94a3b8',
  AUTOMATIC: '#059669', // работает с fms — цвет «в работе», как путь Nav2
  INTERVENED: '#ea580c', // оператор вмешался в задание — заметно, но не ошибка
  MANUAL: '#2563eb',
  SERVICE: '#64748b',
  TEACH_IN: '#7c3aed', // построение карты — как раньше «картографирование»
  switching: '#d97706',
  error: '#dc2626',
  unknown: '#94a3b8',
}

// Куда можно попросить перейти из бейджа. Проверяет и отказывает с причиной — compass_core.
// TEACH_IN — только с экрана «Картографирование»: там выбор карты и защита несохранённых изменений.
export const SWITCHABLE_MODES = ['SERVICE', 'MANUAL', 'AUTOMATIC', 'INTERVENED']
