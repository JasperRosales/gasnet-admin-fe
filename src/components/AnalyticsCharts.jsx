// The charts of the Analytics page. Loaded lazily (together with the chart library) by
// pages/Analytics.jsx, so the numbers at the top of the page show without waiting for them.
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
import { peso } from '../lib/money'
import { volume } from '../lib/volume'

const CARD = 'flex-1 min-w-[340px] rounded-xl border border-(color:--border) bg-white p-4'

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

const INVENTORY_COLORS = [CHART_GREEN, CHART_RED]
const ORDER_SPLIT_COLORS = [CHART_GREEN, CHART_RED, CHART_MINT]


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
const InventoryTip = ({ active, payload, sizes }) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const bySize = d.bySize || {}
  return (
    <div className="rounded-lg border border-(color:--border) bg-white px-3 py-2 text-[14px] shadow">
      <div className="font-semibold">{d.name}</div>
      <div>{Number(d.value).toLocaleString('en-PH')} cylinders</div>
      <div className="mt-1">
        {sizes.map((s) => (
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

const percentOf = (part, whole) => (whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '0%')

// Donut with the total in the middle and a legend beside it (one row per slice), instead of
// labels floating around the ring. items: [{ name, value, color, detail: ReactNode }]
const DonutWithLegend = ({ items, total, centerValue, centerLabel, tooltip }) => (
  <div className="grid grid-cols-[minmax(170px,210px)_1fr] items-center gap-5 max-[640px]:grid-cols-1">
    <div className="relative h-[210px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={items}
            dataKey="value"
            nameKey="name"
            innerRadius="68%"
            outerRadius="100%"
            paddingAngle={items.length > 1 ? 2 : 0}
            cornerRadius={5}
            startAngle={90}
            endAngle={-270}
            stroke="#fff"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {items.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
          </Pie>
          <Tooltip content={tooltip} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-2xl font-semibold leading-tight text-gray-900">{centerValue}</span>
        <span className="text-[12px] text-gray-500">{centerLabel}</span>
      </div>
    </div>
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {items.map((d) => (
        <li key={d.name} className="rounded-lg border border-(color:--border) px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: d.color }} />
            <span className="text-[14px] font-semibold text-gray-900">{d.name}</span>
            <span className="ml-auto text-[14px] font-semibold text-gray-900">{percentOf(d.value, total)}</span>
          </div>
          <div className="mt-1 pl-5 text-[13px] text-gray-600">{d.detail}</div>
        </li>
      ))}
    </ul>
  </div>
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

export default function AnalyticsCharts({
  trendTitle,
  trendChart,
  inv,
  inventoryPie,
  orderSplit,
  orderCount,
  productChart,
  sizes,
}) {
  return (
    <>
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
            <div className="py-6">
              <DonutWithLegend
                total={inv.filled + inv.empty}
                centerValue={(inv.filled + inv.empty).toLocaleString('en-PH')}
                centerLabel="cylinders"
                tooltip={<InventoryTip sizes={sizes} />}
                items={inventoryPie.map((d, i) => ({
                  ...d,
                  color: INVENTORY_COLORS[i % INVENTORY_COLORS.length],
                  detail: (
                    <>
                      <div className="font-medium text-gray-800">
                        {Number(d.value).toLocaleString('en-PH')} cylinders
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-gray-500">
                        {sizes.map((s) => (
                          <span key={s}>
                            {s} kg: {(d.bySize?.[s] || 0).toLocaleString('en-PH')}
                          </span>
                        ))}
                      </div>
                    </>
                  ),
                }))}
              />
            </div>
          )}
        </div>
      </div>

      <div className="mb-8 flex flex-wrap gap-4">
        <div className={CARD}>
          <h3 className="mt-0 mb-2 text-lg">Instore, Commercial &amp; Delivered Analysis</h3>
          {orderSplit.length === 0 ? (
            <p className="text-[14px] text-gray-500">No accepted orders in this period</p>
          ) : (
            <div className="py-4">
              <DonutWithLegend
                total={orderCount}
                centerValue={orderCount.toLocaleString('en-PH')}
                centerLabel="orders"
                tooltip={<OrderSplitTip />}
                items={orderSplit.map((d, i) => ({
                  ...d,
                  color: ORDER_SPLIT_COLORS[i % ORDER_SPLIT_COLORS.length],
                  detail: (
                    <>
                      <div className="font-medium text-gray-800">
                        {d.count.toLocaleString('en-PH')} orders · {peso(d.revenue)}
                      </div>
                      <div className="mt-0.5 text-gray-500">{volume(d.kg).tons}</div>
                    </>
                  ),
                }))}
              />
            </div>
          )}
          <p className="mb-0 text-[13px] text-gray-500">
            Instore = walk-in orders, Commercial = commercial customers, Delivered = delivered to the customer (phone orders and walk-ins with a delivery address).
            Percentages are of all orders; a single order can fall under more than one slice.
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
    </>
  )
}
