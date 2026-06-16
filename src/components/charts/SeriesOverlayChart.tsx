import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { BrandTrend } from '../../types/index.js'

interface SeriesOverlayChartProps {
  trends: BrandTrend[]
  colorOf: (name: string) => string
  height?: number
}

function fmtDate(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    return `${d.getFullYear().toString().slice(2)}/${d.getMonth() + 1}/${d.getDate()}`
  } catch {
    return dateStr
  }
}

/**
 * ブランド別の参加者推移を1枚に重ね描き（GA4 Comparisons 相当）。
 * 各イベントの日付を x 軸に共有し、ブランドごとに色分けしたラインを引く。
 * 開催日がずれるブランド同士でも、日付キーで揃えて点在表示する（connectNulls で線をつなぐ）。
 */
export function SeriesOverlayChart({ trends, colorOf, height = 280 }: SeriesOverlayChartProps) {
  const named = trends.filter(t => t.brand && t.points.length > 0)
  if (named.length < 2) {
    return <div className="chart-empty"><p>重ね描きには2つ以上のブランドが必要です</p></div>
  }

  // 全日付を集めて行を作り、各ブランドの値を埋める
  const allDates = Array.from(new Set(named.flatMap(t => t.points.map(p => p.date)))).sort()
  const rows = allDates.map(date => {
    const row: Record<string, any> = { date: fmtDate(date) }
    for (const t of named) {
      const pt = t.points.find(p => p.date === date)
      if (pt) row[t.brand] = pt.unique_attendees
    }
    return row
  })

  return (
    <div className="chart-container">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={rows} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a2f42" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: '#888' }}
            interval={rows.length > 12 ? Math.floor(rows.length / 12) : 0}
          />
          <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#888' }} width={36} />
          <Tooltip
            contentStyle={{ background: '#1a1f2e', border: '1px solid #2a2f42', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#aaa' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {named.map(t => (
            <Line
              key={t.brand}
              type="monotone"
              dataKey={t.brand}
              stroke={colorOf(t.brand)}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
