import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { cachedQuery } from '../lib/lazyData'
import { amountOf } from '../lib/monthly'
import { expensesOfOrders } from '../lib/expenses'
import { BRANCHES, branchName } from '../lib/branches'
import { dateString } from '../lib/dateUtils'
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
const ALL = 0 // the branch filter: every branch
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad2 = (n) => String(n).padStart(2, '0')
const compactPeso = (n) =>
  n >= 1_000_000 ? `₱${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `₱${(n / 1_000).toFixed(1)}k` : `₱${Math.round(n)}`

// chart colors: series (identity) and stock status (state, always shown with a label too)
// sizes in the pie: a fixed order (validated for color-blind separation), the same size keeps its color
const SIZE_COLORS = ['#15805f', '#e08a1e', '#3a6fc0', '#b13c78']

const C = {
  revenue: '#0b4436',
  expenses: '#d97706',
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
function StackBar({ parts, total, height = 'h-3', delay = 0 }) {
  return (
    <div className={`flex ${height} w-full gap-[2px] overflow-hidden rounded-full bg-gray-100`}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <div
            key={p.label}
            className="chart-bar-h"
            style={{ width: `${(p.value / Math.max(total, 1)) * 100}%`, background: p.color, animationDelay: `${delay}ms` }}
          />
        ))}
    </div>
  )
}

// Pie of the sales by size (share of revenue). Slices sweep in one after another; hovering a slice
// or its row shows its numbers. rows: [{ size, revenue, tanks }]
function SizePie({ rows }) {
  const [hover, setHover] = useState(null)
  const total = sum(rows, (r) => r.revenue)
  const R = 50 // the pie radius; drawn as a circle of radius R/2 with a stroke as wide as R
  const CIRC = 2 * Math.PI * (R / 2)
  const GAP = total > 0 && rows.filter((r) => r.revenue > 0).length > 1 ? 1.2 : 0
  const lens = rows.map((r) => (total > 0 ? (r.revenue / total) * CIRC : 0))
  // each slice starts where the ones before it end
  const slices = rows.map((r, i) => ({
    ...r,
    color: SIZE_COLORS[i % SIZE_COLORS.length],
    len: lens[i],
    offset: lens.slice(0, i).reduce((a, b) => a + b, 0),
    share: total > 0 ? r.revenue / total : 0,
  }))
  const shown = slices.find((x) => x.size === hover)
  return (
    <div className="grid items-center gap-4 md:grid-cols-[230px_minmax(0,1fr)]">
      <svg viewBox="0 0 100 100" className="mx-auto size-[230px] -rotate-90" role="img" aria-label="Share of revenue by cylinder size">
        <circle cx="50" cy="50" r="50" fill="#eef2f0" />
        {slices
          .filter((x) => x.len > 0)
          .map((x) => (
            <circle
              key={x.size}
              className="chart-pie-seg cursor-pointer"
              cx="50"
              cy="50"
              r={R / 2}
              fill="none"
              stroke={x.color}
              strokeWidth={R}
              strokeDasharray={`${Math.max(x.len - GAP, 0.01)} ${CIRC}`}
              strokeDashoffset={-x.offset}
              style={{ '--c': CIRC, animationDelay: `${(x.offset / CIRC) * 600}ms`, opacity: hover && hover !== x.size ? 0.35 : 1 }}
              onMouseEnter={() => setHover(x.size)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${x.size}: ${peso(x.revenue)} (${(x.share * 100).toFixed(1)}%), ${num(x.tanks)} tanks`}</title>
            </circle>
          ))}
      </svg>
      <div className="grid gap-1.5">
        {slices.map((x) => (
          <div
            key={x.size}
            className={`flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-[13px] ${hover === x.size ? 'bg-gray-100' : ''}`}
            onMouseEnter={() => setHover(x.size)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="flex items-center gap-1.5 text-gray-700">
              <span className="inline-block size-2.5 rounded-[3px]" style={{ background: x.color }} />
              {x.size}
              <span className="font-semibold text-gray-900">{(x.share * 100).toFixed(0)}%</span>
            </span>
            <span className="tabular-nums text-gray-900">
              {peso(x.revenue)} <span className="text-gray-500">· {num(x.tanks)} pcs</span>
            </span>
          </div>
        ))}
        <p className="m-0 min-h-5 px-1.5 text-[12px] text-gray-500">
          {shown
            ? `${shown.size}: ${(shown.share * 100).toFixed(1)}% of revenue, ${num(shown.tanks)} tanks`
            : total > 0
              ? `Total ${peso(total)}`
              : 'No sales in this period'}
        </p>
      </div>
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

const EMPTY = { orders: null, stock: [], sizes: [], levels: {}, firstYear: null, message: '' }

// everything the analytics need: the accepted orders in [fromKey, toKey), the current stock
// ([{ branch, item_name, quantity }]), the sizes with their low stock levels, and the year of the
// oldest order.
async function fetchHome(fromKey, toKey) {
  const [ordersResult, stockResult, pricesResult, firstResult] = await Promise.all([
    cachedQuery(`home:orders:${fromKey}:${toKey}`, 60 * 1000, () =>
      fetchAll(() =>
        supabase
          .from('orders')
          .select('id, group_id, branch, item_name, quantity, unit_price, discount, remarks, accepted_at, paid_gcash, utang_status')
          .eq('status', 'accepted')
          .gte('accepted_at', new Date(`${fromKey}T00:00:00`).toISOString())
          .lt('accepted_at', new Date(`${toKey}T00:00:00`).toISOString())
          .order('id'),
      ),
    ),
    cachedQuery('home:stock', 60 * 1000, () => supabase.from('stock').select('branch, item_name, quantity')),
    lpgPrices(),
    cachedQuery('home:first-year', 10 * 60 * 1000, () =>
      supabase.from('orders').select('accepted_at').eq('status', 'accepted').not('accepted_at', 'is', null).order('accepted_at').limit(1),
    ),
  ])
  const error = ordersResult.error || stockResult.error
  const key = `${fromKey}:${toKey}`
  if (error) return { ...EMPTY, key, orders: [], message: error.message }
  return {
    key,
    orders: ordersResult.data,
    stock: stockResult.data || [],
    sizes: (pricesResult.data || []).map((p) => p.size),
    levels: Object.fromEntries((pricesResult.data || []).map((p) => [p.size, p.low_stock_level])),
    firstYear: firstResult.data?.[0] ? new Date(firstResult.data[0].accepted_at).getFullYear() : null,
    message: '',
  }
}

// Admin Home analytics, filtered by one branch (or all), a month (or the whole year) and a year:
//  Sales: the period's numbers vs the same days of the period before, revenue vs expenses for the
//  last 3 months, sales by size (pie) and by branch.
//  Inventory (always now): filled stock per branch and size, with low / out of stock marked.
export default function HomeAnalytics({ branch, onOpenAnalytics }) {
  const now = new Date()
  const [picked, setPicked] = useState(ALL) // the branch filter: ALL or a branch id
  const [month, setMonth] = useState(pad2(now.getMonth() + 1)) // '01'..'12', '' = the whole year
  const [year, setYear] = useState(String(now.getFullYear()))
  // picking another branch on the home page filters the analytics to it
  const [shownBranch, setShownBranch] = useState(branch)
  if (shownBranch !== branch) {
    setShownBranch(branch)
    setPicked(branch)
  }
  const onlyBranch = picked !== ALL
  const [data, setData] = useState(EMPTY)

  // the period [start, end), the period before it, and what is loaded (also the last 7 days)
  const y = Number(year)
  const m = month ? Number(month) : 0
  const start = m ? new Date(y, m - 1, 1) : new Date(y, 0, 1)
  const end = m ? new Date(y, m, 1) : new Date(y + 1, 0, 1)
  const prevStart = m ? new Date(y, m - 2, 1) : new Date(y - 1, 0, 1)
  const todayStart = daysAgo(0)
  const tomorrow = daysAgo(-1)
  // the revenue vs expenses chart: the last 3 months up to the chosen month (a whole year: up to
  // its last month, or this month for this year)
  const lastMonth = m || (y === now.getFullYear() ? now.getMonth() + 1 : 12)
  const threeStart = new Date(y, lastMonth - 3, 1)
  const fromKey = dateString(threeStart < prevStart ? threeStart : prevStart)
  const toKey = dateString(end > tomorrow ? end : tomorrow)

  // loads again when the period changes, and on every live change of the tables below
  useEffect(() => {
    let current = true
    fetchHome(fromKey, toKey).then((d) => current && setData(d))
    return () => {
      current = false
    }
  }, [fromKey, toKey])
  useLiveTables(['orders', 'stock', 'stock_movements', 'lpg_prices'], () => fetchHome(fromKey, toKey).then(setData), {
    cachePrefix: 'home:',
    delay: 1500,
  })
  const { orders, stock, sizes, levels, message } = data
  const firstYear = data.firstYear ?? now.getFullYear()

  // dimmed while the numbers of a newly picked period load
  const loading = orders === null || data.key !== `${fromKey}:${toKey}`
  // the charts animate again when the filters change (once the new numbers are in)
  const animKey = `${picked}:${month}:${year}:${loading ? 'wait' : 'ready'}`
  const branchIds = onlyBranch ? [picked] : BRANCHES.map((b) => b.id)
  const rows = (orders || []).filter((o) => branchIds.includes(o.branch))
  const between = (a, b) => rows.filter((o) => {
    const t = new Date(o.accepted_at)
    return t >= a && t < b
  })

  // ---------------- sales ----------------
  // a period still running is compared with the same number of days of the period before
  const running = todayStart >= start && todayStart < end
  const periodEnd = running ? tomorrow : end
  const elapsedDays = Math.max(1, Math.round((periodEnd - start) / 86400000))
  const sameDays = new Date(prevStart.getFullYear(), prevStart.getMonth(), prevStart.getDate() + elapsedDays)
  const prevEnd = running && sameDays < start ? sameDays : start
  const period = between(start, periodEnd)
  const prev = between(prevStart, prevEnd)
  const today = between(todayStart, tomorrow)
  const net = (list) => revenue(list) - expensesOfOrders(list)
  const future = start > todayStart
  const unit = m ? 'month' : 'year'
  const compareLabel = running ? `vs same days last ${unit}` : `vs last ${unit}`
  const periodText = m ? `${MONTHS[m - 1]} ${year}` : year

  // revenue vs expenses: per day of the month, or per month of the year (up to today)
  const buckets = [2, 1, 0].map((back) => {
    const a = new Date(y, lastMonth - 1 - back, 1)
    const b = new Date(y, lastMonth - back, 1)
    return { key: back, label: `${MONTHS[a.getMonth()].slice(0, 3)} ${a.getFullYear()}`, title: `${MONTHS[a.getMonth()]} ${a.getFullYear()}`, a, b }
  })
  const trend = buckets
    .filter((k) => k.a <= todayStart)
    .map((k) => {
      const list = between(k.a, k.b)
      return { ...k, revenue: revenue(list), expenses: expensesOfOrders(list), sales: salesOf(list) }
    })
  const trendMax = Math.max(...trend.map((d) => Math.max(d.revenue, d.expenses)), 1)

  // sizes sold in the period
  const sizeRows = sizes.map((s) => {
    const list = period.filter((o) => sizeOf(o.item_name) === s)
    return { size: s, tanks: tanksOf(list), revenue: revenue(list) }
  })

  // the period by branch
  const branchRows = BRANCHES.filter((b) => branchIds.includes(b.id))
    .map((b) => {
      const list = period.filter((o) => o.branch === b.id)
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

  const years = Array.from({ length: now.getFullYear() - firstYear + 1 }, (_, i) => String(now.getFullYear() - i))

  const tiles = [
    {
      label: 'Revenue',
      value: peso(revenue(period)),
      change: changeOf(revenue(period), revenue(prev)),
      sub: running ? `today ${peso(revenue(today))} · ${peso(revenue(period) / elapsedDays)} a day` : `${peso(revenue(period) / elapsedDays)} a day`,
    },
    { label: 'Sales', value: salesOf(period).toLocaleString('en-PH'), change: changeOf(salesOf(period), salesOf(prev)), sub: `${num(tanksOf(period))} tanks` },
    { label: 'LPG Sold', value: `${num(sum(period, kgOf))} kg`, change: changeOf(sum(period, kgOf), sum(prev, kgOf)) },
    {
      label: 'Net Income',
      value: peso(net(period)),
      change: changeOf(net(period), net(prev)),
      negative: net(period) < 0,
      sub: revenue(period) > 0 ? `margin ${((net(period) / revenue(period)) * 100).toFixed(1)}%` : '',
    },
  ]

  const scopeText = onlyBranch ? branchName(picked) : 'all branches'

  return (
    // dimmed until the first numbers arrive, so empty charts are not mistaken for no sales
    <div className={`${CARD} grid gap-5 p-4 transition-opacity ${loading ? 'opacity-50' : ''}`} aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 border-l-2 pl-3 text-[20px] font-bold" style={{ color: GREEN, borderColor: GREEN }}>
          Analytics
        </h2>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
          <select value={picked} onChange={(e) => setPicked(Number(e.target.value))} aria-label="Branch">
            <option value={ALL}>All branches</option>
            {BRANCHES.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            <option value="">Whole year</option>
            {MONTHS.map((name, i) => (
              <option key={name} value={pad2(i + 1)}>{name}</option>
            ))}
          </select>
          <select value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
            {years.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
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

      {future && <p className="m-0 text-[14px] text-gray-500">{periodText} has not started yet.</p>}

      {/* ---- the period at a glance ---- */}
      <div>
        <div className={`grid grid-cols-4 gap-3 max-[1000px]:grid-cols-2 ${loading ? 'animate-pulse opacity-60' : ''}`}>
          {tiles.map((t) => (
            <div key={t.label} className="flex flex-col gap-0.5 rounded-xl border border-(color:--border) p-3">
              <span className="text-[13px] text-gray-500">{t.label}</span>
              <span className={`text-[21px] leading-tight font-bold tabular-nums ${t.negative ? 'text-brand-red' : 'text-gray-900'}`}>
                {loading ? '—' : t.value}
              </span>
              {!loading && t.change && <Change change={t.change} label={compareLabel} />}
              {!loading && t.sub && <span className="text-[13px] text-gray-500">{t.sub}</span>}
            </div>
          ))}
        </div>
        <Legend
          items={[
            { mark: '▲', markClass: 'text-brand-pine-light', label: `better, ${compareLabel}` },
            { mark: '▼', markClass: 'text-brand-red', label: `worse, ${compareLabel}` },
            { mark: 'new', label: `no sales last ${unit}` },
            { mark: 'Net', label: 'revenue minus expenses' },
          ]}
        />
      </div>

      {/* ================= SALES ================= */}
      <SectionTitle hint={`${scopeText} · ${periodText}`}>Sales</SectionTitle>

        {/* revenue vs expenses, the last 3 months */}
        <div className={PANEL}>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
            <span className={PANEL_TITLE}>Revenue vs expenses, last 3 months</span>
            <span className="text-[13px] tabular-nums text-gray-500">
              net {peso(sum(trend, (d) => d.revenue - d.expenses))} in 3 months
            </span>
          </div>
          <div key={animKey} className="flex h-52 items-end gap-6 border-b border-gray-200 px-2" role="img" aria-label={`Revenue and expenses per month, ${trend.map((d) => d.title).join(', ')}`}>
            {trend.map((d, n) => (
              <div key={d.key} className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-[3px]">
                {[
                  { v: d.revenue, c: C.revenue },
                  { v: d.expenses, c: C.expenses },
                ].map((bar, i) => (
                  <div key={i} className="flex h-full w-full max-w-16 flex-col items-center justify-end">
                    <span className="mb-1 text-[12px] tabular-nums text-gray-700">{bar.v > 0 ? compactPeso(bar.v) : ''}</span>
                    <div
                      className="chart-bar-v w-full rounded-t-[4px]"
                      style={{ height: `${(bar.v / trendMax) * 82}%`, minHeight: bar.v > 0 ? 2 : 0, background: bar.c, animationDelay: `${n * 150 + i * 60}ms` }}
                    />
                  </div>
                ))}
                <Tip>
                  <div className="font-semibold">{d.title}</div>
                  <div>Revenue: {peso(d.revenue)}</div>
                  <div>Expenses: {peso(d.expenses)}</div>
                  <div className="font-semibold">Net: {peso(d.revenue - d.expenses)}</div>
                  <div className="text-gray-500">{d.sales} sales</div>
                </Tip>
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-6 px-2">
            {trend.map((d) => (
              <span key={d.key} className="min-w-0 flex-1 text-center text-[13px]">
                <span className="block font-semibold text-gray-900">{d.label}</span>
                <span className={`block tabular-nums ${d.revenue - d.expenses < 0 ? 'text-brand-red' : 'text-gray-500'}`}>
                  net {peso(d.revenue - d.expenses)}
                </span>
              </span>
            ))}
          </div>
          <Legend
            items={[
              { color: C.revenue, label: 'Revenue' },
              { color: C.expenses, label: 'Expenses' },
              { mark: '₱k / ₱M', label: 'thousand / million pesos' },
              { mark: '↑', label: 'hover a month for its sales' },
            ]}
          />
        </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* sizes */}
        <div className={PANEL}>
          <span className={`${PANEL_TITLE} mb-2 block`}>Sales by size</span>
          <SizePie key={animKey} rows={sizeRows} />
          <Legend items={[{ mark: '%', label: `share of revenue, ${periodText}` }, { mark: 'pcs', label: 'tanks sold' }]} />
        </div>

        {/* the period by branch */}
        <div className={PANEL}>
          <span className={`${PANEL_TITLE} mb-2 block`}>By branch</span>
          <div className="grid gap-2">
            {branchRows.map((b, i) => (
              <div key={b.id} className="grid gap-1">
                <div className="flex justify-between text-[13px]">
                  <span className="text-gray-700">{b.name}</span>
                  <span className="tabular-nums text-gray-900">
                    {peso(b.revenue)} <span className="text-gray-500">· {b.sales}</span>
                  </span>
                </div>
                <StackBar key={animKey} parts={[{ label: 'r', value: b.revenue, color: C.revenue }]} total={branchMax} height="h-1.5" delay={i * 60} />
              </div>
            ))}
          </div>
          <Legend items={[{ color: C.revenue, label: `Revenue, ${periodText}` }, { mark: '· n', label: 'number of sales' }]} />
        </div>
      </div>

      {/* ================= INVENTORY ================= */}
      <SectionTitle hint={`${scopeText} · now`}>Inventory</SectionTitle>

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
    </div>
  )
}
