// Simple forecasts for the Analytics page, from the last 4 weeks of sales.
// They are sent to Gemini so its predictions quote computed numbers instead of guesses.
import { amountOf, isUtang } from './monthly'
import { expensesOfOrders } from './expenses'
import { localDateString, todayString } from './dateUtils'

const WEEKS = 4
const HISTORY_DAYS = WEEKS * 7
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const shift = (day, n) => {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return localDateString(d)
}
const weekdayOf = (day) => new Date(`${day}T00:00:00`).getDay()
const kgOf = (itemName) => Number(((itemName || '').match(/[\d.]+/) || [0])[0])
const r0 = (n) => Math.round(Number(n) || 0)

// orders: accepted orders (already branch-filtered) that cover at least the last 28 days
// stockBySize: filled cylinders on hand per kg; sizes: the kg sizes to forecast
export function forecastOf(orders, stockBySize, sizes) {
  const today = todayString()
  const from = shift(today, -HISTORY_DAYS) // the 28 full days before today
  const dayOf = (o) => (o.accepted_at ? localDateString(o.accepted_at) : '')
  const history = orders.filter((o) => {
    const d = dayOf(o)
    return d >= from && d < today
  })
  if (history.length === 0) return null

  // average revenue per weekday (each weekday appears WEEKS times in the history)
  const byWeekday = Array(7).fill(0)
  for (const o of history) byWeekday[weekdayOf(dayOf(o))] += amountOf(o)
  const perWeekday = byWeekday.map((v) => v / WEEKS)

  // last 2 weeks vs the 2 weeks before: the direction sales are moving
  const mid = shift(today, -14)
  const recent = history.filter((o) => dayOf(o) >= mid).reduce((s, o) => s + amountOf(o), 0)
  const earlier = history.filter((o) => dayOf(o) < mid).reduce((s, o) => s + amountOf(o), 0)
  const trend = earlier > 0 ? recent / earlier - 1 : 0
  // project half the recent trend forward (damped, so one good week does not overshoot)
  const growth = 1 + Math.max(-0.2, Math.min(0.2, trend / 2))

  const projectDays = (start, count) => {
    let sum = 0
    for (let i = 0; i < count; i++) sum += perWeekday[weekdayOf(shift(start, i))] * growth
    return sum
  }

  // this month: actual so far (incl. today) + the projection for the days left
  const monthStart = `${today.slice(0, 7)}-01`
  const now = new Date(`${today}T00:00:00`)
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const daysLeft = daysInMonth - now.getDate()
  const monthSoFar = orders.filter((o) => dayOf(o) >= monthStart && dayOf(o) <= today)
  const monthRevenueSoFar = monthSoFar.reduce((s, o) => s + amountOf(o), 0)
  // expenses: the 4-week daily average for the days left (rent and bills come monthly, so
  // the daily average spreads them over the month)
  const expensePerDay = expensesOfOrders(history) / HISTORY_DAYS
  const monthExpensesSoFar = expensesOfOrders(monthSoFar)
  const monthRevenue = monthRevenueSoFar + projectDays(shift(today, 1), daysLeft)
  const monthExpenses = monthExpensesSoFar + expensePerDay * daysLeft

  // stock: days until each size runs out at the last 2 weeks' pace
  const last2w = history.filter((o) => dayOf(o) >= mid)
  const stockOut = sizes.map((kg) => {
    const perDay = last2w.filter((o) => kgOf(o.item_name) === kg).reduce((s, o) => s + Number(o.quantity || 0), 0) / 14
    const stock = stockBySize?.[kg] || 0
    return {
      size: `${kg} kg`,
      soldPerDay: Number(perDay.toFixed(1)),
      inStock: stock,
      daysLeft: perDay > 0 ? Number((stock / perDay).toFixed(1)) : null,
      runsOutOn: perDay > 0 ? shift(today, Math.floor(stock / perDay)) : null,
      orderForNext7Days: Math.max(0, Math.ceil(perDay * 7 - stock)),
    }
  })

  const busiest = perWeekday.indexOf(Math.max(...perWeekday))
  const quietest = perWeekday.indexOf(Math.min(...perWeekday))
  const openUtang = orders.filter(isUtang).reduce((s, o) => s + amountOf(o), 0)

  return {
    basedOn: `last ${HISTORY_DAYS} days (${from} to ${shift(today, -1)})`,
    salesTrend: `${trend >= 0 ? '+' : ''}${(trend * 100).toFixed(1)}% (last 2 weeks vs the 2 weeks before)`,
    next7Days: { revenue: r0(projectDays(shift(today, 1), 7)), expenses: r0(expensePerDay * 7) },
    thisMonth: {
      month: today.slice(0, 7),
      daysLeft,
      revenueSoFar: r0(monthRevenueSoFar),
      projectedRevenue: r0(monthRevenue),
      projectedExpenses: r0(monthExpenses),
      projectedNetIncome: r0(monthRevenue - monthExpenses),
    },
    averageRevenueByWeekday: Object.fromEntries(DAY_NAMES.map((d, i) => [d, r0(perWeekday[i])])),
    busiestDay: DAY_NAMES[busiest],
    quietestDay: DAY_NAMES[quietest],
    stockOut,
    openUtang: r0(openUtang),
  }
}
