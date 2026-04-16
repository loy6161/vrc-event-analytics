import { useState, useEffect } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { ConcurrentTimelineChart } from './charts/ConcurrentTimelineChart'
import { HourlyAttendanceChart } from './charts/HourlyAttendanceChart'
import { StayDistributionChart } from './charts/StayDistributionChart'
import { ArrivalDepartureChart } from './charts/ArrivalDepartureChart'
import { PlayerEventTable } from './PlayerEventTable'
import { DataTable } from './DataTable'
import type { Event, EventStats, UserRankingItem, DetailedEventStats } from '../types/index.js'
import '../styles/Charts.css'
import '../styles/EventAnalyticsPanel.css'

// ──────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────

interface TimelinePoint {
  timestamp: string
  concurrent: number
}

type TabId = 'overview' | 'charts' | 'detailed' | 'attendees' | 'rankings'

interface Tab {
  id: TabId
  label: string
}

const TABS: Tab[] = [
  { id: 'overview',  label: '📊 概要' },
  { id: 'charts',    label: '📈 グラフ' },
  { id: 'detailed',  label: '🔍 詳細分析' },
  { id: 'attendees', label: '👥 参加者' },
  { id: 'rankings',  label: '🏆 ランキング' },
]

// ──────────────────────────────────────────────────────────────────
// Rankings table columns
// ──────────────────────────────────────────────────────────────────

const rankColHelper = createColumnHelper<UserRankingItem>()

const rankColumns = [
  rankColHelper.accessor('rank', {
    header: '#',
    cell: info => <span className="rank-badge">#{info.getValue()}</span>,
    size: 50,
  }),
  rankColHelper.accessor('display_name', {
    header: '名前',
    cell: info => info.getValue(),
  }),
  rankColHelper.accessor('attendance_count', {
    header: '参加回数',
    cell: info => info.getValue(),
    size: 80,
  }),
  rankColHelper.accessor('total_stay_duration', {
    header: '合計滞在',
    cell: info => fmtDuration(info.getValue()),
    size: 110,
  }),
  rankColHelper.accessor('avg_stay_duration', {
    header: '平均滞在',
    cell: info => fmtDuration(info.getValue()),
    size: 110,
  }),
  rankColHelper.accessor('first_attendance', {
    header: '初回参加',
    cell: info => fmtTimestamp(info.getValue()),
    size: 160,
  }),
]

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function fmtDuration(minutes: number): string {
  if (!minutes || minutes <= 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmtTimestamp(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

// ──────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

function OverviewTab({ stats }: { stats: EventStats }) {
  return (
    <div className="overview-tab">
      {/* Primary KPIs */}
      <div className="stats-grid stats-grid--primary">
        <StatCard label="参加者数" value={stats.total_attendees} sub="再入場は1回扱い" />
        <StatCard label="Join回数" value={stats.total_joins} sub="再入場含む実Join数" />
        <StatCard label="ピーク同時接続" value={stats.peak_concurrent} />
        <StatCard
          label="再入場率"
          value={pct(stats.reentry_rate)}
          sub="再度入場した参加者"
        />
      </div>

      {/* Stay duration metrics */}
      <h4 className="section-subtitle">滞在時間</h4>
      <div className="stats-grid stats-grid--secondary">
        <StatCard
          label="平均滞在時間"
          value={fmtDuration(stats.avg_stay_duration)}
        />
        <StatCard
          label="中央値滞在"
          value={fmtDuration(stats.median_stay_duration)}
        />
        <StatCard
          label="最長滞在"
          value={fmtDuration(stats.max_stay_duration)}
        />
      </div>
    </div>
  )
}

function ChartsTab({ stats, timeline }: { stats: EventStats; timeline: TimelinePoint[] }) {
  return (
    <div className="charts-tab">
      <div className="chart-block">
        <p className="chart-section-title">時系列別同時接続者数</p>
        <ConcurrentTimelineChart data={timeline} height={260} />
      </div>
      <div className="chart-block">
        <p className="chart-section-title">時間別ユニーク参加者</p>
        <HourlyAttendanceChart data={stats.hourly_attendance} height={220} />
      </div>
    </div>
  )
}

function ScoreGauge({ score, label }: { score: number; label: string }) {
  const color = score >= 70 ? '#2ecc71' : score >= 40 ? '#f39c12' : '#e74c3c'
  return (
    <div className="score-gauge">
      <svg viewBox="0 0 120 70" width="120" height="70">
        <path
          d="M 10 60 A 50 50 0 0 1 110 60"
          fill="none"
          stroke="#2a2f42"
          strokeWidth="8"
          strokeLinecap="round"
        />
        <path
          d="M 10 60 A 50 50 0 0 1 110 60"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * 157} 157`}
        />
        <text x="60" y="55" textAnchor="middle" fill="#e0e0e0" fontSize="22" fontWeight="700">
          {score}
        </text>
      </svg>
      <div className="score-gauge-label">{label}</div>
    </div>
  )
}

function DetailedTab({ detailed }: { detailed: DetailedEventStats }) {
  return (
    <div className="detailed-tab">
      {/* Engagement Score */}
      <div className="detailed-section">
        <h4 className="section-subtitle">エンゲージメントスコア</h4>
        <div className="engagement-scores">
          <ScoreGauge score={detailed.engagement_score} label="総合" />
          <ScoreGauge score={detailed.engagement_breakdown.stay_score} label="滞在" />
          <ScoreGauge score={detailed.engagement_breakdown.retention_score} label="リテンション" />
          <ScoreGauge score={detailed.engagement_breakdown.activity_score} label="アクティビティ" />
        </div>
      </div>

      {/* First-timer vs Returner */}
      <div className="detailed-section">
        <h4 className="section-subtitle">参加者構成</h4>
        <div className="composition-bar-wrapper">
          <div className="composition-bar">
            {detailed.returner_count > 0 && (
              <div
                className="composition-segment returner"
                style={{ width: `${(1 - detailed.first_timer_rate) * 100}%` }}
                title={`リピーター: ${detailed.returner_count}人`}
              />
            )}
            {detailed.first_timer_count > 0 && (
              <div
                className="composition-segment first-timer"
                style={{ width: `${detailed.first_timer_rate * 100}%` }}
                title={`初参加: ${detailed.first_timer_count}人`}
              />
            )}
          </div>
          <div className="composition-legend">
            <span className="legend-item">
              <span className="legend-dot" style={{ background: '#3498db' }} />
              リピーター: {detailed.returner_count}人 ({pct(1 - detailed.first_timer_rate)})
            </span>
            <span className="legend-item">
              <span className="legend-dot" style={{ background: '#2ecc71' }} />
              初参加: {detailed.first_timer_count}人 ({pct(detailed.first_timer_rate)})
            </span>
          </div>
        </div>
      </div>

      {/* Early leaver */}
      <div className="detailed-section">
        <h4 className="section-subtitle">早期離脱（15分以内）</h4>
        <div className="stats-grid stats-grid--secondary">
          <StatCard label="早期離脱者" value={detailed.early_leaver_count} sub="15分未満で離脱" />
          <StatCard label="早期離脱率" value={pct(detailed.early_leaver_rate)} />
        </div>
      </div>

      {/* Stay distribution */}
      <div className="detailed-section">
        <h4 className="section-subtitle">滞在時間の分布</h4>
        <StayDistributionChart data={detailed.stay_distribution} height={220} />
      </div>

      {/* Arrival / Departure */}
      <div className="detailed-section">
        <h4 className="section-subtitle">到着・離脱タイミング</h4>
        <ArrivalDepartureChart
          arrivals={detailed.arrival_timeline}
          departures={detailed.departure_timeline}
          height={260}
        />
        <div className="chart-legend-note">
          棒グラフ: 5分ごとの到着・離脱人数 ｜ 折れ線: 累計（右軸）
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────

interface EventAnalyticsPanelProps {
  eventId: number
  eventName: string
  event?: Event
}

export function EventAnalyticsPanel({ eventId, eventName, event }: EventAnalyticsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  const [stats, setStats]       = useState<EventStats | null>(null)
  const [timeline, setTimeline] = useState<TimelinePoint[]>([])
  const [rankings, setRankings] = useState<UserRankingItem[]>([])
  const [detailed, setDetailed] = useState<DetailedEventStats | null>(null)
  const [rankSort, setRankSort] = useState<'attendance' | 'stay'>('attendance')

  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  // Fetch stats + timeline + detailed in parallel on mount / eventId change
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setStats(null)
    setTimeline([])
    setRankings([])
    setDetailed(null)

    Promise.all([
      fetch(`/api/analytics/events/${eventId}/stats`).then(r => r.json()),
      fetch(`/api/analytics/events/${eventId}/timeline`).then(r => r.json()),
      fetch(`/api/analytics/events/${eventId}/rankings?sort=attendance`).then(r => r.json()),
      fetch(`/api/analytics/events/${eventId}/detailed`).then(r => r.json()),
    ])
      .then(([statsRes, timelineRes, rankRes, detailedRes]) => {
        if (cancelled) return
        if (statsRes.success)    setStats(statsRes.data)
        if (timelineRes.success) setTimeline(timelineRes.data)
        if (rankRes.success)     setRankings(rankRes.data)
        if (detailedRes.success) setDetailed(detailedRes.data)
        if (!statsRes.success)   setError(statsRes.error ?? 'Failed to load stats')
      })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [eventId])

  // Re-fetch rankings when sort changes
  useEffect(() => {
    fetch(`/api/analytics/events/${eventId}/rankings?sort=${rankSort}`)
      .then(r => r.json())
      .then(res => { if (res.success) setRankings(res.data) })
      .catch(() => {})
  }, [eventId, rankSort])

  // ── Render states ──────────────────────────────────────────────

  if (loading) {
    return (
      <div className="analytics-panel">
        <div className="analytics-loading">読み込み中...</div>
      </div>
    )
  }

  if (error || !stats) {
    return (
      <div className="analytics-panel">
        <div className="analytics-error">{error ?? 'データがありません'}</div>
      </div>
    )
  }

  // ── Layout ─────────────────────────────────────────────────────

  return (
    <div className="analytics-panel">
      {/* Panel header */}
      <div className="analytics-header">
        <div>
          <h3 className="analytics-title">分析 — {eventName}</h3>
          {event && (
            <div className="analytics-event-meta">
              {event.world_name && <span className="meta-item">🌍 {event.world_name}</span>}
              {event.region && <span className="meta-badge meta-region">{event.region.toUpperCase()}</span>}
              {event.access_type && <span className="meta-badge meta-access">{event.access_type}</span>}
              {event.instance_id && <span className="meta-item meta-instance" title={event.instance_id}>#{event.instance_id.split(':')[1]?.split('~')[0]}</span>}
            </div>
          )}
        </div>
        <div className="analytics-export-btns">
          <a
            className="export-btn"
            href={`/api/export/events/${eventId}/xlsx`}
            download
            title="Excel レポートをダウンロード"
          >
            📥 XLSX
          </a>
          <a
            className="export-btn"
            href={`/api/export/events/${eventId}/csv/player-events`}
            download
            title="参加者イベント CSV をダウンロード"
          >
            📄 CSV
          </a>
        </div>
      </div>

      {/* Tab bar */}
      <div className="analytics-tabs">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`analytics-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="analytics-body">
        {activeTab === 'overview' && <OverviewTab stats={stats} />}

        {activeTab === 'charts' && (
          <ChartsTab stats={stats} timeline={timeline} />
        )}

        {activeTab === 'detailed' && detailed && (
          <DetailedTab detailed={detailed} />
        )}

        {activeTab === 'attendees' && (
          <PlayerEventTable eventId={eventId} />
        )}

        {activeTab === 'rankings' && (
          <div className="rankings-tab">
            <div className="rankings-toolbar">
              <span className="rankings-sort-label">ソート:</span>
              <button
                className={`sort-btn${rankSort === 'attendance' ? ' active' : ''}`}
                onClick={() => setRankSort('attendance')}
              >
                参加回数
              </button>
              <button
                className={`sort-btn${rankSort === 'stay' ? ' active' : ''}`}
                onClick={() => setRankSort('stay')}
              >
                合計滞在時間
              </button>
            </div>
            <DataTable
              data={rankings}
              columns={rankColumns}
              globalFilterPlaceholder="名前で検索..."
              defaultPageSize={20}
              emptyMessage="ランキングデータはまだありません"
            />
          </div>
        )}
      </div>
    </div>
  )
}
