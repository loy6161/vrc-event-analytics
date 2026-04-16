import { useState, useEffect } from 'react'
import { RetentionChart } from './charts/RetentionChart'
import { AttendanceTrendChart } from './charts/AttendanceTrendChart'
import type { EventInsights } from '../types/index.js'
import '../styles/Charts.css'
import '../styles/InsightsPage.css'

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function gradeColor(grade: string): string {
  switch (grade) {
    case 'S': return '#f1c40f'
    case 'A': return '#2ecc71'
    case 'B': return '#3498db'
    case 'C': return '#e67e22'
    case 'D': return '#e74c3c'
    default: return '#888'
  }
}

function trendIcon(trend: string): string {
  switch (trend) {
    case 'growing': return '📈'
    case 'declining': return '📉'
    default: return '➡️'
  }
}

function trendLabel(trend: string): string {
  switch (trend) {
    case 'growing': return '成長中'
    case 'declining': return '減少傾向'
    default: return '安定'
  }
}

function priorityColor(priority: string): string {
  switch (priority) {
    case 'high': return '#e74c3c'
    case 'medium': return '#f39c12'
    case 'low': return '#2ecc71'
    default: return '#888'
  }
}

function priorityLabel(priority: string): string {
  switch (priority) {
    case 'high': return '重要'
    case 'medium': return '注意'
    case 'low': return '良好'
    default: return ''
  }
}

// ──────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────

function HealthScoreCard({ insights }: { insights: EventInsights }) {
  const color = gradeColor(insights.health_grade)
  return (
    <div className="health-score-card">
      <div className="health-score-main">
        <div className="health-grade" style={{ color, borderColor: color }}>
          {insights.health_grade}
        </div>
        <div className="health-score-number">
          <span className="health-score-value">{insights.health_score}</span>
          <span className="health-score-max">/100</span>
        </div>
        <div className="health-score-label">イベント健全性スコア</div>
      </div>
      <div className="health-components">
        <HealthBar label="成長性" value={insights.health_components.growth} />
        <HealthBar label="リテンション" value={insights.health_components.retention} />
        <HealthBar label="エンゲージメント" value={insights.health_components.engagement} />
        <HealthBar label="コミュニティ" value={insights.health_components.community} />
      </div>
    </div>
  )
}

function HealthBar({ label, value }: { label: string; value: number }) {
  const color = value >= 70 ? '#2ecc71' : value >= 40 ? '#f39c12' : '#e74c3c'
  return (
    <div className="health-bar-row">
      <span className="health-bar-label">{label}</span>
      <div className="health-bar-track">
        <div className="health-bar-fill" style={{ width: `${value}%`, background: color }} />
      </div>
      <span className="health-bar-value">{value}</span>
    </div>
  )
}

function CommunityDonut({ community }: { community: EventInsights['community'] }) {
  const segments = [
    { label: 'コア (50%+)', count: community.core_count, color: '#f1c40f' },
    { label: 'レギュラー (25-50%)', count: community.regular_count, color: '#3498db' },
    { label: 'カジュアル (<25%)', count: community.casual_count, color: '#2ecc71' },
    { label: '一度きり', count: community.onetime_count, color: '#95a5a6' },
    { label: '離脱', count: community.churned_count, color: '#e74c3c' },
  ].filter(s => s.count > 0)

  const total = community.total_known || 1
  let cumAngle = 0

  // Build SVG arcs
  const arcs = segments.map(seg => {
    const angle = (seg.count / total) * 360
    const startAngle = cumAngle
    cumAngle += angle
    const endAngle = cumAngle

    const startRad = ((startAngle - 90) * Math.PI) / 180
    const endRad = ((endAngle - 90) * Math.PI) / 180
    const r = 50
    const cx = 60, cy = 60

    const x1 = cx + r * Math.cos(startRad)
    const y1 = cy + r * Math.sin(startRad)
    const x2 = cx + r * Math.cos(endRad)
    const y2 = cy + r * Math.sin(endRad)

    const largeArc = angle > 180 ? 1 : 0

    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`
    return { d, color: seg.color, label: seg.label }
  })

  return (
    <div className="community-section">
      <div className="community-chart">
        <svg viewBox="0 0 120 120" width="160" height="160">
          {arcs.map((arc, i) => (
            <path key={i} d={arc.d} fill={arc.color} opacity={0.85} />
          ))}
          <circle cx="60" cy="60" r="28" fill="#1a1d2e" />
          <text x="60" y="56" textAnchor="middle" fill="#e0e0e0" fontSize="16" fontWeight="700">
            {total}
          </text>
          <text x="60" y="72" textAnchor="middle" fill="#888" fontSize="9">
            総ユーザー
          </text>
        </svg>
      </div>
      <div className="community-legend">
        {segments.map((seg, i) => (
          <div key={i} className="community-legend-item">
            <span className="legend-dot" style={{ background: seg.color }} />
            <span className="community-legend-label">{seg.label}</span>
            <span className="community-legend-count">{seg.count}人</span>
            <span className="community-legend-pct">
              ({Math.round((seg.count / total) * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function RecommendationCard({ rec }: { rec: EventInsights['recommendations'][number] }) {
  return (
    <div className={`rec-card rec-${rec.priority}`}>
      <div className="rec-header">
        <span className="rec-icon">{rec.icon}</span>
        <span className="rec-title">{rec.title}</span>
        <span className="rec-priority" style={{ color: priorityColor(rec.priority) }}>
          {priorityLabel(rec.priority)}
        </span>
      </div>
      <p className="rec-description">{rec.description}</p>
      {rec.metric && <p className="rec-metric">{rec.metric}</p>}
      {rec.suggestion && (
        <div className="rec-suggestion">
          <span className="rec-suggestion-icon">💡</span>
          <span>{rec.suggestion}</span>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────

export function InsightsPage() {
  const [insights, setInsights] = useState<EventInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/analytics/insights')
      .then(r => r.json())
      .then(res => {
        if (res.success) setInsights(res.data)
        else setError(res.error ?? 'Failed to load insights')
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="insights-page">
        <div className="insights-loading">分析中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="insights-page">
        <div className="insights-error">{error}</div>
      </div>
    )
  }

  if (!insights || insights.attendance_history.length === 0) {
    return (
      <div className="insights-page">
        <div className="insights-empty">
          <div className="empty-icon">💡</div>
          <p>インサイトを表示するにはイベントデータが必要です</p>
          <p className="empty-hint">「ログ取込」ページで VRChat ログを取り込むとインサイトが生成されます。</p>
          <a href="#/logs" className="btn btn-primary">📂 ログを取り込む</a>
        </div>
      </div>
    )
  }

  return (
    <div className="insights-page">
      {/* Header */}
      <div className="insights-header">
        <div>
          <h1>インサイト</h1>
          <p>データに基づくイベント改善アドバイス</p>
        </div>
        <div className="insights-trend-badge">
          <span className="trend-icon">{trendIcon(insights.growth_trend)}</span>
          <span className="trend-label">{trendLabel(insights.growth_trend)}</span>
          {insights.growth_rate !== 0 && (
            <span className={`trend-rate ${insights.growth_rate > 0 ? 'positive' : 'negative'}`}>
              {insights.growth_rate > 0 ? '+' : ''}{insights.growth_rate.toFixed(1)}%
            </span>
          )}
        </div>
      </div>

      {/* Health Score + Recommendations */}
      <div className="insights-top-row">
        <HealthScoreCard insights={insights} />

        <div className="insights-recs-panel">
          <h3 className="insights-section-title">改善アドバイス</h3>
          {insights.recommendations.length === 0 ? (
            <div className="rec-empty">現時点でのアドバイスはありません。データが増えるとより具体的な提案が表示されます。</div>
          ) : (
            <div className="rec-list">
              {insights.recommendations.map((rec, i) => (
                <RecommendationCard key={i} rec={rec} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Attendance Trend */}
      <div className="insights-card">
        <h3 className="insights-section-title">参加者数の推移</h3>
        <AttendanceTrendChart data={insights.attendance_history} height={260} />
      </div>

      {/* Retention */}
      <div className="insights-card">
        <h3 className="insights-section-title">リテンション分析</h3>
        <p className="insights-section-sub">
          全体リテンション率: <strong>{(insights.overall_retention_rate * 100).toFixed(1)}%</strong>
          <span className="insights-hint">（前回イベント参加者のうち、次回も参加した割合）</span>
        </p>
        <RetentionChart data={insights.retention_by_event} height={300} />
      </div>

      {/* Community */}
      <div className="insights-card">
        <h3 className="insights-section-title">コミュニティ構成</h3>
        <p className="insights-section-sub">
          参加頻度に基づくユーザー分類
        </p>
        <CommunityDonut community={insights.community} />
      </div>
    </div>
  )
}
