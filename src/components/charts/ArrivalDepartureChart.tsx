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

interface TimelinePoint {
  minutes_from_start: number
  count: number
  cumulative: number
}

interface ArrivalDepartureChartProps {
  arrivals: TimelinePoint[]
  departures: TimelinePoint[]
  height?: number
}

function fmtMinutes(m: number): string {
  if (m < 60) return `${m}分`
  const h = Math.floor(m / 60)
  const min = m % 60
  return min > 0 ? `${h}h${min}m` : `${h}h`
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tooltip">
      <p className="tooltip-time">開始から {label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="tooltip-value">
          <span className="tooltip-dot" style={{ background: entry.color }} />
          {entry.name}: <strong>{entry.value}</strong>
        </p>
      ))}
    </div>
  )
}

export function ArrivalDepartureChart({ arrivals, departures, height = 260 }: ArrivalDepartureChartProps) {
  if (arrivals.length === 0 && departures.length === 0) {
    return <div className="chart-empty"><p>到着・離脱データなし</p></div>
  }

  // Merge arrivals and departures into a single timeline
  const allMinutes = new Set<number>()
  for (const a of arrivals) allMinutes.add(a.minutes_from_start)
  for (const d of departures) allMinutes.add(d.minutes_from_start)
  const sortedMinutes = Array.from(allMinutes).sort((a, b) => a - b)

  const arrMap = new Map(arrivals.map(a => [a.minutes_from_start, a]))
  const depMap = new Map(departures.map(d => [d.minutes_from_start, d]))

  const chartData = sortedMinutes.map(m => ({
    time: fmtMinutes(m),
    '到着': arrMap.get(m)?.count ?? 0,
    '離脱': depMap.get(m)?.count ?? 0,
    '累計到着': arrMap.get(m)?.cumulative ?? null,
    '累計離脱': depMap.get(m)?.cumulative ?? null,
  }))

  // Fill cumulative gaps (carry forward)
  let lastArrCum = 0
  let lastDepCum = 0
  for (const d of chartData) {
    if (d['累計到着'] !== null) lastArrCum = d['累計到着']
    else d['累計到着'] = lastArrCum
    if (d['累計離脱'] !== null) lastDepCum = d['累計離脱']
    else d['累計離脱'] = lastDepCum
  }

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={chartData} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2f42" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 11, fill: '#888' }}
            interval={Math.max(0, Math.floor(chartData.length / 10) - 1)}
          />
          <YAxis
            yAxisId="count"
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#888' }}
            width={36}
          />
          <YAxis
            yAxisId="cumulative"
            orientation="right"
            allowDecimals={false}
            tick={{ fontSize: 12, fill: '#aaa' }}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar
            yAxisId="count"
            dataKey="到着"
            fill="#2ecc71"
            fillOpacity={0.7}
            radius={[3, 3, 0, 0]}
            maxBarSize={20}
          />
          <Bar
            yAxisId="count"
            dataKey="離脱"
            fill="#e74c3c"
            fillOpacity={0.7}
            radius={[3, 3, 0, 0]}
            maxBarSize={20}
          />
          <Line
            yAxisId="cumulative"
            type="monotone"
            dataKey="累計到着"
            stroke="#27ae60"
            strokeWidth={2}
            dot={false}
          />
          <Line
            yAxisId="cumulative"
            type="monotone"
            dataKey="累計離脱"
            stroke="#c0392b"
            strokeWidth={2}
            strokeDasharray="4 2"
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
