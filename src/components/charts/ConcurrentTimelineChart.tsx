import { useMemo } from 'react'
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

interface TimelinePoint {
  timestamp: string
  concurrent: number
}

interface ConcurrentTimelineChartProps {
  data: TimelinePoint[]
  height?: number
}

function fmtAxisTime(iso: string): string {
  try {
    const d = new Date(iso)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  } catch {
    return iso
  }
}

function fmtTooltipTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <p className="tooltip-time">{fmtTooltipTime(label as string)}</p>
      <p className="tooltip-value">
        <span className="tooltip-dot" style={{ background: '#3498db' }} />
        Concurrent: <strong>{payload[0].value}</strong>
      </p>
    </div>
  )
}

export function ConcurrentTimelineChart({ data, height = 260 }: ConcurrentTimelineChartProps) {
  // Downsample to max ~300 points so the chart stays fast
  const chartData = useMemo(() => {
    if (data.length <= 300) return data
    const step = Math.ceil(data.length / 300)
    return data.filter((_, i) => i % step === 0 || i === data.length - 1)
  }, [data])

  if (data.length === 0) {
    return (
      <div className="chart-empty">
        <p>No timeline data available</p>
      </div>
    )
  }

  const maxY = Math.max(...chartData.map(d => d.concurrent), 1)

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <defs>
            <linearGradient id="concurrentGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3498db" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#3498db" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="timestamp"
            tickFormatter={fmtAxisTime}
            tick={{ fontSize: 12, fill: '#888' }}
            interval="preserveStartEnd"
            minTickGap={60}
          />
          <YAxis
            domain={[0, maxY + 1]}
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#888' }}
            width={32}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="stepAfter"
            dataKey="concurrent"
            stroke="#3498db"
            strokeWidth={2}
            fill="url(#concurrentGrad)"
            dot={false}
            activeDot={{ r: 4, fill: '#2980b9' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
