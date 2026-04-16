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

export interface EventTrendChartProps {
  data: HistoryEntry[]
  dataKey: keyof Omit<HistoryEntry, 'event_id' | 'event_name' | 'date'>
  label: string
  color: string
  /** Format the tooltip value (e.g. minutes → "1h 30m", rate → "42%") */
  formatter?: (value: number) => string
  yTickFormatter?: (value: number) => string
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

export function EventTrendChart({
  data,
  dataKey,
  label,
  color,
  formatter,
  yTickFormatter,
  height = 240,
}: EventTrendChartProps) {
  if (data.length < 2) {
    return <div className="chart-empty"><p>トレンド分析には2回以上のイベントが必要です</p></div>
  }

  const chartData = data.map(d => ({ ...d, date: fmtDate(d.date) }))
  const gradId = `grad-${dataKey}`

  function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
    if (!active || !payload?.length) return null
    const entry = payload[0]?.payload as HistoryEntry & { date: string }
    const raw = payload[0]?.value as number
    return (
      <div className="chart-tooltip">
        <p className="tooltip-time">{entry.event_name}</p>
        <p className="tooltip-time">{data[chartData.findIndex(d => d.date === entry.date)]?.date ?? entry.date}</p>
        <p className="tooltip-value">
          <span className="tooltip-dot" style={{ background: color }} />
          {label}: <strong>{formatter ? formatter(raw) : raw}</strong>
        </p>
      </div>
    )
  }

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.4} />
              <stop offset="95%" stopColor={color} stopOpacity={0.05} />
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
            width={yTickFormatter ? 48 : 36}
            tickFormatter={yTickFormatter}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey={dataKey as string}
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradId})`}
            dot={{ r: 3, fill: color }}
            activeDot={{ r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
