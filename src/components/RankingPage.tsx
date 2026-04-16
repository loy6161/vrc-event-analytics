import { useState, useEffect, useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { createColumnHelper } from '@tanstack/react-table'
import { DataTable } from './DataTable'
import type { UserRankingItem, PeriodStats } from '../types/index.js'
import '../styles/RankingPage.css'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

type SortType = 'attendance' | 'stay'

// ─────────────────────────────────────────────
// Table columns
// ─────────────────────────────────────────────

const col = createColumnHelper<UserRankingItem>()

function buildColumns(sortBy: SortType) {
  return [
    col.accessor('rank', {
      header: 'Rank',
      cell: info => <RankBadge rank={info.getValue()} />,
      size: 60,
    }),
    col.accessor('display_name', {
      header: 'Name',
      cell: info => (
        <a
          href={`#/users/detail/${encodeURIComponent(info.getValue())}`}
          className="ranking-user-link"
        >
          {info.getValue()}
        </a>
      ),
      size: 180,
    }),
    col.accessor('attendance_count', {
      header: 'Visits',
      cell: info => (
        <span className={sortBy === 'attendance' ? 'ranking-primary-value' : ''}>
          {info.getValue()}
        </span>
      ),
      size: 80,
    }),
    col.accessor('total_stay_duration', {
      header: 'Total Stay',
      cell: info => (
        <span className={sortBy === 'stay' ? 'ranking-primary-value' : ''}>
          {formatMinutes(info.getValue())}
        </span>
      ),
      size: 110,
    }),
    col.accessor('avg_stay_duration', {
      header: 'Avg Stay',
      cell: info => formatMinutes(info.getValue()),
      size: 100,
    }),
    col.accessor('first_attendance', {
      header: 'First Visit',
      cell: info => new Date(info.getValue()).toLocaleDateString(),
      size: 110,
    }),
    col.accessor('last_attendance', {
      header: 'Last Visit',
      cell: info => new Date(info.getValue()).toLocaleDateString(),
      size: 110,
    }),
  ]
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="rank-badge rank-gold">🥇 1st</span>
  if (rank === 2) return <span className="rank-badge rank-silver">🥈 2nd</span>
  if (rank === 3) return <span className="rank-badge rank-bronze">🥉 3rd</span>
  return <span className="rank-number">#{rank}</span>
}

function formatMinutes(minutes: number): string {
  if (!minutes || minutes === 0) return '0m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  return `${hours}h ${mins}m`
}

const BAR_COLORS = {
  1: '#f1c40f',
  2: '#bdc3c7',
  3: '#cd7f32',
}
const DEFAULT_BAR = '#3498db'
const TOP_CHART_COUNT = 20

interface CustomTooltipProps {
  active?: boolean
  payload?: any[]
  label?: string
  sortBy: SortType
}

function CustomTooltip({ active, payload, label, sortBy }: CustomTooltipProps) {
  if (!active || !payload?.length) return null
  const value = payload[0].value
  return (
    <div className="ranking-tooltip">
      <div className="tooltip-name">{label}</div>
      <div className="tooltip-value">
        {sortBy === 'attendance' ? `${value} visits` : formatMinutes(value)}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────

export function RankingPage() {
  const [rankings, setRankings] = useState<UserRankingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortType>('attendance')
  const [selectedYear, setSelectedYear] = useState<string>('all')
  const [availableYears, setAvailableYears] = useState<string[]>([])

  // Load available years from periods endpoint
  useEffect(() => {
    fetch('/api/analytics/periods')
      .then(r => r.json())
      .then(res => {
        if (res.success) {
          const years = [
            ...new Set((res.data as PeriodStats[]).map(p => p.period.slice(0, 4))),
          ].sort().reverse()
          setAvailableYears(years as string[])
        }
      })
      .catch(() => {}) // non-critical
  }, [])

  // Fetch rankings whenever sort or period changes
  useEffect(() => {
    setLoading(true)
    setError(null)

    const params = new URLSearchParams()
    params.set('sort', sortBy)
    if (selectedYear !== 'all') params.set('period', selectedYear)

    fetch(`/api/analytics/rankings?${params}`)
      .then(r => r.json())
      .then(res => {
        if (res.success) {
          setRankings(res.data)
        } else {
          setError(res.error ?? 'Failed to load rankings')
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [sortBy, selectedYear])

  const chartData = useMemo(
    () =>
      rankings.slice(0, TOP_CHART_COUNT).map(r => ({
        name: r.display_name,
        value: sortBy === 'attendance' ? r.attendance_count : r.total_stay_duration,
        rank: r.rank,
      })),
    [rankings, sortBy],
  )

  const columns = useMemo(() => buildColumns(sortBy), [sortBy])

  // ── Render ──────────────────────────────────

  return (
    <div className="ranking-page">
      {/* Header */}
      <div className="ranking-header">
        <div className="ranking-title-row">
          <h1>ランキング</h1>
        </div>
        <p>参加回数・滞在時間でのリーダーボード。名前をクリックするとユーザー詳細を表示します。</p>
      </div>

      {/* Controls row */}
      <div className="ranking-controls">
        <div className="sort-tabs">
          <button
            className={`sort-tab${sortBy === 'attendance' ? ' active' : ''}`}
            onClick={() => setSortBy('attendance')}
          >
            参加回数
          </button>
          <button
            className={`sort-tab${sortBy === 'stay' ? ' active' : ''}`}
            onClick={() => setSortBy('stay')}
          >
            合計滞在時間
          </button>
        </div>

        <div className="ranking-year-filter">
          <button
            className={`year-btn${selectedYear === 'all' ? ' active' : ''}`}
            onClick={() => setSelectedYear('all')}
          >
            全期間
          </button>
          {availableYears.map(year => (
            <button
              key={year}
              className={`year-btn${selectedYear === year ? ' active' : ''}`}
              onClick={() => setSelectedYear(year)}
            >
              {year}
            </button>
          ))}
        </div>
      </div>

      {/* Bar chart */}
      {loading ? (
        <div className="ranking-loading">読み込み中...</div>
      ) : error ? (
        <div className="ranking-error">{error}</div>
      ) : rankings.length === 0 ? (
        <div className="ranking-empty">
          <div className="empty-icon">🏆</div>
          <p>まだデータがありません</p>
          <p className="empty-hint">「ログ取込」ページで VRChat のログを取り込むとランキングが表示されます。</p>
          <a href="#/logs" className="btn btn-primary">📂 ログを取り込む</a>
        </div>
      ) : (
        <>
          <div className="ranking-card">
            <p className="chart-section-title">
              Top {Math.min(TOP_CHART_COUNT, rankings.length)} —{' '}
              {sortBy === 'attendance' ? '参加回数' : '合計滞在時間'}
              {selectedYear !== 'all' ? ` (${selectedYear})` : ''}
            </p>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart
                data={chartData}
                margin={{ top: 8, right: 16, left: 16, bottom: 64 }}
              >
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  angle={-40}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  tickFormatter={v =>
                    sortBy === 'attendance' ? String(v) : formatMinutes(v)
                  }
                  width={70}
                />
                <Tooltip content={<CustomTooltip sortBy={sortBy} />} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell
                      key={index}
                      fill={
                        (BAR_COLORS as any)[entry.rank] ??
                        (entry.rank <= 10 ? '#2980b9' : DEFAULT_BAR)
                      }
                      opacity={1 - index * 0.015}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div className="chart-legend-note">
              下の表のユーザー名をクリックすると詳細プロフィールを表示します
            </div>
          </div>

          <div className="ranking-card">
            <p className="chart-section-title">
              全リーダーボード{selectedYear !== 'all' ? ` — ${selectedYear}` : ''}
            </p>
            <DataTable
              data={rankings}
              columns={columns}
              globalFilterPlaceholder="ユーザー名で検索..."
              defaultPageSize={20}
              emptyMessage="データなし"
            />
          </div>
        </>
      )}
    </div>
  )
}
