import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { fetchAll } from '../lib/fetchAll'
import usePopupMessage from '../lib/usePopupMessage'
import { BRANCHES, branchName } from '../lib/branches'
import { dateString, localDateString, todayString } from '../lib/dateUtils'
import { peso } from '../lib/money'
import { expensesOfOrders, otherIncomeOfOrders } from '../lib/expenses'
import DateButton from '../components/DateButton'
import DownloadButtons from '../components/DownloadButtons'
import { isGross, isGcash, sumAmount, soldOf } from '../lib/monthly'
import { lpgPrices } from '../lib/prices'
import useLiveTables from '../lib/useLiveTables'

const OUTLINE =
  'rounded-lg border border-(color:--border) bg-white px-4 py-2 text-brand-pine hover:bg-brand-light'
const SOLID = 'rounded-lg bg-brand-pine px-4 py-2 text-white hover:bg-brand-pine-light'
const CELL = 'border border-(color:--border) px-3 py-2 text-center'
const LABEL = 'border border-(color:--border) px-3 py-2 text-left whitespace-nowrap'
const MONEY = 'border border-(color:--border) px-3 py-2 text-right whitespace-nowrap'
const PANEL =
  'h-[calc(100vh-260px)] min-h-[360px] overflow-auto rounded-xl border border-(color:--border) bg-white'

// typed day by day in the Daily Sales Report
const DAILY_KEYS = ['deposit', 'benta', 'add', 'gcash']

const SHEETS = [
  { key: 'days', label: 'Per Day' },
  { key: 'branches', label: 'Per Branch' },
]

const parse = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const addDays = (ymd, n) => {
  const d = parse(ymd)
  d.setDate(d.getDate() + n)
  return dateString(d)
}
// the Monday of the week a day is in
const mondayOf = (ymd) => {
  const d = parse(ymd)
  return addDays(ymd, -((d.getDay() + 6) % 7))
}
const short = (ymd) => parse(ymd).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
const dayLabel = (ymd) => parse(ymd).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })
const weekText = (start) => `${short(start)} – ${short(addDays(start, 6))}, ${parse(addDays(start, 6)).getFullYear()}`

// Weekly Sales Report: Monday to Sunday. Per Day: one row a day (all branches or one);
// Per Branch: one row a branch for the whole week. The same numbers as the Monthly Sales Report.
// branch prop: staff see only their own branch.
export default function WeeklySales({ branch }) {
  const isAdmin = !branch
  const [start, setStart] = useState(() => mondayOf(todayString())) // the Monday, 'YYYY-MM-DD'
  const [sheet, setSheet] = useState('days')
  const [only, setOnly] = useState(branch || 0) // Per Day: 0 = all branches
  const [sizes, setSizes] = useState([])
  const [orders, setOrders] = useState([])
  const [daily, setDaily] = useState([]) // [{ branch, day, key, amount }]
  const [message, setMessage] = useState('')
  usePopupMessage(message)
  const tableArea = useRef(null)

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  const shownBranches = branch ? BRANCHES.filter((b) => b.id === branch) : BRANCHES

  const load = async () => {
    setMessage('')
    const from = parse(start)
    const to = parse(addDays(start, 7))
    const [sizesResult, ordersResult, dailyResult] = await Promise.all([
      lpgPrices(),
      fetchAll(() => {
        let q = supabase
          .from('orders')
          .select('*')
          .eq('status', 'accepted')
          .gte('accepted_at', from.toISOString())
          .lt('accepted_at', to.toISOString())
          .order('id')
        if (branch) q = q.eq('branch', branch)
        return q
      }),
      fetchAll(() => {
        let q = supabase
          .from('daily_entries')
          .select('branch, day, key, amount')
          .in('key', DAILY_KEYS)
          .gte('day', start)
          .lt('day', addDays(start, 7))
          .order('day')
          .order('branch')
          .order('key')
        if (branch) q = q.eq('branch', branch)
        return q
      }),
    ])
    const error = sizesResult.error || ordersResult.error
    if (error) return setMessage(error.message)
    if (dailyResult.error) setMessage(`Some numbers could not be loaded: ${dailyResult.error.message}`)
    setSizes([...new Set(sizesResult.data.map((p) => p.size))])
    setOrders(ordersResult.data)
    setDaily(dailyResult.data || [])
  }

  useEffect(() => {
    load()
  }, [start, branch])

  useLiveTables(['orders', 'daily_entries', 'lpg_prices', 'branch_prices'], load)

  // the typed Daily Sales Report numbers of some branches / days, added up
  const typed = (key, branches, dayList) =>
    daily
      .filter((e) => e.key === key && branches.includes(e.branch) && dayList.includes(e.day))
      .reduce((sum, e) => sum + Number(e.amount), 0)

  // one row of numbers: the orders and the typed entries of some branches and days
  const cells = (list, branches, dayList) => {
    const gross = sumAmount(list.filter(isGross)) + otherIncomeOfOrders(list, false)
    const expenses = expensesOfOrders(list)
    const gcash = sumAmount(list.filter(isGcash)) + otherIncomeOfOrders(list, true) + typed('gcash', branches, dayList)
    const tanks = list.reduce((n, o) => n + Number(o.quantity || 0), 0)
    return [
      <td key="gross" className={MONEY}>{peso(gross)}</td>,
      <td key="expenses" className={MONEY}>{peso(expenses)}</td>,
      <td key="net" className={MONEY}>{peso(gross - expenses)}</td>,
      <td key="deposit" className={MONEY}>{peso(typed('deposit', branches, dayList))}</td>,
      <td key="gcash" className={MONEY}>{peso(gcash)}</td>,
      <td key="benta" className={MONEY}>{peso(typed('benta', branches, dayList))}</td>,
      <td key="add" className={MONEY}>{peso(typed('add', branches, dayList))}</td>,
      ...(sizes.length === 0
        ? [<td key="tank" className={`${CELL} text-gray-400`}>-</td>]
        : sizes.map((size) => {
            const sold = soldOf(list, size)
            return (
              <td key={`tank-${size}`} className={CELL}>
                {sold > 0 ? sold.toLocaleString('en-PH') : '-'}
              </td>
            )
          })),
      <td key="all" className={CELL}>{tanks > 0 ? tanks.toLocaleString('en-PH') : '-'}</td>,
    ]
  }

  const dayBranches = only ? [only] : shownBranches.map((b) => b.id)
  const dayOrders = orders.filter((o) => dayBranches.includes(o.branch))
  const allBranches = shownBranches.map((b) => b.id)
  const sheetLabel = SHEETS.find((s) => s.key === sheet).label
  const scope = sheet === 'days' && only ? branchName(only) : branch ? branchName(branch) : 'All branches'

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-2xl">Weekly Sales Report</h1>
          <p className="m-0 text-[14px] text-gray-500">{scope} · {weekText(start)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className={OUTLINE} onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">‹</button>
          <DateButton value={start} onChange={(v) => v && setStart(mondayOf(v))} />
          <button className={OUTLINE} onClick={() => setStart(addDays(start, 7))} aria-label="Next week">›</button>
          <button className={OUTLINE} onClick={() => setStart(mondayOf(todayString()))}>This week</button>
          <button className={OUTLINE} onClick={load}>Refresh</button>
          <DownloadButtons
            getTable={() => tableArea.current?.querySelector('table')}
            title={`Weekly Sales Report - ${sheetLabel}`}
            subtitle={`${scope} · ${weekText(start)}`}
            filename={`Weekly Sales Report - ${sheetLabel} - ${scope} - ${start}`}
          />
        </div>
      </div>

      {message && <p className="mt-0">{message}</p>}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {SHEETS.map((s) => (
          <button key={s.key} className={sheet === s.key ? SOLID : OUTLINE} onClick={() => setSheet(s.key)}>
            {s.label}
          </button>
        ))}
        {isAdmin && sheet === 'days' && (
          <select
            className="ml-auto rounded-lg border border-(color:--border) bg-white px-3 py-2"
            value={only}
            onChange={(e) => setOnly(Number(e.target.value))}
            aria-label="Branch"
          >
            <option value={0}>All branches</option>
            {BRANCHES.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}
      </div>

      <div ref={tableArea} className={PANEL}>
        <table className="w-full min-w-[1100px]">
          <thead>
            <tr>
              <th rowSpan={2} className={LABEL}>{sheet === 'days' ? 'Day' : 'Branch'}</th>
              <th rowSpan={2} className={CELL}>Gross Sale</th>
              <th rowSpan={2} className={CELL}>Expenses</th>
              <th rowSpan={2} className={CELL}>Net</th>
              <th rowSpan={2} className={CELL}>Deposit</th>
              <th rowSpan={2} className={CELL}>Gcash</th>
              <th rowSpan={2} className={CELL}>Benta Tanke</th>
              <th rowSpan={2} className={CELL}>Add Tanke</th>
              <th colSpan={Math.max(sizes.length, 1) + 1} className={CELL}>Tanks Sold</th>
            </tr>
            <tr>
              {sizes.length === 0 ? <th className={CELL}></th> : sizes.map((s) => <th key={s} className={CELL}>{s}</th>)}
              <th className={CELL}>All</th>
            </tr>
          </thead>
          <tbody>
            {sheet === 'days'
              ? days.map((d) => (
                  <tr key={d}>
                    <td className={LABEL}>{dayLabel(d)}</td>
                    {cells(dayOrders.filter((o) => localDateString(o.accepted_at) === d), dayBranches, [d])}
                  </tr>
                ))
              : shownBranches.map((b) => (
                  <tr key={b.id}>
                    <td className={LABEL}>{b.name}</td>
                    {cells(orders.filter((o) => o.branch === b.id), [b.id], days)}
                  </tr>
                ))}
          </tbody>
          {(sheet === 'days' || isAdmin) && (
            <tfoot>
              <tr className="font-bold">
                <td className={LABEL}>Week total</td>
                {sheet === 'days' ? cells(dayOrders, dayBranches, days) : cells(orders, allBranches, days)}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}
