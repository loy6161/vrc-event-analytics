import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  type TooltipProps,
} from 'recharts'
import type { EventInsights } from '../../types/index.js'

type HistoryEntry = EventInsights['attendance_history'][number]

interface AttendanceTrendChartProps {
  data: HistoryEntry[]
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

function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const entry = payload[0]?.payload as HistoryEntry
  return (
    <div className="chart-tooltip">
      <p className="tooltip-time">{entry.event_name}</p>
      <p className="tooltip-time">{entry.date}</p>
      <p className="tooltip-value">
        <span className="tooltip-dot" style={{ background: '#3498db' }} />
        ユニーク参加者: <strong>{entry.unique_attendees}</strong>
      </p>
      <p className="tooltip-value">
        <span className="tooltip-dot" style={{ background: '#2ecc71' }} />
        総Join: <strong>{entry.total_joins}</strong>
      </p>
    </div>
  )
}

export function AttendanceTrendChart({ data, height = 260 }: AttendanceTrendChartProps) {
  if (data.length < 2) {
    return <div className="chart-empty"><p>トレンド分析には2回以上のイベントが必要です</p></div>
  }

  const chartData = data.map(d => ({
    ...d,
    date: fmtDate(d.date),
  }))

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
          <defs>
            <linearGradient id="attendeeGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3498db" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#3498db" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2f42" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: '#888' }}
            interval={data.length > 12 ? Math.floor(data.length / 12) : 0}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#888' }}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="unique_attendees"
            stroke="#3498db"
            strokeWidth={2}
            fill="url(#attendeeGrad)"
            dot={{ r: 3, fill: '#3498db' }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
