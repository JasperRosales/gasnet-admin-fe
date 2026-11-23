import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { cachedQuery } from '../lib/lazyData'
import { amountOf, isGcash, isUtang } from '../lib/monthly'
import { expensesOfOrders } from '../lib/expenses'
import { BRANCHES, branchName } from '../lib/branches'
import { dateString, localDateString, todayString } from '../lib/dateUtils'
import { peso } from '../lib/money'
import { changeOf } from '../lib/compare'
import { lpgPrices } from '../lib/prices'
import { stockStatus, DEFAULT_LOW_LEVEL } from '../lib/stockStatus'
import { Change } from './BusinessAnalytics'
import useLiveTables from '../lib/useLiveTables'

const GREEN = '#0b4436'
const CARD = 'rounded-2xl border border-(color:--border) bg-white shadow-sm'
const PANEL = 'rounded-xl border border-(color:--border) p-3'
const PANEL_TITLE = 'text-[15px] font-semibold text-gray-900'
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// chart colors: series (identity) and stock status (state, always shown with a label too)
const C = {
  revenue: '#0b4436',
  usual: '#4a5751',
  expenses: '#d97706',
  cash: '#0b4436',
  gcash: '#2f6fb5',
  utang: '#c2410c',
  filled: '#0b4436',
  empty: '#c9a227',
  ok: '#166534',
  low: '#b45309',
  out: '#b91c1c',
}
const STATUS_STYLE = {
  'In stock': 'bg-[#e6f2ec] text-[#166534]',
  'Low stock': 'bg-[#fdf0dc] text-[#92400e]',
  'Out of stock': 'bg-[#fde4e4] text-[#991b1b]',
}

const daysAgo = (n) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d
}
const sizeOf = (itemName) => (itemName || '').replace('LPG Cylinder ', '')
const kgOf = (o) => Number(o.quantity || 0) * Number((sizeOf(o.item_name).match(/[\d.]+/) || [0])[0])
const sum = (list, f) => list.reduce((s, o) => s + f(o), 0)
const salesOf = (list) => new Set(list.map((o) => o.group_id || `order-${o.id}`)).size
const tanksOf = (list) => sum(list, (o) => Number(o.quantity || 0))
const revenue = (list) => sum(list, amountOf)
const num = (n) => Number(n || 0).toLocaleString('en-PH', { maximumFractionDigits: 1 })

// a legend row: colored swatch (or text marker) + meaning
function Legend({ items }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-100 pt-2 text-[12px] text-gray-500">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          {it.color ? (
            <span className="inline-block size-2.5 rounded-[3px]" style={{ background: it.color }} />
          ) : (
            <span className={`font-semibold ${it.markClass || 'text-gray-700'}`}>{it.mark}</span>
          )}
          {it.label}
        </span>
      ))}
    </div>
  )
}

// hover box above a bar
function Tip({ children }) {
  return (
    <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-lg border border-(color:--border) bg-white px-2.5 py-1.5 text-left text-[13px] whitespace-nowrap shadow group-hover:block">
      {children}
    </div>
  )
}

// one horizontal bar made of segments (stacked), with a 2px gap between them
function StackBar({ parts, total, height = 'h-3' }) {
  return (
    <div className={`flex ${height} w-full gap-[2px] overflow-hidden rounded-full bg-gray-100`}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <div key={p.label} style={{ width: `${(p.value / Math.max(total, 1)) * 100}%`, background: p.color }} />
        ))}
    </div>
  )
}

function SectionTitle({ children, hint }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <h3 className="m-0 text-[17px] font-bold" style={{ color: GREEN }}>{children}</h3>
      {hint && <span className="text-[13px] text-gray-500">{hint}</span>}
    </div>
  )
}

// Admin Home analytics, for all branches or the branch picked on the home page:
//  Sales: today's numbers, revenue vs expenses (7 days), sales by hour, sizes, payments, branches.
//  Inventory: filled stock per branch and size (with low / out status), days of stock left,
//  filled vs empty tanks per branch.
// Loads the accepted orders of the last 14 days, the current stock and today's empties.
export default function HomeAnalytics({ branch, onOpenAnalytics }) {
  const [onlyBranch, setOnlyBranch] = useState(false)
  // picking another branch on the home page filters the analytics to it
  const [shownBranch, setShownBranch] = useState(branch)
  if (shownBranch !== branch) {
    setShownBranch(branch)
    setOnlyBranch(true)
  }
  const [orders, setOrders] = useState(null)
  const [stock, setStock] = useState([]) // [{ branch, item_name, quantity }]
  const [empties, setEmpties] = useState({}) // { branch: { size: count } }
  const [sizes, setSizes] = useState([]) // ['2.7kg', '11kg', ...]
  const [levels, setLevels] = useState({}) // { size: low stock level }
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const from = daysAgo(13)
    const day = todayString()
    const [ordersResult, stockResult, pricesResult, emptiesResults] = await Promise.all([
      cachedQuery(`home:orders:${dateString(from)}`, 60 * 1000, () =>
        fetchAll(() =>
          supabase
            .from('orders')
            .select('id, group_id, branch, item_name, quantity, unit_price, discount, remarks, accepted_at, paid_gcash, utang_status')
            .eq('status', 'accepted')
            .gte('accepted_at', from.toISOString())
            .order('id'),
        ),
      ),
      cachedQuery('home:stock', 60 * 1000, () => supabase.from('stock').select('branch, item_name, quantity')),
      lpgPrices(),
      Promise.all(
        BRANCHES.map((b) =>
          cachedQuery(`home:empties:${b.id}:${day}`, 60 * 1000, () =>
            supabase.rpc('empties_report', { p_branch: b.id, p_day: day }),
          ),
        ),
      ),
    ])
    const error = ordersResult.error || stockResult.error
    if (error) return setMessage(error.message)
    setMessage('')
    setOrders(ordersResult.data)
    setStock(stockResult.data || [])
    setSizes((pricesResult.data || []).map((p) => p.size))
    setLevels(Object.fromEntries((pricesResult.data || []).map((p) => [p.size, p.low_stock_level])))
    const e = {}
    BRANCHES.forEach((b, i) => {
      e[b.id] = {}
      for (const r of emptiesResults[i].data || []) e[b.id][r.size] = Number(r.actual ?? r.ending ?? 0)
    })
    setEmpties(e)
  }, [])

  useEffect(() => {
    load()
  }, [load])
  useLiveTables(['orders', 'stock', 'stock_movements', 'empties_days', 'lpg_prices'], load, {
    cachePrefix: 'home:',
    delay: 1500,
  })

  const loading = orders === null
  const branchIds = onlyBranch ? [branch] : BRANCHES.map((b) => b.id)
  const rows = (orders || []).filter((o) => branchIds.includes(o.branch))

  // ---------------- sales ----------------
  const byDay = {}
  for (const o of rows) (byDay[localDateString(o.accepted_at)] ||= []).push(o)
  const dayList = (n) => byDay[dateString(daysAgo(n))] || []
  const today = dayList(0)
  const yesterday = dayList(1)
  const last7 = Array.from({ length: 7 }, (_, i) => dayList(i)).flat()
  const net = (list) => revenue(list) - expensesOfOrders(list)

  const week = Array.from({ length: 7 }, (_, i) => 6 - i).map((n) => {
    const list = dayList(n)
    const d = daysAgo(n)
    return { n, label: n === 0 ? 'Today' : DAY_NAMES[d.getDay()], date: d, revenue: revenue(list), expenses: expensesOfOrders(list), sales: salesOf(list) }
  })
  const weekTotal = sum(week, (d) => d.revenue)
  const weekExpenses = sum(week, (d) => d.expenses)
  const prevWeekTotal = sum(Array.from({ length: 7 }, (_, i) => i + 7), (n) => revenue(dayList(n)))
  const weekMax = Math.max(...week.map((d) => Math.max(d.revenue, d.expenses)), 1)

  // sales by hour: today vs the average of the 6 days before
  const HOURS = Array.from({ length: 16 }, (_, i) => i + 6) // 6 AM to 9 PM
  const hourOf = (o) => new Date(o.accepted_at).getHours()
  const before = Array.from({ length: 6 }, (_, i) => dayList(i + 1)).flat()
  const hours = HOURS.map((h) => ({
    h,
    today: tanksOf(today.filter((o) => hourOf(o) === h)),
    avg: tanksOf(before.filter((o) => hourOf(o) === h)) / 6,
  }))
  const hourMax = Math.max(...hours.map((x) => Math.max(x.today, x.avg)), 1)
  const busiest = hours.reduce((a, b) => (b.avg > a.avg ? b : a), hours[0])
  const hourText = (h) => `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`

  // sizes sold, last 7 days
  const sizeRows = sizes.map((s) => {
    const list = last7.filter((o) => sizeOf(o.item_name) === s)
    return { size: s, tanks: tanksOf(list), revenue: revenue(list) }
  })
  const sizeMax = Math.max(...sizeRows.map((s) => s.revenue), 1)

  // payments, last 7 days
  const utang = revenue(last7.filter(isUtang))
  const gcash = revenue(last7.filter(isGcash))
  const cash = revenue(last7) - utang - gcash
  const payTotal = cash + gcash + utang
  const payments = [
    { label: 'Cash', value: cash, color: C.cash },
    { label: 'GCash', value: gcash, color: C.gcash },
    { label: 'Utang (unpaid)', value: utang, color: C.utang },
  ]

  // today by branch
  const branchRows = BRANCHES.filter((b) => branchIds.includes(b.id))
    .map((b) => {
      const list = today.filter((o) => o.branch === b.id)
      return { id: b.id, name: b.name, revenue: revenue(list), sales: salesOf(list) }
    })
    .sort((a, b) => b.revenue - a.revenue)
  const branchMax = Math.max(...branchRows.map((b) => b.revenue), 1)

  // ---------------- inventory ----------------
  const filledOf = (id, size) =>
    sum(stock.filter((r) => r.branch === id && sizeOf(r.item_name) === size), (r) => Number(r.quantity || 0))
  const invBranches = BRANCHES.filter((b) => branchIds.includes(b.id))
  const statusOf = (qty, size) => stockStatus(`LPG Cylinder ${size}`, qty, levels)
  const grid = invBranches.map((b) => ({ ...b, cells: sizes.map((s) => ({ size: s, qty: filledOf(b.id, s) })) }))
  const alerts = grid.flatMap((b) => b.cells.filter((c) => statusOf(c.qty, c.size) !== 'In stock').map((c) => ({ ...c, branch: b.name })))
  const filledTotal = sum(grid, (b) => sum(b.cells, (c) => c.qty))
  const emptyTotal = sum(invBranches, (b) => sum(Object.values(empties[b.id] || {}), Number))

  // days of stock left per size: filled now / average tanks sold a day (last 7 days)
  const cover = sizes.map((s) => {
    const filled = sum(invBranches, (b) => filledOf(b.id, s))
    const perDay = tanksOf(last7.filter((o) => sizeOf(o.item_name) === s)) / 7
    return { size: s, filled, perDay, days: perDay > 0 ? filled / perDay : null }
  })
  const coverColor = (d) => (d === null ? '#8f9d96' : d < 3 ? C.out : d < 7 ? C.low : C.ok)
  const coverLabel = (d) => (d === null ? 'no sales' : d < 3 ? 'reorder now' : d < 7 ? 'reorder soon' : 'enough')
  const COVER_SCALE = 30 // days shown at full bar width

  // filled vs empty per branch
  const tankRows = invBranches.map((b) => {
    const filled = sum(sizes, (s) => filledOf(b.id, s))
    const empty = sum(Object.values(empties[b.id] || {}), Number)
    return { id: b.id, name: b.name, filled, empty, total: filled + empty }
  })
  const tankMax = Math.max(...tankRows.map((t) => t.total), 1)

  const tiles = [
    { label: "Today's Revenue", value: peso(revenue(today)), change: changeOf(revenue(today), revenue(yesterday)) },
    { label: 'Sales Today', value: salesOf(today).toLocaleString('en-PH'), change: changeOf(salesOf(today), salesOf(yesterday)), sub: `${num(tanksOf(today))} tanks` },
    { label: 'LPG Sold Today', value: `${num(sum(today, kgOf))} kg`, change: changeOf(sum(today, kgOf), sum(yesterday, kgOf)) },
    { label: 'Net Today', value: peso(net(today)), change: changeOf(net(today), net(yesterday)), negative: net(today) < 0 },
    { label: 'Filled Tanks Now', value: num(filledTotal), sub: `${num(emptyTotal)} empty` },
    {
      label: 'Stock Alerts',
      value: alerts.length,
      sub: alerts.length ? `${alerts.filter((a) => a.qty === 0).length} out, ${alerts.filter((a) => a.qty > 0).length} low` : 'all sizes in stock',
      negative: alerts.some((a) => a.qty === 0),
    },
  ]

  const scopeText = onlyBranch ? branchName(branch) : 'all branches'

  return (
    // dimmed until the first numbers arrive, so empty charts are not mistaken for no sales
    <div className={`${CARD} grid gap-5 p-4 transition-opacity ${loading ? 'opacity-50' : ''}`} aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 border-l-2 pl-3 text-[20px] font-bold" style={{ color: GREEN, borderColor: GREEN }}>
          Analytics
        </h2>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <div className="flex rounded-lg border border-(color:--border) p-0.5 text-[14px] font-semibold" role="group" aria-label="Branch filter">
            {[
              { only: false, label: 'All branches' },
              { only: true, label: branchName(branch) },
            ].map((f) => (
              <button
                key={String(f.only)}
                type="button"
                aria-pressed={onlyBranch === f.only}
                onClick={() => setOnlyBranch(f.only)}
                className="min-h-0 rounded-md px-3 py-1 text-[14px] text-white"
                style={{ background: onlyBranch === f.only ? GREEN : '#5d8f80' }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onOpenAnalytics}
            className="min-h-0 rounded-lg px-3 py-1.5 text-[14px] font-semibold text-white"
            style={{ background: GREEN }}
          >
            Full analytics →
          </button>
        </div>
      </div>
      {message && <p className="m-0 text-[14px] text-brand-red">{message}</p>}

      {/* ---- today at a glance ---- */}
      <div>
        <div className={`grid grid-cols-6 gap-3 max-[1300px]:grid-cols-3 max-[700px]:grid-cols-2 ${loading ? 'animate-pulse opacity-60' : ''}`}>
          {tiles.map((t) => (
            <div key={t.label} className="flex flex-col gap-0.5 rounded-xl border border-(color:--border) p-3">
              <span className="text-[13px] text-gray-500">{t.label}</span>
              <span className={`text-[21px] leading-tight font-bold tabular-nums ${t.negative ? 'text-brand-red' : 'text-gray-900'}`}>
                {loading ? '—' : t.value}
              </span>
              {!loading && t.change && <Change change={t.change} label="vs yesterday" />}
              {!loading && t.sub && <span className="text-[13px] text-gray-500">{t.sub}</span>}
            </div>
          ))}
        </div>
        <Legend
          items={[
            { mark: '▲', markClass: 'text-brand-pine-light', label: 'better than yesterday' },
            { mark: '▼', markClass: 'text-brand-red', label: 'worse than yesterday' },
            { mark: 'new', label: 'no sales yesterday' },
            { mark: 'Net', label: 'revenue minus expenses' },
          ]}
        />
      </div>

      {/* ================= SALES ================= */}
      <SectionTitle hint={`${scopeText} · last 7 days`}>Sales</SectionTitle>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* revenue vs expenses per day */}
        <div className={PANEL}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
            <span className={PANEL_TITLE}>Revenue vs expenses</span>
            <span className="text-[13px] tabular-nums text-gray-500">
              {peso(weekTotal)} · net {peso(weekTotal - weekExpenses)}{' '}
              {!loading && <Change change={changeOf(weekTotal, prevWeekTotal)} label="vs previous 7 days" />}
            </span>
          </div>
          <div className="flex h-40 items-end gap-2 border-b border-gray-200" role="img" aria-label="Revenue and expenses per day, last 7 days">
            {week.map((d) => (
              <div key={d.n} className="group relative flex h-full flex-1 items-end justify-center gap-[2px]">
                {[
                  { v: d.revenue, c: C.revenue },
                  { v: d.expenses, c: C.expenses },
                ].map((bar, i) => (
                  <div
                    key={i}
                    className="w-full max-w-5 rounded-t-[4px]"
                    style={{ height: `${(bar.v / weekMax) * 90}%`, minHeight: bar.v > 0 ? 2 : 0, background: bar.c }}
                  />
                ))}
                <Tip>
                  <div className="font-semibold">{d.date.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                  <div>Revenue: {peso(d.revenue)}</div>
                  <div>Expenses: {peso(d.expenses)}</div>
                  <div className="font-semibold">Net: {peso(d.revenue - d.expenses)}</div>
                  <div className="text-gray-500">{d.sales} sales</div>
                </Tip>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-2">
            {week.map((d) => (
              <span key={d.n} className={`flex-1 text-center text-[12px] ${d.n === 0 ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>
                {d.label}
              </span>
            ))}
          </div>
          <Legend
            items={[
              { color: C.revenue, label: 'Revenue' },
              { color: C.expenses, label: 'Expenses' },
              { mark: '▲▼', label: 'revenue vs the 7 days before' },
            ]}
          />
        </div>

        {/* sales by hour */}
        <div className={PANEL}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
            <span className={PANEL_TITLE}>Tanks sold by hour</span>
            <span className="text-[13px] text-gray-500">
              {busiest && busiest.avg > 0 ? `usually busiest at ${hourText(busiest.h)}` : ''}
            </span>
          </div>
          <div className="flex h-40 items-end gap-1 border-b border-gray-200" role="img" aria-label="Tanks sold by hour, today and the usual day">
            {hours.map((x) => (
              <div key={x.h} className="group relative flex h-full flex-1 items-end justify-center">
                <div
                  className="w-full max-w-4 rounded-t-[4px]"
                  style={{ height: `${(x.today / hourMax) * 90}%`, minHeight: x.today > 0 ? 2 : 0, background: C.revenue }}
                />
                {/* the usual day: a marker line at the 6-day average */}
                {x.avg > 0 && (
                  <div className="absolute inset-x-0 h-[2px] rounded" style={{ bottom: `${(x.avg / hourMax) * 90}%`, background: C.usual }} />
                )}
                <Tip>
                  <div className="font-semibold">{hourText(x.h)} – {hourText(x.h + 1)}</div>
                  <div>Today: {num(x.today)} tanks</div>
                  <div className="text-gray-500">Usual: {num(x.avg)} tanks</div>
                </Tip>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-1">
            {hours.map((x) => (
              <span key={x.h} className="flex-1 text-center text-[11px] text-gray-500">{x.h % 3 === 0 ? hourText(x.h) : ''}</span>
            ))}
          </div>
          <Legend
            items={[
              { color: C.revenue, label: 'Today' },
              { color: C.usual, label: 'Usual day (average of the 6 days before)' },
            ]}
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* sizes */}
        <div className={PANEL}>
          <span className={`${PANEL_TITLE} mb-2 block`}>Sales by size</span>
          <div className="grid gap-2">
            {sizeRows.map((s) => (
              <div key={s.size} className="grid gap-1">
                <div className="flex justify-between text-[13px]">
                  <span className="text-gray-700">{s.size}</span>
                  <span className="tabular-nums text-gray-900">
                    {peso(s.revenue)} <span className="text-gray-500">· {num(s.tanks)} pcs</span>
                  </span>
                </div>
                <StackBar parts={[{ label: 'r', value: s.revenue, color: C.revenue }]} total={sizeMax} height="h-1.5" />
              </div>
            ))}
          </div>
          <Legend items={[{ color: C.revenue, label: 'Revenue, last 7 days' }, { mark: 'pcs', label: 'tanks sold' }]} />
        </div>

        {/* payments */}
        <div className={PANEL}>
          <span className={`${PANEL_TITLE} mb-2 block`}>How customers paid</span>
          <StackBar parts={payments} total={payTotal} height="h-4" />
          <div className="mt-3 grid gap-1.5">
            {payments.map((p) => (
              <div key={p.label} className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-1.5 text-gray-700">
                  <span className="inline-block size-2.5 rounded-[3px]" style={{ background: p.color }} />
                  {p.label}
                </span>
                <span className="tabular-nums text-gray-900">
                  {peso(p.value)} <span className="text-gray-500">· {payTotal ? Math.round((p.value / payTotal) * 100) : 0}%</span>
                </span>
              </div>
            ))}
          </div>
          <Legend items={[{ mark: '%', label: 'share of revenue, last 7 days' }]} />
        </div>

        {/* today by branch */}
        <div className={PANEL}>
          <span className={`${PANEL_TITLE} mb-2 block`}>Today by branch</span>
          <div className="grid gap-2">
            {branchRows.map((b) => (
              <div key={b.id} className="grid gap-1">
                <div className="flex justify-between text-[13px]">
                  <span className="text-gray-700">{b.name}</span>
                  <span className="tabular-nums text-gray-900">
                    {peso(b.revenue)} <span className="text-gray-500">· {b.sales}</span>
                  </span>
                </div>
                <StackBar parts={[{ label: 'r', value: b.revenue, color: C.revenue }]} total={branchMax} height="h-1.5" />
              </div>
            ))}
          </div>
          <Legend items={[{ color: C.revenue, label: 'Revenue today' }, { mark: '· n', label: 'number of sales' }]} />
        </div>
      </div>

      {/* ================= INVENTORY ================= */}
      <SectionTitle hint={`${scopeText} · now`}>Inventory</SectionTitle>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* filled stock per branch and size */}
        <div className={PANEL}>
          <span className={`${PANEL_TITLE} mb-2 block`}>Filled tanks by branch and size</span>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 border-0 bg-transparent text-[13px]">
              <thead>
                <tr>
                  <th className="border-0 bg-transparent p-1 text-left font-semibold text-gray-500">Branch</th>
                  {sizes.map((s) => (
                    <th key={s} className="border-0 bg-transparent p-1 text-center font-semibold text-gray-500">{s}</th>
                  ))}
                  <th className="border-0 bg-transparent p-1 text-right font-semibold text-gray-500">Total</th>
                </tr>
              </thead>
              <tbody>
                {grid.map((b) => (
                  <tr key={b.id}>
                    <td className="border-0 p-1 text-gray-700">{b.name}</td>
                    {b.cells.map((c) => {
                      const status = statusOf(c.qty, c.size)
                      return (
                        <td
                          key={c.size}
                          className={`rounded-md border-0 p-1 text-center font-semibold tabular-nums ${STATUS_STYLE[status]}`}
                          title={`${b.name} ${c.size}: ${c.qty} filled · ${status} (low at ${levels[c.size] ?? DEFAULT_LOW_LEVEL})`}
                        >
                          {c.qty}
                          {status !== 'In stock' && <span className="ml-0.5">{status === 'Out of stock' ? '✕' : '!'}</span>}
                        </td>
                      )
                    })}
                    <td className="border-0 p-1 text-right font-semibold tabular-nums text-gray-900">{num(sum(b.cells, (c) => c.qty))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Legend
            items={[
              { color: '#e6f2ec', label: 'In stock' },
              { mark: '!', markClass: 'text-[#92400e]', label: 'Low stock (at or under the low level)' },
              { mark: '✕', markClass: 'text-[#991b1b]', label: 'Out of stock' },
            ]}
          />
        </div>

        <div className="grid gap-4">
          {/* days of stock left */}
          <div className={PANEL}>
            <span className={`${PANEL_TITLE} mb-2 block`}>Days of stock left</span>
            <div className="grid gap-2">
              {cover.map((c) => (
                <div key={c.size} className="grid gap-1" title={`${c.size}: ${c.filled} filled, about ${num(c.perDay)} sold a day`}>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-gray-700">{c.size}</span>
                    <span className="tabular-nums text-gray-900">
                      {c.days === null ? '—' : `${num(c.days)} days`}{' '}
                      <span className="font-semibold" style={{ color: coverColor(c.days) }}>· {coverLabel(c.days)}</span>
                    </span>
                  </div>
                  <StackBar
                    parts={[{ label: 'd', value: c.days === null ? 0 : Math.min(c.days, COVER_SCALE), color: coverColor(c.days) }]}
                    total={COVER_SCALE}
                    height="h-1.5"
                  />
                </div>
              ))}
            </div>
            <Legend
              items={[
                { color: C.out, label: 'under 3 days' },
                { color: C.low, label: '3–7 days' },
                { color: C.ok, label: '7+ days' },
                { mark: '=', label: 'filled now ÷ tanks sold a day (7-day average)' },
              ]}
            />
          </div>

          {/* filled vs empty per branch */}
          <div className={PANEL}>
            <span className={`${PANEL_TITLE} mb-2 block`}>Filled vs empty tanks</span>
            <div className="grid gap-2">
              {tankRows.map((t) => (
                <div key={t.id} className="grid gap-1" title={`${t.name}: ${t.filled} filled, ${t.empty} empty`}>
                  <div className="flex justify-between text-[13px]">
                    <span className="text-gray-700">{t.name}</span>
                    <span className="tabular-nums text-gray-900">
                      {num(t.filled)} <span className="text-gray-500">/ {num(t.empty)}</span>
                    </span>
                  </div>
                  <div style={{ width: `${(t.total / tankMax) * 100}%` }}>
                    <StackBar
                      parts={[
                        { label: 'Filled', value: t.filled, color: C.filled },
                        { label: 'Empty', value: t.empty, color: C.empty },
                      ]}
                      total={t.total}
                      height="h-2"
                    />
                  </div>
                </div>
              ))}
            </div>
            <Legend items={[{ color: C.filled, label: 'Filled' }, { color: C.empty, label: 'Empty (to refill)' }]} />
          </div>
        </div>
      </div>
    </div>
  )
}
