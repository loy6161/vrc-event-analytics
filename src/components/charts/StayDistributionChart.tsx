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

interface StayBucket {
  bucket: string
  min_minutes: number
  max_minutes: number
  count: number
  percentage: number
}

interface StayDistributionChartProps {
  data: StayBucket[]
  height?: number
}

const COLORS = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6']

function CustomTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload as StayBucket
  return (
    <div className="chart-tooltip">
      <p className="tooltip-time">{d.bucket}</p>
      <p className="tooltip-value">
        <strong>{d.count}</strong> 人 ({d.percentage}%)
      </p>
    </div>
  )
}

export function StayDistributionChart({ data, height = 220 }: StayDistributionChartProps) {
  if (data.length === 0 || data.every(d => d.count === 0)) {
    return <div className="chart-empty"><p>滞在時間データなし</p></div>
  }

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2f42" vertical={false} />
          <XAxis
            dataKey="bucket"
            tick={{ fontSize: 11, fill: '#888' }}
            interval={0}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#888' }}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={60}>
            {data.map((_, i) => (
              <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
