import { peso } from '../lib/money'
import { amountOf, isGcash, isUtang } from '../lib/monthly'
import { expensesOfOrders } from '../lib/expenses'
import { BRANCHES } from '../lib/branches'
import { changeOf } from '../lib/compare'

const CARD = 'flex-1 min-w-[340px] rounded-xl border border-(color:--border) bg-white p-4'
const TH = 'p-2 text-left text-[13px] font-semibold'
const TD = 'p-2 text-[13px]'
const NUM = 'p-2 text-right text-[13px] tabular-nums'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6) // 6 AM to 9 PM

const sizeKg = (itemName) => Number(((itemName || '').match(/[\d.]+/) || [0])[0])
const groupKey = (o) => o.group_id || `order-${o.id}`
const transactionsOf = (list) => new Set(list.map(groupKey)).size
const revenueOf = (list) => list.reduce((s, o) => s + amountOf(o), 0)
const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—')
const hourLabel = (h) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`

export function Change({ change, label }) {
  if (!change) return null
  return (
    <span className={`text-[13px] font-semibold ${change.good ? 'text-brand-pine-light' : 'text-brand-red'}`}>
      {change.text} <span className="font-normal text-gray-500">{label}</span>
    </span>
  )
}

// Branch ranking for the period, with the change vs the previous period
function Leaderboard({ periodAll, prevAll, compareLabel }) {
  const total = revenueOf(periodAll)
  const rows = BRANCHES.map((b) => {
    const sel = periodAll.filter((o) => o.branch === b.id)
    const revenue = revenueOf(sel)
    const expenses = expensesOfOrders(sel)
    const tx = transactionsOf(sel)
    const prev = prevAll ? revenueOf(prevAll.filter((o) => o.branch === b.id)) : null
    return { name: b.name, revenue, expenses, net: revenue - expenses, tx, aov: tx ? revenue / tx : 0, prev }
  })
    .filter((r) => r.revenue > 0 || r.expenses > 0 || r.prev > 0)
    .sort((a, b) => b.revenue - a.revenue)

  return (
    <div className={CARD}>
      <h3 className="mt-0 mb-2 text-lg">Branch Leaderboard</h3>
      {rows.length === 0 ? (
        <p className="text-[14px] text-gray-500">No sales in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={TH}>#</th>
                <th className={TH}>Branch</th>
                <th className={`${TH} text-right`}>Revenue</th>
                <th className={`${TH} text-right`}>Share</th>
                <th className={`${TH} text-right`}>Sales</th>
                <th className={`${TH} text-right`}>Avg sale</th>
                <th className={`${TH} text-right`}>Expenses</th>
                <th className={`${TH} text-right`}>Net</th>
                <th className={`${TH} text-right`}>Margin</th>
                {prevAll && <th className={`${TH} text-right`}>{compareLabel}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.name}>
                  <td className={TD}>{i + 1}</td>
                  <td className={`${TD} font-semibold`}>{r.name}</td>
                  <td className={NUM}>{peso(r.revenue)}</td>
                  <td className={NUM}>{pct(r.revenue, total)}</td>
                  <td className={NUM}>{r.tx}</td>
                  <td className={NUM}>{peso(r.aov)}</td>
                  <td className={NUM}>{peso(r.expenses)}</td>
                  <td className={`${NUM} ${r.net < 0 ? 'text-brand-red' : ''}`}>{peso(r.net)}</td>
                  <td className={NUM}>{pct(r.net, r.revenue)}</td>
                  {prevAll && (
                    <td className={NUM}>
                      <Change change={changeOf(r.revenue, r.prev)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Orders by weekday and hour: shows when to staff up and schedule deliveries
function PeakHours({ rows }) {
  const grid = WEEKDAYS.map(() => HOURS.map(() => 0))
  for (const o of rows) {
    if (!o.accepted_at) continue
    const d = new Date(o.accepted_at)
    const h = HOURS.indexOf(d.getHours())
    if (h >= 0) grid[(d.getDay() + 6) % 7][h] += 1
  }
  const max = Math.max(1, ...grid.flat())
  const byDay = grid.map((r) => r.reduce((a, b) => a + b, 0))
  const byHour = HOURS.map((_, h) => grid.reduce((s, r) => s + r[h], 0))
  const busiestDay = byDay.indexOf(Math.max(...byDay))
  const busiestHour = byHour.indexOf(Math.max(...byHour))
  const any = byDay.some((n) => n > 0)

  return (
    <div className={CARD}>
      <h3 className="mt-0 mb-1 text-lg">Peak Hours</h3>
      <p className="mt-0 mb-3 text-[13px] text-gray-500">
        {any
          ? `Busiest: ${WEEKDAYS[busiestDay]}s, around ${hourLabel(HOURS[busiestHour])}`
          : 'No orders with a time in this period.'}
      </p>
      <div className="overflow-x-auto">
        <table className="border-0 bg-transparent text-[11px]">
          <thead>
            <tr>
              <th className="bg-transparent p-1" />
              {HOURS.map((h) => (
                <th key={h} className="bg-transparent p-1 font-normal text-gray-500">
                  {hourLabel(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, d) => (
              <tr key={WEEKDAYS[d]}>
                <td className="border-0 pr-2 text-gray-600">{WEEKDAYS[d]}</td>
                {row.map((n, h) => (
                  <td
                    key={h}
                    title={`${WEEKDAYS[d]} ${hourLabel(HOURS[h])}: ${n} orders`}
                    className="size-7 border border-white text-center"
                    style={{
                      background: n ? `rgba(0, 87, 70, ${0.12 + (0.88 * n) / max})` : '#f3f6f4',
                      color: n / max > 0.5 ? '#fff' : '#14261b',
                    }}
                  >
                    {n || ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Payment split and the best named customers
function Customers({ rows }) {
  const cash = revenueOf(rows.filter((o) => !isGcash(o) && !isUtang(o)))
  const gcash = revenueOf(rows.filter(isGcash))
  const utang = revenueOf(rows.filter(isUtang))
  const total = cash + gcash + utang

  const people = new Map()
  for (const o of rows) {
    const name = (o.customer_name || '').trim()
    if (!name || /^walk-?in$/i.test(name)) continue
    const key = name.toLowerCase()
    if (!people.has(key)) people.set(key, { name, revenue: 0, tx: new Set(), last: '' })
    const p = people.get(key)
    p.revenue += amountOf(o)
    p.tx.add(groupKey(o))
    if ((o.accepted_at || '') > p.last) p.last = o.accepted_at
  }
  const list = [...people.values()].sort((a, b) => b.revenue - a.revenue)
  const repeat = list.filter((p) => p.tx.size > 1).length

  const split = [
    { label: 'Cash', value: cash, color: 'bg-brand-pine' },
    { label: 'GCash', value: gcash, color: 'bg-brand-mint' },
    { label: 'Utang (unpaid)', value: utang, color: 'bg-brand-red' },
  ]

  return (
    <div className={CARD}>
      <h3 className="mt-0 mb-2 text-lg">Payments &amp; Customers</h3>
      <div className="mb-1 flex h-3 overflow-hidden rounded-full bg-gray-100">
        {total > 0 &&
          split.map((s) => <div key={s.label} className={s.color} style={{ width: `${(s.value / total) * 100}%` }} />)}
      </div>
      <div className="mb-4 flex flex-wrap gap-x-4 text-[13px]">
        {split.map((s) => (
          <span key={s.label}>
            <span className={`mr-1 inline-block size-2.5 rounded-full ${s.color}`} />
            {s.label}: {peso(s.value)} ({pct(s.value, total)})
          </span>
        ))}
      </div>

      <div className="mb-2 text-[13px] text-gray-600">
        {list.length} named customers · {repeat} came back ({pct(repeat, list.length)} repeat rate)
      </div>
      {list.length > 0 && (
        <table className="w-full">
          <thead>
            <tr>
              <th className={TH}>Top customers</th>
              <th className={`${TH} text-right`}>Sales</th>
              <th className={`${TH} text-right`}>Revenue</th>
              <th className={`${TH} text-right`}>Last</th>
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 5).map((p) => (
              <tr key={p.name}>
                <td className={TD}>{p.name}</td>
                <td className={NUM}>{p.tx.size}</td>
                <td className={NUM}>{peso(p.revenue)}</td>
                <td className={NUM}>
                  {p.last ? new Date(p.last).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// How many days the current stock lasts at the period's selling pace
function StockCover({ rows, days, stockBySize, sizes }) {
  const list = sizes.map((kg) => {
    const sold = rows.filter((o) => sizeKg(o.item_name) === kg).reduce((s, o) => s + Number(o.quantity || 0), 0)
    const perDay = days > 0 ? sold / days : 0
    const stock = stockBySize[kg] || 0
    const cover = perDay > 0 ? stock / perDay : null
    let status = { text: 'OK', cls: 'bg-brand-light text-brand-pine' }
    if (stock <= 0) status = { text: 'Out of stock', cls: 'bg-red-100 text-brand-red' }
    else if (cover == null) status = { text: 'No recent sales', cls: 'bg-gray-100 text-gray-600' }
    else if (cover < 3) status = { text: 'Reorder now', cls: 'bg-red-100 text-brand-red' }
    else if (cover < 7) status = { text: 'Reorder soon', cls: 'bg-amber-100 text-amber-800' }
    // enough for 7 days at the current pace
    const reorder = perDay > 0 ? Math.max(0, Math.ceil(perDay * 7 - stock)) : 0
    return { kg, sold, perDay, stock, cover, status, reorder }
  })

  return (
    <div className={CARD}>
      <h3 className="mt-0 mb-1 text-lg">Stock Cover &amp; Reorder</h3>
      <p className="mt-0 mb-3 text-[13px] text-gray-500">
        Days the filled stock lasts at this period&apos;s selling pace ({days} day{days === 1 ? '' : 's'})
      </p>
      <table className="w-full">
        <thead>
          <tr>
            <th className={TH}>Size</th>
            <th className={`${TH} text-right`}>Sold</th>
            <th className={`${TH} text-right`}>Per day</th>
            <th className={`${TH} text-right`}>In stock</th>
            <th className={`${TH} text-right`}>Days left</th>
            <th className={`${TH} text-right`}>Order for 7 days</th>
            <th className={TH}>Status</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.kg}>
              <td className={`${TD} font-semibold`}>{r.kg} kg</td>
              <td className={NUM}>{r.sold}</td>
              <td className={NUM}>{r.perDay.toFixed(1)}</td>
              <td className={NUM}>{r.stock}</td>
              <td className={NUM}>{r.cover == null ? '—' : r.cover.toFixed(1)}</td>
              <td className={NUM}>{r.reorder || '—'}</td>
              <td className={TD}>
                <span className={`rounded-full px-2 py-0.5 text-[12px] font-medium ${r.status.cls}`}>{r.status.text}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// The business sections of the Analytics page
export default function BusinessAnalytics({ rows, periodAll, prevAll, showLeaderboard, compareLabel, days, stockBySize, sizes }) {
  return (
    <div className="mb-4 flex flex-col gap-4">
      {showLeaderboard && <Leaderboard periodAll={periodAll} prevAll={prevAll} compareLabel={compareLabel} />}
      <div className="flex flex-wrap gap-4">
        <PeakHours rows={rows} />
        <Customers rows={rows} />
      </div>
      <StockCover rows={rows} days={days} stockBySize={stockBySize} sizes={sizes} />
    </div>
  )
}
