const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' for a date, in the browser's local time
export function dateString(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const todayString = () => dateString(new Date())

export const localDateString = (iso) => dateString(new Date(iso))

// true for a Saturday or Sunday ('YYYY-MM-DD')
export const isWeekend = (ymd) => [0, 6].includes(new Date(`${ymd}T00:00:00`).getDay())
