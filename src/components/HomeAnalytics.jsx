import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import { cachedQuery } from '../lib/lazyData'
import { amountOf } from '../lib/monthly'
import { expensesOfOrders } from '../lib/expenses'
import { BRANCHES, branchName } from '../lib/branches'
import { dateString, localDateString } from '../lib/dateUtils'
import { peso } from '../lib/money'
import { changeOf } from '../lib/compare'
import { Change } from './BusinessAnalytics'
import useLiveTables from '../lib/useLiveTables'

const GREEN = '#0b4436'
const CARD = 'rounded-2xl border border-(color:--border) bg-white shadow-sm'
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// 'YYYY-MM-DD' of n days ago
const daysAgo = (n) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - n)
  return d
}
const kgOf = (o) => Number(o.quantity || 0) * Number(((o.item_name || '').match(/[\d.]+/) || [0])[0])
const sum = (list, f) => list.reduce((s, o) => s + f(o), 0)
const salesOf = (list) => new Set(list.map((o) => o.group_id || `order-${o.id}`)).size
const compactPeso = (n) =>
  n >= 1_000_000 ? `₱${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `₱${(n / 1_000).toFixed(1)}k` : `₱${Math.round(n)}`

const sizeOf = (o) => (o.item_name || '').replace('LPG Cylinder ', '')

// a legend row: a colored swatch (or a text marker) and what it means
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

// Admin Home analytics: today vs yesterday, the last 7 days of revenue, and today by branch
// (or, for one branch, today by cylinder size).
// branch: the branch picked on the home page; the filter shows All branches or that branch.
// Loads only the accepted orders of the last 14 days (this week and the week before it).
export default function HomeAnalytics({ branch, onOpenAnalytics }) {
  const [onlyBranch, setOnlyBranch] = useState(false)
  // picking another branch on the home page filters the analytics to it
  const [shownBranch, setShownBranch] = useState(branch)
  if (shownBranch !== branch) {
    setShownBranch(branch)
    setOnlyBranch(true)
  }
  const [orders, setOrders] = useState(null)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const from = daysAgo(13)
    const { data, error } = await cachedQuery(`home:orders:${dateString(from)}`, 60 * 1000, () =>
      fetchAll(() =>
        supabase
          .from('orders')
          .select('id, group_id, branch, item_name, quantity, unit_price, discount, remarks, accepted_at')
          .eq('status', 'accepted')
          .gte('accepted_at', from.toISOString())
          .order('id'),
      ),
    )
    if (error) setMessage(error.message)
    else {
      setMessage('')
      setOrders(data)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])
  useLiveTables(['orders'], load, { cachePrefix: 'home:', delay: 1500 })

  const rows = onlyBranch ? (orders || []).filter((o) => o.branch === branch) : orders || []
  const byDay = {}
  for (const o of rows) {
    const day = localDateString(o.accepted_at)
    ;(byDay[day] ||= []).push(o)
  }
  const dayList = (n) => byDay[dateString(daysAgo(n))] || []
  const today = dayList(0)
  const yesterday = dayList(1)

  const revenue = (list) => sum(list, amountOf)
  const net = (list) => revenue(list) - expensesOfOrders(list)

  const week = Array.from({ length: 7 }, (_, i) => 6 - i).map((n) => {
    const d = daysAgo(n)
    return { n, label: n === 0 ? 'Today' : DAY_NAMES[d.getDay()], date: d, revenue: revenue(dayList(n)), sales: salesOf(dayList(n)) }
  })
  const weekTotal = sum(week, (d) => d.revenue)
  const prevWeekTotal = sum(Array.from({ length: 7 }, (_, i) => i + 7), (n) => revenue(dayList(n)))
  const weekMax = Math.max(...week.map((d) => d.revenue), 1)

  const branches = BRANCHES.map((b) => {
    const list = today.filter((o) => o.branch === b.id)
    return { id: b.id, name: b.name, revenue: revenue(list), sales: salesOf(list) }
  }).sort((a, b) => b.revenue - a.revenue)
  // one branch: today split by cylinder size instead
  const sizeMap = new Map()
  for (const o of today) {
    const key = sizeOf(o)
    const row = sizeMap.get(key) || { id: key, name: key, revenue: 0, sales: 0, qty: 0 }
    row.revenue += amountOf(o)
    row.qty += Number(o.quantity || 0)
    sizeMap.set(key, row)
  }
  const sizes = [...sizeMap.values()].sort((a, b) => b.revenue - a.revenue)
  const split = onlyBranch ? sizes : branches
  const splitMax = Math.max(...split.map((b) => b.revenue), 1)

  const tiles = [
    { label: "Today's Revenue", value: peso(revenue(today)), change: changeOf(revenue(today), revenue(yesterday)) },
    { label: 'Sales Today', value: salesOf(today).toLocaleString('en-PH'), change: changeOf(salesOf(today), salesOf(yesterday)) },
    {
      label: 'LPG Sold Today',
      value: `${sum(today, kgOf).toLocaleString('en-PH', { maximumFractionDigits: 1 })} kg`,
      change: changeOf(sum(today, kgOf), sum(yesterday, kgOf)),
    },
    { label: 'Net Today', value: peso(net(today)), change: changeOf(net(today), net(yesterday)), negative: net(today) < 0 },
  ]

  const loading = orders === null

  return (
    <div className={`${CARD} grid gap-4 p-4`}>
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

      <div className={`grid grid-cols-4 gap-3 max-[1000px]:grid-cols-2 ${loading ? 'animate-pulse opacity-60' : ''}`}>
        {tiles.map((t) => (
          <div key={t.label} className="flex flex-col gap-0.5 rounded-xl border border-(color:--border) p-3">
            <span className="text-[13px] text-gray-500">{t.label}</span>
            <span className={`text-[22px] leading-tight font-bold tabular-nums ${t.negative ? 'text-brand-red' : 'text-gray-900'}`}>
              {loading ? '—' : t.value}
            </span>
            {!loading && <Change change={t.change} label="vs yesterday" />}
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

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* last 7 days of revenue: one series, so no legend; hover a bar for its numbers */}
        <div className="rounded-xl border border-(color:--border) p-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="text-[15px] font-semibold text-gray-900">Revenue, last 7 days</span>
            <span className="text-[14px] tabular-nums text-gray-500">
              {peso(weekTotal)}{' '}
              {!loading && <Change change={changeOf(weekTotal, prevWeekTotal)} label="vs previous 7 days" />}
            </span>
          </div>
          <div className="flex h-36 items-end gap-2 border-b border-gray-200" role="img" aria-label="Revenue per day, last 7 days">
            {week.map((d) => (
              <div key={d.n} className="group relative flex h-full flex-1 flex-col items-center justify-end">
                <span className="mb-1 text-[11px] text-gray-500 tabular-nums">{d.revenue > 0 ? compactPeso(d.revenue) : ''}</span>
                <div
                  className="w-full max-w-10 rounded-t-[4px] opacity-90 group-hover:opacity-100"
                  style={{ height: `${(d.revenue / weekMax) * 75}%`, minHeight: d.revenue > 0 ? 2 : 0, background: GREEN }}
                />
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden rounded-lg border border-(color:--border) bg-white px-2.5 py-1.5 text-[13px] whitespace-nowrap shadow group-hover:block">
                  <div className="font-semibold">{d.date.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                  <div>{peso(d.revenue)}</div>
                  <div className="text-gray-500">{d.sales} sales</div>
                </div>
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
              { color: GREEN, label: `Revenue per day${onlyBranch ? ` · ${branchName(branch)}` : ' · all branches'}` },
              { mark: '₱k', label: 'thousand pesos' },
              { mark: '▲▼', label: 'vs the 7 days before' },
            ]}
          />
        </div>

        {/* today by branch, highest revenue first */}
        <div className="rounded-xl border border-(color:--border) p-3">
          <span className="mb-2 block text-[15px] font-semibold text-gray-900">
            {onlyBranch ? `Today by size · ${branchName(branch)}` : 'Today by branch'}
          </span>
          <div className="grid gap-2">
            {onlyBranch && split.length === 0 && <p className="m-0 text-[13px] text-gray-500">No sales yet today.</p>}
            {split.map((b) => (
              <div key={b.id} className="grid gap-1" title={`${b.name}: ${peso(b.revenue)}, ${onlyBranch ? `${b.qty} cylinders` : `${b.sales} sales`}`}>
                <div className="flex justify-between text-[13px]">
                  <span className="text-gray-700">{b.name}</span>
                  <span className="tabular-nums text-gray-900">
                    {peso(b.revenue)} <span className="text-gray-500">· {onlyBranch ? `${b.qty} pcs` : b.sales}</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100">
                  <div className="h-full rounded-full" style={{ width: `${(b.revenue / splitMax) * 100}%`, background: GREEN }} />
                </div>
              </div>
            ))}
          </div>
          <Legend
            items={[
              { color: GREEN, label: 'Revenue today (bar = share of the top one)' },
              onlyBranch ? { mark: 'pcs', label: 'cylinders sold' } : { mark: '· n', label: 'number of sales' },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
