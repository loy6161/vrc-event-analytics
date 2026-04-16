import { useState, useEffect, useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { PeriodTrendChart } from './charts/PeriodTrendChart'
import { DataTable } from './DataTable'
import type { PeriodStats } from '../types/index.js'
import { dataCache } from '../utils/dataCache.js'
import '../styles/Charts.css'
import '../styles/ReportsPage.css'

// ──────────────────────────────────────────────────────────────────
// Table columns
// ──────────────────────────────────────────────────────────────────

const col = createColumnHelper<PeriodStats>()

const periodColumns = [
  col.accessor('period', {
    header: '期間',
    cell: info => <span className="period-cell">{formatPeriodLabel(info.getValue())}</span>,
    size: 110,
  }),
  col.accessor('event_count', {
    header: 'イベント数',
    cell: info => info.getValue(),
    size: 80,
  }),
  col.accessor('total_attendees', {
    header: '総Join数',
    cell: info => info.getValue().toLocaleString(),
    size: 110,
  }),
  col.accessor('unique_attendees', {
    header: 'ユニーク',
    cell: info => info.getValue().toLocaleString(),
    size: 90,
  }),
  col.accessor('avg_attendees_per_event', {
    header: '平均/イベント',
    cell: info => info.getValue().toFixed(1),
    size: 100,
  }),
  col.accessor('new_attendees', {
    header: '新規参加',
    cell: info => info.getValue().toLocaleString(),
    size: 80,
  }),
  col.accessor('repeat_attendee_rate', {
    header: 'リピート率',
    cell: info => (
      <span className="rate-cell">
        <span
          className="rate-bar"
          style={{ width: `${Math.round(info.getValue() * 100)}%` }}
        />
        <span className="rate-text">{pct(info.getValue())}</span>
      </span>
    ),
    size: 120,
  }),
]

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function formatPeriodLabel(period: string): string {
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [year, month] = period.split('-')
    const mon = new Date(`${year}-${month}-01`).toLocaleString('default', { month: 'long' })
    return `${mon} ${year}`
  }
  return period
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function sumStats(periods: PeriodStats[]) {
  return {
    event_count: periods.reduce((s, p) => s + p.event_count, 0),
    total_attendees: periods.reduce((s, p) => s + p.total_attendees, 0),
    unique_attendees: Math.max(...periods.map(p => p.unique_attendees), 0),
    new_attendees: periods.reduce((s, p) => s + p.new_attendees, 0),
    avg_attendees_per_event:
      periods.length > 0
        ? periods.reduce((s, p) => s + p.avg_attendees_per_event, 0) / periods.length
        : 0,
    avg_repeat_rate:
      periods.length > 0
        ? periods.reduce((s, p) => s + p.repeat_attendee_rate, 0) / periods.length
        : 0,
  }
}

// ──────────────────────────────────────────────────────────────────
// Sub-component: summary KPI row
// ──────────────────────────────────────────────────────────────────

interface SummaryKPI {
  label: string
  value: string | number
  sub?: string
}

function SummaryBar({ kpis }: { kpis: SummaryKPI[] }) {
  return (
    <div className="report-summary-bar">
      {kpis.map(k => (
        <div key={k.label} className="report-kpi">
          <div className="report-kpi-label">{k.label}</div>
          <div className="report-kpi-value">{k.value}</div>
          {k.sub && <div className="report-kpi-sub">{k.sub}</div>}
        </div>
      ))}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const [allPeriods, setAllPeriods] = useState<PeriodStats[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedYear, setSelectedYear] = useState<string>('all')

  const load = async (force = false) => {
    const cached = dataCache.get<PeriodStats[]>('periods')
    if (cached && !force) {
      setAllPeriods(cached)
      if (selectedYear === 'all' && cached.length > 0) setSelectedYear(cached[cached.length - 1].period.slice(0, 4))
      setLoading(false)
      return
    }
    try {
      const res = await fetch('/api/analytics/periods').then(r => r.json())
      if (res.success) {
        dataCache.set('periods', res.data)
        setAllPeriods(res.data)
        if (res.data.length > 0) setSelectedYear(res.data[res.data.length - 1].period.slice(0, 4))
      } else {
        setError(res.error ?? 'Failed to load periods')
      }
    } catch (err: any) { setError(err.message) }
    finally { setLoading(false); setRefreshing(false) }
  }

  const refresh = () => { dataCache.delete('periods'); setRefreshing(true); load(true) }

  useEffect(() => { load() }, [])

  // Extract unique years
  const availableYears = useMemo(() => {
    const years = new Set(allPeriods.map(p => p.period.slice(0, 4)))
    return Array.from(years).sort().reverse()
  }, [allPeriods])

  // Filter periods by selected year
  const filteredPeriods = useMemo(() => {
    if (selectedYear === 'all') return allPeriods
    return allPeriods.filter(p => p.period.startsWith(selectedYear))
  }, [allPeriods, selectedYear])

  // Compute summary KPIs
  const summary = useMemo(() => sumStats(filteredPeriods), [filteredPeriods])

  // ── Render ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="reports-page">
        <div className="reports-loading">読み込み中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="reports-page">
        <div className="reports-error">{error}</div>
      </div>
    )
  }

  const summaryKPIs: SummaryKPI[] = [
    { label: 'イベント数', value: summary.event_count },
    { label: '総Join数', value: summary.total_attendees.toLocaleString() },
    { label: 'ユニーク参加者', value: summary.unique_attendees.toLocaleString(), sub: '期間内最大' },
    { label: '新規参加者', value: summary.new_attendees.toLocaleString() },
    { label: '平均/イベント', value: summary.avg_attendees_per_event.toFixed(1) },
    { label: '平均リピート率', value: pct(summary.avg_repeat_rate) },
  ]

  return (
    <div className="reports-page">
      {/* Page header */}
      <div className="reports-header">
        <div className="reports-title-row">
          <h1>レポート</h1>
          <button className="btn-refresh" onClick={refresh} disabled={refreshing}>
            ↻ {refreshing ? '更新中...' : '更新'}
          </button>
        </div>
        <p>月別・年別の参加者トレンド</p>
      </div>

      {allPeriods.length === 0 ? (
        <div className="reports-empty">
          <div className="empty-icon">📊</div>
          <p>まだレポートデータがありません</p>
          <p className="empty-hint">「ログ取込」ページで VRChat ログを取り込むとレポートが表示されます。</p>
          <a href="#/logs" className="btn btn-primary">📂 ログを取り込む</a>
        </div>
      ) : (
        <>
          {/* Year filter */}
          <div className="reports-year-filter">
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

          {/* Summary KPIs */}
          <SummaryBar kpis={summaryKPIs} />

          {/* Trend chart */}
          <div className="reports-card">
            <p className="chart-section-title">
              参加者トレンド — {selectedYear === 'all' ? '全期間' : selectedYear}
            </p>
            <PeriodTrendChart data={filteredPeriods} height={300} />
            <div className="chart-legend-note">
              棒グラフ: 総Join数・新規参加者数 &nbsp;|&nbsp; 折れ線: ユニーク参加者数（赤）・イベント数（オレンジ破線）
            </div>
          </div>

          {/* Detailed table */}
          <div className="reports-card">
            <p className="chart-section-title">月別内訳</p>
            <DataTable
              data={[...filteredPeriods].reverse()}
              columns={periodColumns}
              globalFilterPlaceholder="期間で絞り込み..."
              defaultPageSize={24}
              emptyMessage="この期間にはデータがありません"
            />
          </div>
        </>
      )}
    </div>
  )
}
