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
import type { EventInsights } from '../../types/index.js'

type RetentionEntry = EventInsights['retention_by_event'][number]

interface RetentionChartProps {
  data: RetentionEntry[]
  height?: number
}

function fmtDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return `${d.getMonth() + 1}/${d.getDate()}`
  } catch {
    return dateStr
  }
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const entry = payload[0]?.payload as RetentionEntry & { retention_pct: number }
  return (
    <div className="chart-tooltip">
      <p className="tooltip-time">{entry.event_name}</p>
      <p className="tooltip-time">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="tooltip-value">
          <span className="tooltip-dot" style={{ background: p.color }} />
          {p.name}: <strong>
            {p.name === 'リテンション率' ? `${p.value}%` : p.value}
          </strong>
        </p>
      ))}
    </div>
  )
}

export function RetentionChart({ data, height = 280 }: RetentionChartProps) {
  if (data.length < 2) {
    return <div className="chart-empty"><p>リテンション分析には2回以上のイベントが必要です</p></div>
  }

  const chartData = data.map(d => ({
    ...d,
    date: fmtDate(d.date),
    retention_pct: Math.round(d.retention_rate * 100),
    '参加者数': d.attendees,
    '前回からの継続': d.returning_from_prev,
    '新規参加': d.new_attendees,
    'リテンション率': Math.round(d.retention_rate * 100),
  }))

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2f42" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: '#888' }}
            interval={data.length > 12 ? Math.floor(data.length / 12) : 0}
          />
          <YAxis
            yAxisId="count"
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#888' }}
            width={36}
          />
          <YAxis
            yAxisId="pct"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 12, fill: '#aaa' }}
            tickFormatter={v => `${v}%`}
            width={45}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar
            yAxisId="count"
            dataKey="前回からの継続"
            stackId="a"
            fill="#3498db"
            fillOpacity={0.8}
            radius={[0, 0, 0, 0]}
            maxBarSize={32}
          />
          <Bar
            yAxisId="count"
            dataKey="新規参加"
            stackId="a"
            fill="#2ecc71"
            fillOpacity={0.8}
            radius={[3, 3, 0, 0]}
            maxBarSize={32}
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="リテンション率"
            stroke="#e74c3c"
            strokeWidth={2}
            dot={{ r: 3, fill: '#e74c3c' }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
