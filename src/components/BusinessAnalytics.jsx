import { peso } from '../lib/money'
import { amountOf, isGcash, isUtang } from '../lib/monthly'

const CARD = 'flex-1 min-w-[340px] rounded-xl border border-(color:--border) bg-white p-4'
const TH = 'p-2 text-left text-[14px] font-semibold'
const TD = 'p-2 text-[14px]'
const NUM = 'p-2 text-right text-[14px] tabular-nums'


const sizeKg = (itemName) => Number(((itemName || '').match(/[\d.]+/) || [0])[0])
const groupKey = (o) => o.group_id || `order-${o.id}`
const revenueOf = (list) => list.reduce((s, o) => s + amountOf(o), 0)
const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—')

export function Change({ change, label }) {
  if (!change) return null
  return (
    <span className={`text-[14px] font-semibold ${change.good ? 'text-brand-pine-light' : 'text-brand-red'}`}>
      {change.text} <span className="font-normal text-gray-500">{label}</span>
    </span>
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
      <div className="mb-4 flex flex-wrap gap-x-4 text-[14px]">
        {split.map((s) => (
          <span key={s.label}>
            <span className={`mr-1 inline-block size-2.5 rounded-full ${s.color}`} />
            {s.label}: {peso(s.value)} ({pct(s.value, total)})
          </span>
        ))}
      </div>

      <div className="mb-2 text-[14px] text-gray-600">
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
      <p className="mt-0 mb-3 text-[14px] text-gray-500">
        Days the filled stock lasts at this period&apos;s selling pace ({days} day{days === 1 ? '' : 's'})
      </p>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap">
          <thead>
            <tr>
              <th className={TH}>Size</th>
              <th className={`${TH} text-right`}>Sold</th>
              <th className={`${TH} text-right`}>Per day</th>
              <th className={`${TH} text-right`}>In stock</th>
              <th className={`${TH} text-right`}>Days left</th>
              <th className={`${TH} text-right`} title="Cylinders to order so the stock lasts 7 days">Order</th>
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
                  <span className={`rounded-full px-2 py-0.5 text-[13px] font-medium ${r.status.cls}`}>{r.status.text}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mb-0 mt-2 text-[13px] text-gray-500">Order = cylinders to order so the stock lasts 7 days.</p>
    </div>
  )
}

// The business sections of the Analytics page
export default function BusinessAnalytics({ rows, days, stockBySize, sizes }) {
  return (
    <div className="mb-4 flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        <StockCover rows={rows} days={days} stockBySize={stockBySize} sizes={sizes} />
        <Customers rows={rows} />
      </div>
    </div>
  )
}
