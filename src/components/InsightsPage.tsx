import { useState, useEffect } from 'react'
import { RetentionChart } from './charts/RetentionChart'
import { AttendanceTrendChart } from './charts/AttendanceTrendChart'
import { EventTrendChart } from './charts/EventTrendChart'
import { SeriesOverlayChart } from './charts/SeriesOverlayChart'
import type { EventInsights, SeriesComparison, SeriesTrend, FormatComparison } from '../types/index.js'
import { dataCache } from '../utils/dataCache.js'
import { useSeries } from '../contexts/SeriesContext'
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
// Chart panel config
// ──────────────────────────────────────────────────────────────────

function fmtMinutes(v: number): string {
  if (v < 60) return `${Math.round(v)}m`
  const h = Math.floor(v / 60)
  const m = Math.round(v % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}
function fmtPct(v: number): string { return `${Math.round(v * 100)}%` }

type HistoryKey = keyof Omit<EventInsights['attendance_history'][number], 'event_id' | 'event_name' | 'date'>

interface PanelConfig {
  id: string
  title: string
  sub?: string
  special?: 'attendance' | 'retention' | 'community'
  dataKey?: HistoryKey
  color?: string
  formatter?: (v: number) => string
  yTickFormatter?: (v: number) => string
}

const PANEL_CONFIGS: PanelConfig[] = [
  { id: 'attendance',         title: '参加者数の推移',       special: 'attendance' },
  { id: 'total_joins',        title: '総Join数の推移',        dataKey: 'total_joins',        color: '#2ecc71' },
  { id: 'peak_concurrent',    title: 'ピーク同接の推移',      dataKey: 'peak_concurrent',    color: '#e67e22' },
  { id: 'avg_stay_duration',  title: '平均滞在時間の推移',    dataKey: 'avg_stay_duration',  color: '#9b59b6', formatter: fmtMinutes, yTickFormatter: fmtMinutes },
  { id: 'new_attendees',      title: '新規参加者数の推移',    dataKey: 'new_attendees',      color: '#1abc9c' },
  { id: 'returning_attendees',title: 'リピーター数の推移',    dataKey: 'returning_attendees',color: '#3498db' },
  { id: 'retention_rate',     title: 'リテンション率の推移',  dataKey: 'retention_rate',     color: '#e74c3c', formatter: fmtPct, yTickFormatter: fmtPct },
  { id: 'retention_analysis', title: 'リテンション分析',      special: 'retention' },
  { id: 'community',          title: 'コミュニティ構成',      special: 'community' },
]

const DEFAULT_ORDER = PANEL_CONFIGS.map(p => p.id)
const STORAGE_KEY = 'insights-chart-order'

function loadOrder(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as string[]
      const merged = parsed.filter(id => DEFAULT_ORDER.includes(id))
      for (const id of DEFAULT_ORDER) if (!merged.includes(id)) merged.push(id)
      return merged
    }
  } catch { /* ignore */ }
  return [...DEFAULT_ORDER]
}

function saveOrder(order: string[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(order)) } catch { /* ignore */ }
}

// ──────────────────────────────────────────────────────────────────
// Main page
// ──────────────────────────────────────────────────────────────────

export function InsightsPage() {
  const [insights, setInsights] = useState<EventInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [panelOrder, setPanelOrder] = useState<string[]>(loadOrder)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  // シリーズ絞り込みはヘッダーのグローバルセレクタと連動（'' = 全イベント）。
  // 絞ると成長率/リテンションもそのシリーズ内だけで計算される
  const { series: seriesFilter, setSeries: setSeriesFilter, colorOf } = useSeries()
  const [comparison, setComparison] = useState<SeriesComparison[]>([])
  const [trends, setTrends] = useState<SeriesTrend[]>([])
  const [formats, setFormats] = useState<FormatComparison[]>([])

  const load = async (force = false) => {
    const key = `insights:${seriesFilter}`
    const cached = dataCache.get<EventInsights>(key)
    if (cached && !force) { setInsights(cached); setLoading(false); return }
    try {
      const url = seriesFilter
        ? `/api/analytics/insights?series=${encodeURIComponent(seriesFilter)}`
        : '/api/analytics/insights'
      const res = await fetch(url).then(r => r.json())
      if (res.success) { dataCache.set(key, res.data); setInsights(res.data) }
      else setError(res.error ?? 'Failed to load insights')
    } catch (err: any) { setError(err.message) }
    finally { setLoading(false); setRefreshing(false) }
  }

  const loadComparison = async (force = false) => {
    const cached = dataCache.get<SeriesComparison[]>('series-comparison')
    if (cached && !force) { setComparison(cached); return }
    try {
      const res = await fetch('/api/analytics/series-comparison').then(r => r.json())
      if (res.success) { dataCache.set('series-comparison', res.data); setComparison(res.data) }
    } catch { /* 比較表は任意機能 */ }
  }

  const loadTrends = async (force = false) => {
    const cached = dataCache.get<SeriesTrend[]>('series-trends')
    if (cached && !force) { setTrends(cached); return }
    try {
      const res = await fetch('/api/analytics/series-trends').then(r => r.json())
      if (res.success) { dataCache.set('series-trends', res.data); setTrends(res.data) }
    } catch { /* 重ね描きは任意機能 */ }
  }

  // 開催形態比較。グローバルのシリーズ絞り込みに追従（シリーズ内の形態比較も可能）
  const loadFormats = async (force = false) => {
    const key = `format-comparison:${seriesFilter}`
    const cached = dataCache.get<FormatComparison[]>(key)
    if (cached && !force) { setFormats(cached); return }
    try {
      const url = seriesFilter
        ? `/api/analytics/format-comparison?series=${encodeURIComponent(seriesFilter)}`
        : '/api/analytics/format-comparison'
      const res = await fetch(url).then(r => r.json())
      if (res.success) { dataCache.set(key, res.data); setFormats(res.data) }
    } catch { /* 形態比較は任意機能 */ }
  }

  const refresh = () => {
    dataCache.deletePrefix('insights:')
    dataCache.delete('series-comparison')
    dataCache.delete('series-trends')
    dataCache.deletePrefix('format-comparison:')
    setRefreshing(true)
    load(true)
    loadComparison(true)
    loadTrends(true)
    loadFormats(true)
  }

  useEffect(() => { setLoading(true); load(); loadFormats() }, [seriesFilter])
  useEffect(() => { loadComparison(); loadTrends() }, [])

  const handleDragStart = (e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(id)
  }
  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id !== dragOverId) setDragOverId(id)
  }
  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault()
    if (!draggingId || draggingId === targetId) { setDraggingId(null); setDragOverId(null); return }
    const next = [...panelOrder]
    const from = next.indexOf(draggingId)
    const to = next.indexOf(targetId)
    next.splice(from, 1)
    next.splice(to, 0, draggingId)
    setPanelOrder(next)
    saveOrder(next)
    setDraggingId(null)
    setDragOverId(null)
  }
  const handleDragEnd = () => { setDraggingId(null); setDragOverId(null) }

  if (loading) {
    return <div className="insights-page"><div className="insights-loading">分析中...</div></div>
  }
  if (error) {
    return <div className="insights-page"><div className="insights-error">{error}</div></div>
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

  function renderPanelContent(cfg: PanelConfig) {
    if (cfg.special === 'attendance') {
      return <AttendanceTrendChart data={insights!.attendance_history} height={240} />
    }
    if (cfg.special === 'retention') {
      return (
        <>
          <p className="chart-panel-sub">
            全体リテンション率: <strong>{(insights!.overall_retention_rate * 100).toFixed(1)}%</strong>
            <span className="insights-hint">（前回イベント参加者のうち、次回も参加した割合）</span>
          </p>
          <RetentionChart data={insights!.retention_by_event} height={280} />
        </>
      )
    }
    if (cfg.special === 'community') {
      return (
        <>
          <p className="chart-panel-sub">参加頻度に基づくユーザー分類</p>
          <CommunityDonut community={insights!.community} />
        </>
      )
    }
    if (cfg.dataKey) {
      return (
        <EventTrendChart
          data={insights!.attendance_history}
          dataKey={cfg.dataKey}
          label={cfg.title.replace('の推移', '')}
          color={cfg.color!}
          formatter={cfg.formatter}
          yTickFormatter={cfg.yTickFormatter}
          height={240}
        />
      )
    }
    return null
  }

  const configMap = new Map(PANEL_CONFIGS.map(c => [c.id, c]))

  return (
    <div className="insights-page">
      {/* Header */}
      <div className="insights-header">
        <div>
          <h1>インサイト{seriesFilter ? ` — 🎪 ${seriesFilter}` : ''}</h1>
          <p>{seriesFilter ? `「${seriesFilter}」のデータに基づく改善アドバイス` : 'データに基づくイベント改善アドバイス'}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div className="insights-trend-badge">
            <span className="trend-icon">{trendIcon(insights.growth_trend)}</span>
            <span className="trend-label">{trendLabel(insights.growth_trend)}</span>
            {insights.growth_rate !== 0 && (
              <span className={`trend-rate ${insights.growth_rate > 0 ? 'positive' : 'negative'}`}>
                {insights.growth_rate > 0 ? '+' : ''}{insights.growth_rate.toFixed(1)}%
              </span>
            )}
          </div>
          <button className="btn-refresh" onClick={refresh} disabled={refreshing}>
            ↻ {refreshing ? '更新中...' : '更新'}
          </button>
        </div>
      </div>

      {/* シリーズ重ね描き（全体ビューのみ・2シリーズ以上）。GA4 Comparisons 相当 */}
      {!seriesFilter && trends.filter(t => t.series).length >= 2 && (
        <div className="insights-recs-panel" style={{ marginBottom: 16 }}>
          <h3 className="insights-section-title">🎪 シリーズ別の参加者推移（重ね描き）</h3>
          <SeriesOverlayChart trends={trends} colorOf={colorOf} height={280} />
          <p style={{ fontSize: 12, opacity: 0.55, margin: '8px 0 0' }}>
            シリーズごとに色分けした参加者数の推移。週次と年次など開催ペースの違うシリーズを1枚で比較できます。
          </p>
        </div>
      )}

      {/* シリーズ比較（2グループ以上あるときだけ表示） */}
      {comparison.length >= 2 && (
        <div className="insights-recs-panel" style={{ marginBottom: 16 }}>
          <h3 className="insights-section-title">🎪 シリーズ比較</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'right', opacity: 0.7 }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>シリーズ</th>
                  <th style={{ padding: '6px 8px' }}>開催数</th>
                  <th style={{ padding: '6px 8px' }}>平均参加者</th>
                  <th style={{ padding: '6px 8px' }}>最大</th>
                  <th style={{ padding: '6px 8px' }}>ユニーク</th>
                  <th style={{ padding: '6px 8px' }}>リピート率</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>期間</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map(c => (
                  <tr
                    key={c.series || '__none__'}
                    style={{
                      textAlign: 'right',
                      borderTop: '1px solid rgba(128,128,128,0.15)',
                      background: seriesFilter && c.series === seriesFilter ? 'rgba(99,102,241,0.08)' : undefined,
                      cursor: c.series ? 'pointer' : 'default',
                    }}
                    onClick={() => { if (c.series) setSeriesFilter(c.series === seriesFilter ? '' : c.series) }}
                    title={c.series ? 'クリックでこのシリーズに絞り込み' : undefined}
                  >
                    <td style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>
                      {c.series || <span style={{ opacity: 0.5 }}>未分類</span>}
                    </td>
                    <td style={{ padding: '6px 8px' }}>{c.event_count}回</td>
                    <td style={{ padding: '6px 8px' }}>{c.avg_attendees}人</td>
                    <td style={{ padding: '6px 8px' }}>{c.max_attendees}人</td>
                    <td style={{ padding: '6px 8px' }}>{c.unique_users}人</td>
                    <td style={{ padding: '6px 8px' }}>{(c.repeat_rate * 100).toFixed(0)}%</td>
                    <td style={{ textAlign: 'left', padding: '6px 8px', opacity: 0.7 }}>
                      {c.first_date}{c.event_count > 1 ? ` 〜 ${c.last_date}` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, opacity: 0.55, margin: '8px 0 0' }}>
            行をクリックするとそのシリーズだけのインサイトに切り替わります。リピート率＝そのシリーズに2回以上参加した人の割合。
          </p>
        </div>
      )}

      {/* 開催形態比較（2形態以上あるときだけ表示）。手動の開催形態 > ログ由来のアクセス種別 */}
      {formats.length >= 2 && (
        <div className="insights-recs-panel" style={{ marginBottom: 16 }}>
          <h3 className="insights-section-title">🚪 開催形態別の比較{seriesFilter ? `（${seriesFilter}内）` : ''}</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'right', opacity: 0.7 }}>
                  <th style={{ textAlign: 'left', padding: '6px 8px' }}>開催形態</th>
                  <th style={{ padding: '6px 8px' }}>開催数</th>
                  <th style={{ padding: '6px 8px' }}>平均参加者</th>
                  <th style={{ padding: '6px 8px' }}>最大</th>
                  <th style={{ padding: '6px 8px' }}>ユニーク</th>
                  <th style={{ padding: '6px 8px' }}>リピート率</th>
                </tr>
              </thead>
              <tbody>
                {formats.map(f => (
                  <tr key={f.format} style={{ textAlign: 'right', borderTop: '1px solid rgba(128,128,128,0.15)' }}>
                    <td style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 600 }}>{f.format}</td>
                    <td style={{ padding: '6px 8px' }}>{f.event_count}回</td>
                    <td style={{ padding: '6px 8px' }}>{f.avg_attendees}人</td>
                    <td style={{ padding: '6px 8px' }}>{f.max_attendees}人</td>
                    <td style={{ padding: '6px 8px' }}>{f.unique_users}人</td>
                    <td style={{ padding: '6px 8px' }}>{(f.repeat_rate * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 12, opacity: 0.55, margin: '8px 0 0' }}>
            形態＝イベント編集で設定した「開催形態」（事前申請制など）。未設定の場合はログ由来のアクセス種別（Group / Group+ / Group公開 等）で分類。
          </p>
        </div>
      )}

      {/* Health Score + Recommendations (fixed, not draggable) */}
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

      {/* Draggable chart panels */}
      <div className="insights-charts-area">
        {panelOrder.map(id => {
          const cfg = configMap.get(id)
          if (!cfg) return null
          return (
            <div
              key={id}
              className={`chart-panel${draggingId === id ? ' is-dragging' : ''}${dragOverId === id && draggingId !== id ? ' drag-over' : ''}`}
              draggable
              onDragStart={e => handleDragStart(e, id)}
              onDragOver={e => handleDragOver(e, id)}
              onDrop={e => handleDrop(e, id)}
              onDragEnd={handleDragEnd}
            >
              <div className="chart-panel-header">
                <span className="chart-drag-handle" title="ドラッグして並び替え">⠿</span>
                <h3 className="chart-panel-title">{cfg.title}</h3>
              </div>
              <div className="chart-panel-body">
                {renderPanelContent(cfg)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
