import { useState, useEffect } from 'react'
import type { PeriodStats, SeriesComparison } from '../types/index.js'
import { dataCache } from '../utils/dataCache.js'
import { useSeries } from '../contexts/SeriesContext'
import '../styles/Dashboard.css'

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface RecentEvent {
  id: number
  name: string
  date: string
  world_name: string | null
  unique_visitors: number
  total_visits: number
}

interface DashboardData {
  total_events: number
  total_visits: number
  total_unique_visitors: number
  avg_per_event: number
  recent_events: RecentEvent[]
  current_month: PeriodStats | null
  previous_month: PeriodStats | null
}

interface PrepCitizenAlert {
  display_name: string
  type: 'expired' | 'promotion' | 'reach'
  days_since_last?: number
  attendance_count?: number
  total_stay_hours?: number
  need_attend?: number
  need_stay_minutes?: number
}

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

interface KpiCardProps {
  label: string
  value: string | number
  sub?: string
  delta?: number // percentage change vs previous
}

function KpiCard({ label, value, sub, delta }: KpiCardProps) {
  return (
    <div className="dash-kpi-card">
      <div className="dash-kpi-label">{label}</div>
      <div className="dash-kpi-value">{value}</div>
      {sub && <div className="dash-kpi-sub">{sub}</div>}
      {delta !== undefined && (
        <div className={`dash-kpi-delta ${delta >= 0 ? 'up' : 'down'}`}>
          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% vs last month
        </div>
      )}
    </div>
  )
}

interface MonthCardProps {
  title: string
  stats: PeriodStats
}

function MonthCard({ title, stats }: MonthCardProps) {
  return (
    <div className="dash-month-card">
      <h3>{title}</h3>
      <div className="dash-month-grid">
        <div className="dash-month-item">
          <span className="dash-month-label">Events</span>
          <span className="dash-month-value">{stats.event_count}</span>
        </div>
        <div className="dash-month-item">
          <span className="dash-month-label">Total Visits</span>
          <span className="dash-month-value">{stats.total_attendees.toLocaleString()}</span>
        </div>
        <div className="dash-month-item">
          <span className="dash-month-label">Unique Visitors</span>
          <span className="dash-month-value">{stats.unique_attendees.toLocaleString()}</span>
        </div>
        <div className="dash-month-item">
          <span className="dash-month-label">New Visitors</span>
          <span className="dash-month-value">{stats.new_attendees.toLocaleString()}</span>
        </div>
        <div className="dash-month-item">
          <span className="dash-month-label">Avg / Event</span>
          <span className="dash-month-value">{stats.avg_attendees_per_event.toFixed(1)}</span>
        </div>
        <div className="dash-month-item">
          <span className="dash-month-label">Repeat Rate</span>
          <span className="dash-month-value">{(stats.repeat_attendee_rate * 100).toFixed(1)}%</span>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [prepAlerts, setPrepAlerts] = useState<PrepCitizenAlert[]>([])
  const [citizenshipTargets, setCitizenshipTargets] = useState<string[]>([])
  const [seriesCards, setSeriesCards] = useState<SeriesComparison[]>([])
  const { series, setSeries, colorOf } = useSeries()

  const loadDashboard = async (force = false) => {
    const key = `dashboard:${series}`
    const cached = dataCache.get<DashboardData>(key)
    if (cached && !force) { setData(cached); setLoading(false); return }
    try {
      const url = series ? `/api/analytics/dashboard?series=${encodeURIComponent(series)}` : '/api/analytics/dashboard'
      const res = await fetch(url).then(r => r.json())
      if (res.success) { dataCache.set(key, res.data); setData(res.data) }
      else setError(res.error ?? 'Failed to load dashboard')
    } catch (err: any) { setError(err.message) }
    finally { setLoading(false); setRefreshing(false) }
  }

  // 準市民アラートは「市民権の判定対象シリーズ」のみで計算（サーバー側）。ページのシリーズ絞り込みには追従しない。
  const loadAlerts = async (force = false) => {
    const cached = dataCache.get<{ alerts: PrepCitizenAlert[]; target_series: string[] }>('citizenship-alerts')
    if (cached && !force) { setPrepAlerts(cached.alerts); setCitizenshipTargets(cached.target_series); return }
    try {
      const res = await fetch('/api/users/citizenship-alerts').then(r => r.json())
      if (res.success) { dataCache.set('citizenship-alerts', res.data); setPrepAlerts(res.data.alerts); setCitizenshipTargets(res.data.target_series) }
    } catch { /* non-critical */ }
  }

  // 全体ビュー時のみ: シリーズ内訳カード（Fathom の All sites view 相当）
  const loadSeriesCards = async (force = false) => {
    if (series) { setSeriesCards([]); return }
    const cached = dataCache.get<SeriesComparison[]>('series-comparison')
    if (cached && !force) { setSeriesCards(cached); return }
    try {
      const res = await fetch('/api/analytics/series-comparison').then(r => r.json())
      if (res.success) { dataCache.set('series-comparison', res.data); setSeriesCards(res.data) }
    } catch { /* non-critical */ }
  }

  const refresh = () => {
    dataCache.deletePrefix('dashboard:')
    dataCache.delete('citizenship-alerts')
    dataCache.delete('series-comparison')
    setRefreshing(true)
    loadDashboard(true)
    loadAlerts(true)
    loadSeriesCards(true)
  }

  useEffect(() => { setLoading(true); loadDashboard(); loadAlerts(); loadSeriesCards() }, [series])

  if (loading) {
    return (
      <div className="dashboard-page">
        <div className="dash-loading">Loading dashboard…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="dashboard-page">
        <div className="dash-error">{error}</div>
      </div>
    )
  }

  // No data yet: show onboarding steps
  if (!data || data.total_events === 0) {
    return (
      <div className="dashboard-page">
        <div className="dash-welcome">
          <h1>VRChat Event Analytics へようこそ</h1>
          <p>まずログファイルを取り込んで、イベントと参加者データを自動生成しましょう。</p>
        </div>
        <div className="dash-onboarding-steps">
          <a href="#/logs" className="dash-onboarding-step">
            <div className="dash-step-num">1</div>
            <div className="dash-step-content">
              <strong>📂 ログを取り込む</strong>
              <span>「ログ取込」ページで VRChat の <code>output_log_*.txt</code> をドロップするだけで、ワールドセッションごとにイベントが自動生成されます。</span>
            </div>
            <div className="dash-step-arrow">→</div>
          </a>
          <a href="#/events" className="dash-onboarding-step">
            <div className="dash-step-num">2</div>
            <div className="dash-step-content">
              <strong>📅 イベントを確認する</strong>
              <span>「イベント」ページで取り込まれたイベントを確認。クリックで参加者タイムラインや統計を表示できます。</span>
            </div>
            <div className="dash-step-arrow">→</div>
          </a>
          <a href="#/reports" className="dash-onboarding-step">
            <div className="dash-step-num">3</div>
            <div className="dash-step-content">
              <strong>📋 分析する</strong>
              <span>「レポート」「ランキング」でリピーター率・月別推移・参加者ランキングを確認できます。</span>
            </div>
            <div className="dash-step-arrow">→</div>
          </a>
        </div>
        <div className="dash-tip">
          💡 ログファイルの場所：<code>%USERPROFILE%\AppData\LocalLow\VRChat\VRChat\</code>
        </div>
      </div>
    )
  }

  const { total_events, total_visits, total_unique_visitors, avg_per_event, recent_events, current_month, previous_month } = data

  // Compute month-over-month delta for total_visits
  const visitsDelta = current_month && previous_month && previous_month.total_attendees > 0
    ? ((current_month.total_attendees - previous_month.total_attendees) / previous_month.total_attendees) * 100
    : undefined

  const uniqueDelta = current_month && previous_month && previous_month.unique_attendees > 0
    ? ((current_month.unique_attendees - previous_month.unique_attendees) / previous_month.unique_attendees) * 100
    : undefined

  return (
    <div className="dashboard-page">
      <div className="dash-page-header">
        <div className="dash-header-row">
          <div>
            <h1>ダッシュボード{series ? ` — 🎪 ${series}` : ''}</h1>
            <p>{series ? `「${series}」の参加者数・統計サマリー` : '全イベントの参加者数・統計サマリー'}</p>
          </div>
          <button className="btn-refresh" onClick={refresh} disabled={refreshing}>
            ↻ {refreshing ? '更新中...' : '更新'}
          </button>
        </div>
      </div>

      {/* All-time KPIs */}
      <section className="dash-section">
        <h2 className="dash-section-title">累計</h2>
        <div className="dash-kpi-grid">
          <KpiCard label="総イベント数" value={total_events} />
          <KpiCard label="総 Join 数" value={total_visits.toLocaleString()} delta={visitsDelta} />
          <KpiCard label="ユニーク参加者数" value={total_unique_visitors.toLocaleString()} delta={uniqueDelta} />
          <KpiCard label="平均参加者/イベント" value={avg_per_event} />
        </div>
      </section>

      {/* シリーズ内訳（全体ビューのみ・Fathom の All sites view 相当）。クリックでそのシリーズへ切替 */}
      {!series && seriesCards.filter(c => c.series).length > 0 && (
        <section className="dash-section">
          <h2 className="dash-section-title">シリーズ別の概況</h2>
          <div className="dash-series-grid">
            {seriesCards.filter(c => c.series).map(c => (
              <button key={c.series} className="dash-series-card" onClick={() => setSeries(c.series)} title={`${c.series} に絞り込む`}>
                <div className="dash-series-card-head">
                  <span className="dash-series-card-dot" style={{ background: colorOf(c.series) }} />
                  <span className="dash-series-card-name">{c.series}</span>
                </div>
                <div className="dash-series-card-metrics">
                  <span><strong>{c.event_count}</strong>回</span>
                  <span>平均<strong>{c.avg_attendees}</strong>人</span>
                  <span>最大<strong>{c.max_attendees}</strong>人</span>
                </div>
                <div className="dash-series-card-sub">
                  ユニーク{c.unique_users}人・リピート{(c.repeat_rate * 100).toFixed(0)}%
                  {c.last_date && <> ・直近 {c.last_date}</>}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Month comparison */}
      {(current_month || previous_month) && (
        <section className="dash-section">
          <h2 className="dash-section-title">月次比較</h2>
          <div className="dash-month-row">
            {current_month && (
              <MonthCard title={`今月 (${formatMonthLabel(current_month.period)})`} stats={current_month} />
            )}
            {previous_month && (
              <MonthCard title={`先月 (${formatMonthLabel(previous_month.period)})`} stats={previous_month} />
            )}
          </div>
        </section>
      )}

      {/* Recent events */}
      {recent_events.length > 0 && (
        <section className="dash-section">
          <div className="dash-section-header">
            <h2 className="dash-section-title">最近のイベント</h2>
            <a href="#/events" className="dash-view-all">すべて見る →</a>
          </div>
          <div className="dash-recent-events">
            {recent_events.map(event => (
              <a key={event.id} href={`#/events`} className="dash-event-row" onClick={() => (window.location.hash = '#/events')}>
                <div className="dash-event-main">
                  <span className="dash-event-name">{event.name}</span>
                  <span className="dash-event-date">{new Date(event.date).toLocaleDateString()}</span>
                  {event.world_name && (
                    <span className="dash-event-world">{event.world_name}</span>
                  )}
                </div>
                <div className="dash-event-stats">
                  <span className="dash-event-stat">
                    <strong>{event.unique_visitors}</strong> unique
                  </span>
                  <span className="dash-event-stat">
                    <strong>{event.total_visits}</strong> visits
                  </span>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {/* 準市民アラート（市民権の判定対象シリーズのみで計算・ページの絞り込みに非追従） */}
      {prepAlerts.length > 0 && (
        <section className="dash-section">
          <h2 className="dash-section-title">
            準市民アラート
            <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.6, marginLeft: 10 }}>
              判定対象: {citizenshipTargets.length > 0 ? citizenshipTargets.join('・') : '全イベント'} ／ 出演者・関係者（マネージャー/スタッフ）は除外
            </span>
          </h2>
          <div className="dash-prep-alerts">
            {prepAlerts.map(alert => (
              <div
                key={alert.display_name}
                className={`dash-prep-alert dash-prep-alert-${alert.type}`}
              >
                <div className="dash-prep-alert-icon">
                  {alert.type === 'expired' ? '⚠️' : alert.type === 'promotion' ? '🎉' : '🎯'}
                </div>
                <div className="dash-prep-alert-body">
                  <div className="dash-prep-alert-name">{alert.display_name}</div>
                  {alert.type === 'expired' ? (
                    <div className="dash-prep-alert-desc">
                      市民権失効 — 最終参加から <strong>{alert.days_since_last}</strong> 日経過
                    </div>
                  ) : alert.type === 'promotion' ? (
                    <div className="dash-prep-alert-desc">
                      昇格条件達成 — 参加 <strong>{alert.attendance_count}</strong> 回 / 合計滞在 <strong>{alert.total_stay_hours}</strong>h
                    </div>
                  ) : (
                    <div className="dash-prep-alert-desc">
                      リーチ — 参加 <strong>{alert.attendance_count}</strong> 回 / 滞在 <strong>{alert.total_stay_hours}</strong>h。あと
                      {(alert.need_attend ?? 0) > 0 && <> 参加<strong>{alert.need_attend}</strong>回</>}
                      {(alert.need_attend ?? 0) > 0 && (alert.need_stay_minutes ?? 0) > 0 && '・'}
                      {(alert.need_stay_minutes ?? 0) > 0 && <> 滞在<strong>{Math.ceil((alert.need_stay_minutes ?? 0) / 6) / 10}</strong>h</>}
                      で昇格
                    </div>
                  )}
                </div>
                <div className="dash-prep-alert-badge">
                  {alert.type === 'expired' ? '市民権失効' : alert.type === 'promotion' ? '昇格' : 'リーチ'}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Quick links */}
      <section className="dash-section">
        <h2 className="dash-section-title">クイックリンク</h2>
        <div className="dash-quick-links">
          <a href="#/logs" className="dash-quick-link">
            <span className="dash-ql-icon">📂</span>
            <strong>ログ取込</strong>
            <span>VRChat ログを取り込んでイベントを自動生成</span>
          </a>
          <a href="#/events" className="dash-quick-link">
            <span className="dash-ql-icon">📅</span>
            <strong>イベント</strong>
            <span>イベント一覧と参加者分析</span>
          </a>
          <a href="#/reports" className="dash-quick-link">
            <span className="dash-ql-icon">📋</span>
            <strong>レポート</strong>
            <span>月別・年別のトレンド</span>
          </a>
          <a href="#/rankings" className="dash-quick-link">
            <span className="dash-ql-icon">🏆</span>
            <strong>ランキング</strong>
            <span>参加者リーダーボード</span>
          </a>
        </div>
      </section>
    </div>
  )
}

function formatMonthLabel(period: string): string {
  if (/^\d{4}-\d{2}$/.test(period)) {
    const [year, month] = period.split('-')
    const mon = new Date(`${year}-${month}-01`).toLocaleString('default', { month: 'long' })
    return `${mon} ${year}`
  }
  return period
}
