// The charts of the Analytics page. Loaded lazily (together with the chart library) by
// pages/Analytics.jsx, so the numbers at the top of the page show without waiting for them.
import {
  ResponsiveContainer,
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

const CARD = 'flex-1 min-w-[340px] rounded-xl border border-(color:--border) bg-white p-4'

// shared chart palette (same colors as the Product performance chart)
const CHART_GREEN = '#005746'
const CHART_RED = '#a80202'
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

export default function AnalyticsCharts({ trendTitle, trendChart, productChart }) {
  return (
    <>
      <div className="mb-8 flex flex-wrap gap-4">
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
