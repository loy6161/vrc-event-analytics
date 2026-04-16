import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  type TooltipProps,
} from 'recharts'

interface HourlyBucket {
  hour: string   // "YYYY-MM-DD HH:00"
  count: number
}

interface HourlyAttendanceChartProps {
  data: HourlyBucket[]
  height?: number
}

/** Show only the "HH:00" portion on the x-axis tick */
function fmtAxisHour(hour: string): string {
  // hour format: "YYYY-MM-DD HH:00"
  const parts = hour.split(' ')
  return parts[1] ?? hour
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <p className="tooltip-time">{label}</p>
      <p className="tooltip-value">
        <span className="tooltip-dot" style={{ background: '#2ecc71' }} />
        Unique visitors: <strong>{payload[0].value}</strong>
      </p>
    </div>
  )
}

export function HourlyAttendanceChart({ data, height = 220 }: HourlyAttendanceChartProps) {
  if (data.length === 0) {
    return (
      <div className="chart-empty">
        <p>No hourly data available</p>
      </div>
    )
  }

  const maxCount = Math.max(...data.map(d => d.count), 1)

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="hour"
            tickFormatter={fmtAxisHour}
            tick={{ fontSize: 12, fill: '#888' }}
            interval={data.length > 12 ? Math.floor(data.length / 12) : 0}
          />
          <YAxis
            domain={[0, maxCount + 1]}
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#888' }}
            width={32}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
          <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={48}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.count === maxCount ? '#27ae60' : '#2ecc71'}
                fillOpacity={0.85}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
