import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LabelList,
} from 'recharts'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { cachedQuery, invalidate } from '../lib/lazyData'
import { amountOf } from '../lib/monthly'
import { expensesOfOrders } from '../lib/expenses'
import { branchName, BRANCHES } from '../lib/branches'
import { dateString, localDateString, todayString } from '../lib/dateUtils'
import { peso } from '../lib/money'
import AiInsights from '../components/AiInsights'
import BusinessAnalytics, { Change } from '../components/BusinessAnalytics'
import { changeOf } from '../lib/compare'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const SOLID = 'rounded-lg bg-brand-pine px-4 py-2 text-white hover:bg-brand-pine-light'

const OVERALL = 0
// shared chart palette (same colors as the Product performance chart)
const CHART_GREEN = '#005746'
const CHART_RED = '#a80202'
const CHART_MINT = '#70e6dc'
const CHART_AMBER = '#d97706'

// compact value labels drawn on top of the bars
const compactPeso = (value) => {
  const n = Number(value || 0)
  if (n >= 1_000_000) return `₱${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `₱${(n / 1_000).toFixed(1)}k`
  return `₱${n.toFixed(0)}`
}
const compactNumber = (value) => Number(value || 0).toFixed(1)
const compactCount = (value) => Number(value || 0).toLocaleString('en-PH')

const PERIODS = [
  { key: '7', label: '7 days', days: 7 },
  { key: '15', label: '15 days', days: 15 },
  { key: '30', label: '30 days', days: 30 },
]

// the standard cylinder sizes, in kg
const KNOWN_SIZES = [2.7, 11, 22, 50]

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const INVENTORY_COLORS = [CHART_GREEN, CHART_RED]
const ORDER_SPLIT_COLORS = [CHART_GREEN, CHART_RED, CHART_MINT]

// "LPG Cylinder 11kg" -> "11kg"
const sizeOf = (itemName) => (itemName || '').replace('LPG Cylinder ', '')

// "11kg" -> 11 (kilograms of LPG per cylinder)
const kgOf = (itemName) => {
  const match = sizeOf(itemName).match(/[\d.]+/)
  return match ? Number(match[0]) : 0
}

// volume in both units: { tons: "1.23 tons", kg: "1,234.5 kg" }
const volume = (kg) => {
  const weight = Number(kg || 0)
  return {
    tons: `${(weight / 1000).toLocaleString('en-PH', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} tons`,
    kg: `${weight.toLocaleString('en-PH', { maximumFractionDigits: 2 })} kg`,
  }
}

// first day of the period, as 'YYYY-MM-DD'
const firstDay = (days) => {
  const d = new Date()
  d.setDate(d.getDate() - (days - 1))
  return localDateString(d)
}

// 'YYYY-MM-DD' moved by n days
const addDays = (day, n) => {
  const d = new Date(`${day}T00:00:00`)
  d.setDate(d.getDate() + n)
  return dateString(d)
}
const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000)

// Only the orders the chosen filter needs are loaded (not every order ever):
// the period, the period before it (for the % change) and the last 3 months (for the trend chart).
// Returns { from, to } as 'YYYY-MM-DD' (to is exclusive; null = no limit).
function neededDays(period, month, year) {
  if (month && !year) return { from: null, to: null } // the same month in every year
  if (year) {
    const prev = month ? new Date(Number(year), Number(month) - 2, 1) : new Date(Number(year) - 1, 0, 1)
    const end = month ? new Date(Number(year), Number(month), 1) : new Date(Number(year) + 1, 0, 1)
    return { from: dateString(prev), to: dateString(end) }
  }
  const days = PERIODS.find((p) => p.key === period)?.days || 30
  const from = new Date()
  from.setHours(0, 0, 0, 0)
  from.setDate(from.getDate() - (2 * days - 1))
  const threeMonths = new Date()
  threeMonths.setHours(0, 0, 0, 0)
  threeMonths.setDate(1)
  threeMonths.setMonth(threeMonths.getMonth() - 2)
  return { from: dateString(from < threeMonths ? from : threeMonths), to: null }
}

const ORDERS_TTL = 2 * 60 * 1000 // switching filters back and forth reuses loaded orders
const INVENTORY_TTL = 60 * 1000

const KPI = 'flex flex-col gap-1 rounded-xl border border-(color:--border) bg-white p-5 text-left'
const CARD = 'flex-1 min-w-[340px] rounded-xl border border-(color:--border) bg-white p-4'

// tooltip for the "revenue vs weight" chart
const MonthTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const rev = payload.find((p) => p.dataKey === 'revenue')
  const wt = payload.find((p) => p.dataKey === 'tons')
  const exp = payload.find((p) => p.dataKey === 'expenses')
  return (
    <div className="rounded-lg border border-(color:--border) bg-white px-3 py-2 text-[14px] shadow">
      <div className="font-semibold">{label}</div>
      {rev && <div>Revenue: {peso(rev.value)}</div>}
      {exp && <div>Expenses: {peso(exp.value)}</div>}
      {rev && exp && <div className="font-semibold">Net: {peso(rev.value - exp.value)}</div>}
      {wt && (
        <div className="text-gray-500">
          {wt.value.toFixed(2)} tons ({(wt.value * 1000).toLocaleString('en-PH')} kg)
        </div>
      )}
    </div>
  )
}

// tooltip for the "Filled vs Empty" pie: totals plus the per-size breakdown
const InventoryTip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const bySize = d.bySize || {}
  return (
    <div className="rounded-lg border border-(color:--border) bg-white px-3 py-2 text-[14px] shadow">
      <div className="font-semibold">{d.name}</div>
      <div>{Number(d.value).toLocaleString('en-PH')} cylinders</div>
      <div className="mt-1">
        {KNOWN_SIZES.map((s) => (
          <div key={s} className="text-gray-500">
            {s} kg: {(bySize[s] || 0).toLocaleString('en-PH')}
          </div>
        ))}
      </div>
    </div>
  )
}

// tooltip for the "Instore, Commercial & Delivered" pie: revenue, count, weight
const OrderSplitTip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const v = volume(d.kg)
  return (
    <div className="rounded-lg border border-(color:--border) bg-white px-3 py-2 text-[14px] shadow">
      <div className="font-semibold">{d.name}</div>
      <div>{d.count.toLocaleString('en-PH')} orders</div>
      <div>{peso(d.revenue)}</div>
      <div className="text-gray-500">
        {v.tons} ({v.kg})
      </div>
    </div>
  )
}

// rounded label "pill" drawn beside each slice (SVG), with a colored accent bar.
// The pill is pushed fully outside the donut so it never covers a slice.
const PieLabelBox = ({ x, y, cy, textAnchor, lines, color }) => {
  const padX = 10
  const padY = 7
  const lineH = 16
  const bar = 3
  const gap = 6
  const edge = 8 // gap between the leader line end and the pill
  const width = Math.max(...lines.map((l) => l.length)) * 6.3 + padX * 2 + bar + gap
  const height = lines.length * lineH + padY * 2
  const align = textAnchor === 'end' ? 'end' : textAnchor === 'middle' ? 'middle' : 'start'
  // middle (top/bottom) labels are tall, so put them to the side instead of above/below
  const side = align === 'middle' ? (y < cy ? 'start' : 'end') : align
  const boxX = side === 'start' ? x + edge : x - width - edge
  const boxY = y - height / 2
  const textX = boxX + padX + bar + gap
  const barX = side === 'end' ? boxX + width - bar : boxX

  return (
    <g>
      <rect x={boxX} y={boxY} width={width} height={height} rx={8} fill="#fff" stroke="#e5e7eb" />
      <rect x={barX} y={boxY + 5} width={bar} height={height - 10} rx={1.5} fill={color} />
      {lines.map((line, i) => (
        <text
          key={i}
          x={textX}
          y={boxY + padY + lineH * i + 12}
          fill={i === 0 ? '#111827' : '#4b5563'}
          fontSize={i === 0 ? 12 : 11}
          fontWeight={i === 0 ? 600 : 400}
        >
          {line}
        </text>
      ))}
    </g>
  )
}

// on-slice labels
const InventoryPieLabel = ({ name, value, fill, bySize = {}, ...rest }) => (
  <PieLabelBox
    {...rest}
    color={fill}
    lines={[
      name,
      `${Number(value).toLocaleString('en-PH')} cylinders`,
      ...KNOWN_SIZES.map((s) => `${s} kg: ${(bySize[s] || 0).toLocaleString('en-PH')}`),
    ]}
  />
)

const OrderPieLabel = ({ name, count, revenue, kg, fill, ...rest }) => (
  <PieLabelBox
    {...rest}
    color={fill}
    lines={[name, `${count.toLocaleString('en-PH')} orders`, peso(revenue), volume(kg).tons]}
  />
)

// tooltip for the horizontal product chart
const ProductTip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  const rev = payload.find((p) => p.dataKey === 'revenue')
  const orders = payload.find((p) => p.dataKey === 'orders')
  return (
    <div className="rounded-lg border border-(color:--border) bg-white px-3 py-2 text-[14px] shadow">
      <div className="font-semibold">{label}</div>
      {rev && <div>{peso(rev.value)}</div>}
      {orders && <div className="text-gray-500">{orders.value} orders</div>}
    </div>
  )
}

// Admin analytics: accepted orders into 4 KPIs, a revenue/weight trend chart,
// inventory and order-split pies, and a product bar chart.
export default function Analytics() {
  const [period, setPeriod] = useState('30')
  const [month, setMonth] = useState('') // 'YYYY-MM' or '' (off)
  const [year, setYear] = useState('') // 'YYYY' or '' (off)
  const [branch, setBranch] = useState(OVERALL) // 0 = Overall (all branches)
  const [orders, setOrders] = useState([])
  const [inv, setInv] = useState({ filled: 0, empty: 0, borrowed: 0, filledBySize: {}, emptyBySize: {} })
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  const [firstYear, setFirstYear] = useState(null)
  const need = useMemo(() => neededDays(period, month, year), [period, month, year])

  // the accepted orders in the needed days (all branches; the branch filter is applied below)
  const loadOrders = useCallback(async () => {
    setLoading(true)
    setMessage('')
    const { data, error } = await cachedQuery(`analytics:orders:${need.from}:${need.to}`, ORDERS_TTL, () =>
      fetchAll(() => {
        let q = supabase.from('orders').select('*').eq('status', 'accepted')
        if (need.from) q = q.gte('accepted_at', new Date(`${need.from}T00:00:00`).toISOString())
        if (need.to) q = q.lt('accepted_at', new Date(`${need.to}T00:00:00`).toISOString())
        return q.order('accepted_at', { ascending: false }).order('id', { ascending: false })
      })
    )
    if (error) setMessage(error.message)
    else setOrders(data)
    setLoading(false)
  }, [need])

  // the year of the oldest order, for the year filter (one row instead of every order)
  const loadFirstYear = async () => {
    const { data } = await cachedQuery('analytics:first-year', 10 * 60 * 1000, () =>
      supabase.from('orders').select('accepted_at').eq('status', 'accepted').not('accepted_at', 'is', null)
        .order('accepted_at').limit(1)
    )
    setFirstYear(data?.[0] ? new Date(data[0].accepted_at).getFullYear() : null)
  }

  // current Filled (stock) and Empty (empties report) counts, per cylinder size
  const loadInventory = async () => {
    const day = todayString()
    let stockQuery = supabase.from('stock').select('quantity, item_name, branch')
    if (branch !== OVERALL) stockQuery = stockQuery.eq('branch', branch)
    const { data: stock } = await cachedQuery(`analytics:stock:${branch}`, INVENTORY_TTL, () => stockQuery)
    const filledBySize = {}
    let filled = 0
    for (const r of stock || []) {
      const size = kgOf(r.item_name)
      const qty = Number(r.quantity || 0)
      filledBySize[size] = (filledBySize[size] || 0) + qty
      filled += qty
    }

    const ids = branch === OVERALL ? BRANCHES.map((b) => b.id) : [branch]
    const results = await Promise.all(
      ids.map((id) =>
        cachedQuery(`analytics:empties:${id}:${day}`, INVENTORY_TTL, () =>
          supabase.rpc('empties_report', { p_branch: id, p_day: day })
        )
      )
    )
    const emptyBySize = {}
    let empty = 0
    for (const r of results) {
      for (const e of r.data || []) {
        const size = kgOf(e.size)
        const qty = Number(e.ending || 0)
        emptyBySize[size] = (emptyBySize[size] || 0) + qty
        empty += qty
      }
    }

    // pahiram still outstanding (borrowed but not yet returned), per branch
    const borrowResults = await Promise.all(ids.map((id) =>
        cachedQuery(`analytics:pahiram:${id}`, INVENTORY_TTL, () => supabase.rpc('pahiram_list', { p_branch: id }))
      ))
    let borrowed = 0
    for (const r of borrowResults) {
      for (const x of r.data || []) {
        borrowed += Math.max(Number(x.borrowed || 0) - Number(x.returned || 0), 0)
      }
    }

    setInv({ filled, empty, borrowed, filledBySize, emptyBySize })
  }

  useEffect(() => {
    loadOrders()
  }, [loadOrders])

  useEffect(() => {
    loadFirstYear()
  }, [])

  useEffect(() => {
    loadInventory()
  }, [branch])

  const revenueOf = amountOf
  // kilograms of LPG for one order: quantity x kg per cylinder
  const kgOfOrder = (o) => Number(o.quantity) * kgOf(o.item_name)

  const chosen = PERIODS.find((p) => p.key === period)
  const dayOf = (o) => (o.accepted_at ? localDateString(o.accepted_at) : '')
  const rangeFrom = chosen.days ? firstDay(chosen.days) : null
  // filter: a chosen year and/or month wins over the day-based period buttons
  const inPeriod = (o) => {
    const day = dayOf(o)
    if (!day) return false
    if (year && day.slice(0, 4) !== year) return false
    if (month && day.slice(5, 7) !== month) return false
    if (!year && !month && rangeFrom && day < rangeFrom) return false
    return true
  }
  const rangeLabel =
    month && year
      ? `${MONTH_NAMES[Number(month) - 1]} ${year}`
      : month
        ? `${MONTH_NAMES[Number(month) - 1]} (all years)`
        : year
          ? year
          : chosen.label

  // years from the oldest order to this year (for the year filter)
  const years = firstYear
    ? Array.from({ length: new Date().getFullYear() - firstYear + 1 }, (_, i) => String(new Date().getFullYear() - i))
    : []

  const periodAll = orders.filter(inPeriod)
  const rows = branch === OVERALL ? periodAll : periodAll.filter((o) => o.branch === branch)

  const totalVolume = volume(rows.reduce((sum, o) => sum + kgOfOrder(o), 0))
  const totalRevenue = rows.reduce((sum, o) => sum + revenueOf(o), 0)
  const totalOrders = rows.length
  const averageOrder = totalOrders > 0 ? totalRevenue / totalOrders : 0

  // revenue vs weight, branch-filtered, bucketed to match the active filter
  const branchOrders = branch === OVERALL ? orders : orders.filter((o) => o.branch === branch)
  const pad2 = (n) => String(n).padStart(2, '0')
  let trendBuckets
  let trendTitle
  if (year) {
    trendBuckets = MONTH_NAMES.map((name, i) => ({
      label: name,
      match: (day) => day.startsWith(`${year}-${pad2(i + 1)}`),
    }))
    trendTitle = `${year}: Revenue, Expenses & Weight`
  } else if (month) {
    trendBuckets = [...years].sort().map((y) => ({
      label: y,
      match: (day) => day.slice(0, 4) === y && day.slice(5, 7) === month,
    }))
    trendTitle = `${MONTH_NAMES[Number(month) - 1]} by Year: Revenue, Expenses & Weight`
  } else {
    const monthKeys = []
    for (let i = 2; i >= 0; i--) {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - i)
      monthKeys.push({
        key: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`,
        label: `${MONTH_NAMES[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`,
      })
    }
    trendBuckets = monthKeys.map((m) => ({ label: m.label, match: (day) => day.startsWith(m.key) }))
    trendTitle = 'Last 3 Months: Revenue, Expenses & Weight'
  }
  const trendChart = trendBuckets.map((b) => {
    const sel = branchOrders.filter((o) => b.match(dayOf(o)))
    const kg = sel.reduce((sum, o) => sum + kgOfOrder(o), 0)
    return {
      label: b.label,
      revenue: sel.reduce((sum, o) => sum + revenueOf(o), 0),
      expenses: expensesOfOrders(sel),
      tons: Number((kg / 1000).toFixed(3)),
    }
  })

  // pie: filled vs empty cylinders (current inventory), with per-size breakdown
  const inventoryPie = [
    { name: 'Filled', value: inv.filled, bySize: inv.filledBySize },
    { name: 'Empty', value: inv.empty, bySize: inv.emptyBySize },
  ].filter((d) => d.value > 0)

  // pie: orders split by source / customer type / delivery status
  // each slice carries its order count, revenue and weight
  const splitOf = (predicate) => {
    const sel = rows.filter(predicate)
    return {
      count: sel.length,
      revenue: sel.reduce((sum, o) => sum + revenueOf(o), 0),
      kg: sel.reduce((sum, o) => sum + kgOfOrder(o), 0),
      value: sel.length,
    }
  }
  const orderSplit = [
    { name: 'Instore (walk-in)', ...splitOf((o) => o.source === 'walkin') },
    { name: 'Commercial', ...splitOf((o) => o.customer_type === 'commercial') },
    { name: 'Delivered', ...splitOf((o) => o.delivery_status === 'delivered') },
  ].filter((d) => d.count > 0)

  // horizontal product chart: revenue and orders per cylinder size
  const productMap = new Map()
  for (const size of KNOWN_SIZES) {
    productMap.set(size, { size, label: `${size} kg`, revenue: 0, orders: 0 })
  }
  for (const o of rows) {
    const size = kgOf(o.item_name)
    if (!productMap.has(size)) productMap.set(size, { size, label: `${size} kg`, revenue: 0, orders: 0 })
    const p = productMap.get(size)
    p.revenue += revenueOf(o)
    p.orders += 1
  }
  const productChart = [...productMap.values()].sort((a, b) => a.size - b.size)

  // expenses for the period: the numbers typed in each sale's Expenses column (orders.remarks)
  const totalExpenses = expensesOfOrders(rows)
  const netIncome = totalRevenue - totalExpenses
  const pct = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—')

  // per branch (only when viewing all branches): revenue vs expenses vs net
  const branchFinance = BRANCHES.map((b) => {
    const sel = periodAll.filter((o) => o.branch === b.id)
    const revenue = sel.reduce((sum, o) => sum + revenueOf(o), 0)
    const expenses = expensesOfOrders(sel)
    return { label: b.name, revenue, expenses, net: revenue - expenses }
  }).filter((b) => b.revenue > 0 || b.expenses > 0)

  // the period as [from, to) days plus the same-length period before it (for the % change)
  const today = todayString()
  const tomorrow = addDays(today, 1)
  let range = null // { from, to, prevFrom, prevTo, label }
  if (year && month) {
    const from = `${year}-${month}-01`
    const next = new Date(Number(year), Number(month), 1)
    const prev = new Date(Number(year), Number(month) - 2, 1)
    range = { from, to: dateString(next), prevFrom: dateString(prev), prevTo: from, label: 'vs last month' }
  } else if (year) {
    range = { from: `${year}-01-01`, to: `${Number(year) + 1}-01-01`, prevFrom: `${Number(year) - 1}-01-01`, prevTo: `${year}-01-01`, label: 'vs last year' }
  } else if (!month && chosen.days) {
    range = { from: rangeFrom, to: tomorrow, prevFrom: addDays(rangeFrom, -chosen.days), prevTo: rangeFrom, label: `vs previous ${chosen.days} days` }
  }
  const inRange = (from, to) => (o) => {
    const day = dayOf(o)
    return day >= from && day < to
  }
  const prevAll = range ? orders.filter(inRange(range.prevFrom, range.prevTo)) : null
  const prevRows = prevAll && (branch === OVERALL ? prevAll : prevAll.filter((o) => o.branch === branch))
  // days in the period so far (a period that is still running counts only up to today)
  const periodDays = range
    ? Math.max(1, daysBetween(range.from, range.to < tomorrow ? range.to : tomorrow))
    : Math.max(1, new Set(rows.map(dayOf)).size)

  const transactionsOf = (list) => new Set(list.map((o) => o.group_id || `order-${o.id}`)).size
  const totalTransactions = transactionsOf(rows)
  const prev = prevRows && {
    revenue: prevRows.reduce((sum, o) => sum + revenueOf(o), 0),
    expenses: expensesOfOrders(prevRows),
    kg: prevRows.reduce((sum, o) => sum + kgOfOrder(o), 0),
    tx: transactionsOf(prevRows),
  }
  const totalKg = rows.reduce((sum, o) => sum + kgOfOrder(o), 0)
  const vs = (now, key, lowerIsBetter) => (prev ? changeOf(now, key(prev), lowerIsBetter) : null)

  // breakdowns
  const kpis = [
    { label: 'Total Volume', value: totalVolume.tons, sub: totalVolume.kg, change: vs(totalKg, (p) => p.kg) },
    {
      label: 'Total Revenue',
      value: peso(totalRevenue),
      sub: `${peso(totalRevenue / periodDays)} per day`,
      change: vs(totalRevenue, (p) => p.revenue),
    },
    { label: 'Total Expenses', value: peso(totalExpenses), sub: `${pct(totalExpenses, totalRevenue)} of revenue`, change: vs(totalExpenses, (p) => p.expenses, true) },
    {
      label: 'Net Income',
      value: peso(netIncome),
      sub: `Margin = ${pct(netIncome, totalRevenue)}`,
      negative: netIncome < 0,
      change: vs(netIncome, (p) => p.revenue - p.expenses),
    },
    {
      label: 'Total Tanks',
      value: (inv.filled + inv.empty).toLocaleString('en-PH'),
      sub: `Filled = ${inv.filled.toLocaleString('en-PH')}, Empty = ${inv.empty.toLocaleString('en-PH')}, Borrowed = ${inv.borrowed.toLocaleString('en-PH')}`,
    },
    {
      label: 'Average Sale',
      value: peso(totalTransactions ? totalRevenue / totalTransactions : 0),
      sub: `${totalTransactions.toLocaleString('en-PH')} sales · ${totalOrders.toLocaleString('en-PH')} order lines`,
      change: vs(totalTransactions, (p) => p.tx),
    },
  ]

  // numbers sent to Gemini (rounded so tiny changes reuse the cached answer)
  const r0 = (n) => Math.round(Number(n) || 0)
  const aiSummary = {
    branch: branch === OVERALL ? 'All branches' : branchName(branch),
    period: rangeLabel,
    totals: {
      orders: totalOrders,
      revenue: r0(totalRevenue),
      kg: r0(rows.reduce((sum, o) => sum + kgOfOrder(o), 0)),
      averageOrder: r0(averageOrder),
      transactions: totalTransactions,
      revenuePerDay: r0(totalRevenue / periodDays),
      expenses: r0(totalExpenses),
      netIncome: r0(netIncome),
    },
    previousPeriod: prev ? { comparedTo: range.label, revenue: r0(prev.revenue), expenses: r0(prev.expenses), transactions: prev.tx } : null,
    expensesByBranch: branchFinance.map((b) => ({ branch: b.label, revenue: r0(b.revenue), expenses: r0(b.expenses) })),
    bySize: productChart.map((p) => ({ size: p.label, orders: p.orders, revenue: r0(p.revenue) })),
    customerMix: orderSplit.map((d) => ({ type: d.name, orders: d.count, revenue: r0(d.revenue), kg: r0(d.kg) })),
    inventory: { filled: inv.filled, empty: inv.empty, borrowed: inv.borrowed, filledBySize: inv.filledBySize, emptyBySize: inv.emptyBySize },
    trend: trendChart.map((t) => ({ period: t.label, revenue: r0(t.revenue), expenses: r0(t.expenses), tons: t.tons })),
  }
  const aiHasData = totalOrders > 0 || inv.filled + inv.empty > 0

  const periodButton = (p) => (period === p.key && !month && !year ? SOLID : OUTLINE)

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl">Analytics</h1>
          <p className="m-0 text-[14px] text-gray-500">
            {branch === OVERALL ? 'All branches' : branchName(branch)} · accepted orders · {rangeLabel}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={branch} onChange={(e) => setBranch(Number(e.target.value))}>
            <option value={OVERALL}>All branches</option>
            {BRANCHES.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            <option value="">All months</option>
            {MONTH_NAMES.map((name, i) => (
              <option key={name} value={pad2(i + 1)}>{name}</option>
            ))}
          </select>
          <select value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={periodButton(p)}
              onClick={() => {
                setPeriod(p.key)
                setMonth('')
                setYear('')
              }}
            >
              {p.label}
            </button>
          ))}
          <button
            className={OUTLINE}
            onClick={() => {
              invalidate('analytics:') // Refresh always asks Supabase again
              loadOrders()
              loadInventory()
              loadFirstYear()
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div>
          <div className="mb-8 grid grid-cols-3 gap-4 max-[1100px]:grid-cols-2 max-[640px]:grid-cols-1">
            {kpis.map((k) => (
              <div key={k.label} className={KPI}>
                <span className="text-[14px] text-gray-500">{k.label}</span>
                <span className={`text-[26px] leading-tight font-bold tabular-nums ${k.negative ? 'text-brand-red' : 'text-gray-900'}`}>{k.value}</span>
                {k.sub && <span className="text-[14px] text-gray-500">{k.sub}</span>}
                <Change change={k.change} label={range?.label} />
              </div>
            ))}
          </div>

          <BusinessAnalytics
            rows={rows}
            periodAll={periodAll}
            prevAll={prevAll}
            showLeaderboard={branch === OVERALL}
            compareLabel={range?.label ?? ''}
            days={periodDays}
            stockBySize={inv.filledBySize}
            sizes={KNOWN_SIZES}
          />

          <div className="mb-4 flex flex-wrap gap-4">
            <div className={CARD}>
              <h3 className="mt-0 mb-2 text-lg">{trendTitle}</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={trendChart} margin={{ top: 20, right: 8, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 12 }}
                    label={{ value: 'tons', angle: 90, position: 'insideRight', fontSize: 12 }}
                  />
                  <Tooltip content={<MonthTip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                  <Legend />
                  <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill={CHART_GREEN} radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="revenue" position="top" formatter={compactPeso} fontSize={10} fill="#334155" />
                  </Bar>
                  <Bar yAxisId="left" dataKey="expenses" name="Expenses" fill={CHART_AMBER} radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="expenses" position="top" formatter={compactPeso} fontSize={10} fill="#334155" />
                  </Bar>
                  <Bar yAxisId="right" dataKey="tons" name="Weight (tons)" fill={CHART_RED} radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="tons" position="top" formatter={compactNumber} fontSize={10} fill="#334155" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className={CARD}>
              <h3 className="mt-0 mb-2 text-lg">Filled vs Empty Analysis</h3>
              {inventoryPie.length === 0 ? (
                <p className="text-[14px] text-gray-500">No inventory data</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie
                      data={inventoryPie}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={78}
                      paddingAngle={3}
                      cornerRadius={6}
                      stroke="#fff"
                      strokeWidth={2}
                      label={InventoryPieLabel}
                      labelLine={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                    >
                      {inventoryPie.map((d, i) => (
                        <Cell key={d.name} fill={INVENTORY_COLORS[i % INVENTORY_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<InventoryTip />} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="mb-8 flex flex-wrap gap-4">
            <div className={CARD}>
              <h3 className="mt-0 mb-2 text-lg">Instore, Commercial &amp; Delivered Analysis</h3>
              {orderSplit.length === 0 ? (
                <p className="text-[14px] text-gray-500">No accepted orders in this period</p>
              ) : (
                <ResponsiveContainer width="100%" height={340}>
                  <PieChart>
                    <Pie
                      data={orderSplit}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={78}
                      paddingAngle={3}
                      cornerRadius={6}
                      stroke="#fff"
                      strokeWidth={2}
                      label={OrderPieLabel}
                      labelLine={{ stroke: '#cbd5e1', strokeWidth: 1 }}
                    >
                      {orderSplit.map((d, i) => (
                        <Cell key={d.name} fill={ORDER_SPLIT_COLORS[i % ORDER_SPLIT_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<OrderSplitTip />} />
                  </PieChart>
                </ResponsiveContainer>
              )}
              <p className="mb-0 text-[13px] text-gray-500">
                Instore = walk-in orders, Commercial = commercial customers, Delivered = delivered orders.
                A single order can fall under more than one slice.
              </p>
            </div>

            <div className={CARD}>
              <h3 className="mt-0 mb-2 text-lg">Product Performance Analysis (2.7, 11, 22, 50 kg)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  layout="vertical"
                  data={productChart}
                  margin={{ top: 8, right: 56, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis xAxisId="rev" type="number" tick={{ fontSize: 12 }} />
                  <XAxis xAxisId="orders" type="number" orientation="top" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="label" width={56} tick={{ fontSize: 12 }} />
                  <Tooltip content={<ProductTip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                  <Legend />
                  <Bar xAxisId="rev" dataKey="revenue" name="Revenue" fill={CHART_GREEN} radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="revenue" position="right" formatter={compactPeso} fontSize={10} fill="#334155" />
                  </Bar>
                  <Bar xAxisId="orders" dataKey="orders" name="Orders" fill={CHART_RED} radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="orders" position="right" formatter={compactCount} fontSize={10} fill="#334155" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {branch === OVERALL && branchFinance.length > 0 && (
            <div className={`${CARD} mb-4`}>
              <h3 className="mt-0 mb-2 text-lg">Revenue vs Expenses by Branch</h3>
              <ResponsiveContainer width="100%" height={Math.max(160, branchFinance.length * 56)}>
                <BarChart data={branchFinance} layout="vertical" margin={{ top: 4, right: 56, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={compactPeso} />
                  <YAxis type="category" dataKey="label" width={96} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v) => peso(v)} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                  <Legend />
                  <Bar dataKey="revenue" name="Revenue" fill={CHART_GREEN} radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="revenue" position="right" formatter={compactPeso} fontSize={10} fill="#334155" />
                  </Bar>
                  <Bar dataKey="expenses" name="Expenses" fill={CHART_AMBER} radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="expenses" position="right" formatter={compactPeso} fontSize={10} fill="#334155" />
                  </Bar>
                  <Bar dataKey="net" name="Net income" fill={CHART_MINT} radius={[0, 4, 4, 0]}>
                    <LabelList dataKey="net" position="right" formatter={compactPeso} fontSize={10} fill="#334155" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <AiInsights summary={aiSummary} hasData={aiHasData} />
        </div>
      )}
    </div>
  )
}
