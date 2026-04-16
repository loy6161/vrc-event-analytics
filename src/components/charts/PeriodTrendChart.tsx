import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts'
import type { PeriodStats } from '../../types/index.js'

interface PeriodTrendChartProps {
  data: PeriodStats[]
  height?: number
}

function fmtAxisLabel(period: string): string {
  // "2025-03" → "Mar '25", "2025" → "2025"
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [year, month] = period.split('-')
    const mon = new Date(`${year}-${month}-01`).toLocaleString('default', { month: 'short' })
    return `${mon} '${year.slice(2)}`
  }
  return period
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <p className="tooltip-time">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="tooltip-value">
          <span className="tooltip-dot" style={{ background: entry.color }} />
          {entry.name}: <strong>{entry.value}</strong>
        </p>
      ))}
    </div>
  )
}

export function PeriodTrendChart({ data, height = 280 }: PeriodTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="chart-empty">
        <p>No period data available</p>
      </div>
    )
  }

  const chartData = data.map(p => ({
    period: fmtAxisLabel(p.period),
    'Total Attendees': p.total_attendees,
    'Unique Visitors': p.unique_attendees,
    'New Visitors': p.new_attendees,
    Events: p.event_count,
  }))

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="period"
            tick={{ fontSize: 12, fill: '#888' }}
            interval={data.length > 12 ? Math.floor(data.length / 12) : 0}
          />
          <YAxis
            yAxisId="visitors"
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#888' }}
            width={36}
          />
          <YAxis
            yAxisId="events"
            orientation="right"
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#aaa' }}
            width={28}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
          <Bar
            yAxisId="visitors"
            dataKey="Total Attendees"
            fill="#3498db"
            fillOpacity={0.75}
            radius={[3, 3, 0, 0]}
            maxBarSize={40}
          />
          <Bar
            yAxisId="visitors"
            dataKey="New Visitors"
            fill="#2ecc71"
            fillOpacity={0.8}
            radius={[3, 3, 0, 0]}
            maxBarSize={40}
          />
          <Line
            yAxisId="visitors"
            type="monotone"
            dataKey="Unique Visitors"
            stroke="#e74c3c"
            strokeWidth={2}
            dot={{ r: 3, fill: '#e74c3c' }}
            activeDot={{ r: 5 }}
          />
          <Line
            yAxisId="events"
            type="monotone"
            dataKey="Events"
            stroke="#f39c12"
            strokeWidth={2}
            strokeDasharray="4 2"
            dot={{ r: 3, fill: '#f39c12' }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
