export const DIFFICULTIES = [
  { key: 'easy', label: 'EASY', color: '#22C55E', soft: '#16A34A', glow: 'rgba(34,197,94,0.45)' },
  { key: 'medium', label: 'MEDIUM', color: '#3B82F6', soft: '#2563EB', glow: 'rgba(59,130,246,0.45)' },
  { key: 'hard', label: 'HARD', color: '#F97316', soft: '#EA580C', glow: 'rgba(249,115,22,0.45)' },
  { key: 'expert', label: 'EXPERT', color: '#A855F7', soft: '#9333EA', glow: 'rgba(168,85,247,0.45)' },
  { key: 'impossible', label: 'IMPOSSIBLE', color: '#EF4444', soft: '#DC2626', glow: 'rgba(239,68,68,0.45)' },
]

export const DIFFICULTY_KEYS = DIFFICULTIES.map((d) => d.key)

export function difficultyColor(value) {
  return DIFFICULTIES[value] ? DIFFICULTIES[value].color : null
}

export function difficultyKeyClass(value) {
  return DIFFICULTIES[value] ? `dc-${DIFFICULTIES[value].key}` : 'dc-easy'
}

export function rgbaFromHex(hex, a) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}
