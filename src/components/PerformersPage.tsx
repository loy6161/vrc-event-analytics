import { useState, useEffect } from 'react'
import '../styles/PerformersPage.css'

interface PerformerEvent {
  id: number
  name: string
  date: string
  start_time: string | null
}

interface Performer {
  id: number
  user_id: string | null
  display_name: string
  performer_role: 'regular' | 'visitor'
  is_staff: boolean
  notes: string | null
  tags: string[]
  appearance_count: number
  events: PerformerEvent[]
}

export function PerformersPage() {
  const [performers, setPerformers] = useState<Performer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [roleFilter, setRoleFilter] = useState<'all' | 'regular' | 'visitor'>('all')

  useEffect(() => {
    fetch('/api/users/performers')
      .then(r => r.json())
      .then(data => {
        if (data.success) setPerformers(data.data)
        else setError(data.error ?? 'Failed to load performers')
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const toggleExpand = (id: number) => {
    const next = new Set(expanded)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpanded(next)
  }

  const filtered = roleFilter === 'all'
    ? performers
    : performers.filter(p => p.performer_role === roleFilter)

  const regulars = performers.filter(p => p.performer_role === 'regular')
  const visitors = performers.filter(p => p.performer_role === 'visitor')

  if (loading) return <div className="performers-loading">読み込み中...</div>
  if (error) return <div className="performers-error">{error}</div>

  return (
    <div className="performers-page">
      <div className="performers-header">
        <div>
          <h1>出演者一覧</h1>
          <p className="performers-desc">
            レギュラー・ビジター出演者の出演回数と履歴を確認できます。
          </p>
        </div>
      </div>

      {/* サマリーカード */}
      <div className="performers-summary">
        <div className="performer-stat-card">
          <div className="stat-value">{performers.length}</div>
          <div className="stat-label">出演者総数</div>
        </div>
        <div className="performer-stat-card performer-stat-regular">
          <div className="stat-value">{regulars.length}</div>
          <div className="stat-label">🎤 レギュラー</div>
        </div>
        <div className="performer-stat-card performer-stat-visitor">
          <div className="stat-value">{visitors.length}</div>
          <div className="stat-label">🌟 ビジター</div>
        </div>
      </div>

      {/* フィルタ */}
      <div className="performers-toolbar">
        <div className="role-filter-tabs">
          <button
            className={`role-tab ${roleFilter === 'all' ? 'active' : ''}`}
            onClick={() => setRoleFilter('all')}
          >
            全員 ({performers.length})
          </button>
          <button
            className={`role-tab role-tab-regular ${roleFilter === 'regular' ? 'active' : ''}`}
            onClick={() => setRoleFilter('regular')}
          >
            🎤 レギュラー ({regulars.length})
          </button>
          <button
            className={`role-tab role-tab-visitor ${roleFilter === 'visitor' ? 'active' : ''}`}
            onClick={() => setRoleFilter('visitor')}
          >
            🌟 ビジター ({visitors.length})
          </button>
        </div>
      </div>

      {/* 出演者一覧 */}
      {filtered.length === 0 ? (
        <div className="performers-empty">
          出演者が登録されていません。ユーザー詳細ページで出演者ロールを設定してください。
        </div>
      ) : (
        <div className="performers-list">
          {filtered.map(performer => (
            <div key={performer.id} className="performer-card">
              <div
                className="performer-card-header"
                onClick={() => toggleExpand(performer.id)}
              >
                <div className="performer-info">
                  <span
                    className={`performer-role-badge ${performer.performer_role === 'regular' ? 'badge-regular' : 'badge-visitor'}`}
                  >
                    {performer.performer_role === 'regular' ? '🎤 レギュラー' : '🌟 ビジター'}
                  </span>
                  <span className="performer-name">{performer.display_name}</span>
                  {performer.is_staff && (
                    <span className="badge badge-staff">⭐ Staff</span>
                  )}
                  {performer.tags.length > 0 && performer.tags.map(tag => (
                    <span key={tag} className="tag-pill-small">{tag}</span>
                  ))}
                </div>
                <div className="performer-meta">
                  <span className="performer-appearances">
                    出演 <strong>{performer.appearance_count}</strong> 回
                  </span>
                  {performer.appearance_count > 0 && (
                    <span className="performer-last-event">
                      最終: {performer.events[0]
                        ? new Date(performer.events[0].date).toLocaleDateString('ja-JP')
                        : '-'}
                    </span>
                  )}
                  <span className="expand-icon">{expanded.has(performer.id) ? '▲' : '▼'}</span>
                </div>
              </div>

              {expanded.has(performer.id) && (
                <div className="performer-events">
                  {performer.events.length === 0 ? (
                    <p className="performer-no-events">出演記録がありません</p>
                  ) : (
                    <table className="performer-event-table">
                      <thead>
                        <tr>
                          <th>日付</th>
                          <th>イベント名</th>
                          <th>開始時間</th>
                        </tr>
                      </thead>
                      <tbody>
                        {performer.events.map(evt => (
                          <tr key={evt.id}>
                            <td>{new Date(evt.date).toLocaleDateString('ja-JP')}</td>
                            <td>
                              <a
                                href={`#/events`}
                                className="performer-event-link"
                                onClick={e => e.stopPropagation()}
                              >
                                {evt.name}
                              </a>
                            </td>
                            <td>{evt.start_time ?? '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
