// Цвета 2D-карты (MapCanvas) и легенды слоёв — docs/DESIGN.md. У каждого слоя свой цвет,
// чтобы пути и цели не сливались: глобальный путь — фиолетовый, локальная траектория — розовая,
// цели — цвет режима навигации, маршрут fms — голубой, черновик — акцент, скан — красный,
// препятствия камеры — салатовые.
// Робот — ярко-синий в любой гамме интерфейса: его ищут на карте первым.
export const MAP_COLORS = {
  light: {
    bg: '#e9eef4', minor: '#dbe2ea', major: '#c3ccd8', axisX: '#ef4444', axisY: '#22c55e', text: '#64748b',
    label: '#ffffff', done: '#94a3b8', pose: '#d97706',
    scan: '#dc2626', camera: '#65a30d', plan: '#7c3aed', localPlan: '#db2777', nav: '#059669', draft: '#ea580c', fms: '#0891b2',
    particles: '#ca8a04', missed: '#dc2626', robot: '#2563eb',
  },
  dark: {
    bg: '#020617', minor: '#0f172a', major: '#1e293b', axisX: '#f87171', axisY: '#4ade80', text: '#94a3b8',
    label: '#020617', done: '#64748b', pose: '#fbbf24',
    scan: '#f87171', camera: '#a3e635', plan: '#a78bfa', localPlan: '#f472b6', nav: '#34d399', draft: '#fb923c', fms: '#22d3ee',
    particles: '#facc15', missed: '#f87171', robot: '#3b82f6',
  },
}
