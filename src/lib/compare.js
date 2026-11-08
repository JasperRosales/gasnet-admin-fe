// % change vs the previous period: { text, good } or null
export function changeOf(now, before, lowerIsBetter = false) {
  if (before == null) return null
  if (before === 0) return now === 0 ? { text: '0%', good: true } : { text: 'new', good: !lowerIsBetter }
  const change = ((now - before) / Math.abs(before)) * 100
  return { text: `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}%`, good: lowerIsBetter ? change <= 0 : change >= 0 }
}
