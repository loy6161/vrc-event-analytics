import { useState, useEffect } from 'react'
import { Event } from '../types/index.js'
import { dataCache } from '../utils/dataCache.js'
import { useSeries } from '../contexts/SeriesContext'
import '../styles/EventList.css'

interface EventListProps {
  onSelect?: (event: Event) => void
}

export function EventList({ onSelect }: EventListProps) {
  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<'date' | 'name'>('date')
  // ブランド絞り込みはヘッダーのグローバルセレクタと連動。
  // 「全イベント」表示時のみ、未分類イベントだけを出すローカルトグルが使える（タグ付け作業用）
  const { series: globalBrand, refreshSeriesList } = useSeries()
  const [showUnclassifiedOnly, setShowUnclassifiedOnly] = useState(false)

  // 結合機能
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const [mergeTargetId, setMergeTargetId] = useState<number | null>(null)
  const [merging, setMerging] = useState(false)

  // ブランド一括設定
  const [showBrandDialog, setShowBrandDialog] = useState(false)
  const [brandInput, setBrandInput] = useState('')
  const [settingBrand, setSettingBrand] = useState(false)

  useEffect(() => { fetchEvents() }, [])

  const fetchEvents = async (force = false) => {
    const cached = dataCache.get<Event[]>('events')
    if (cached && !force) { setEvents(cached); setLoading(false); return }
    try {
      setLoading(true)
      const response = await fetch('/api/events')
      const data = await response.json()
      if (data.success) {
        dataCache.set('events', data.data)
        setEvents(data.data)
      } else {
        setError(data.error || 'Failed to fetch events')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('このイベントを削除しますか？関連する参加者データも削除されます。')) return
    try {
      const response = await fetch(`/api/events/${id}`, { method: 'DELETE' })
      const data = await response.json()
      if (data.success) {
        setEvents(events.filter(e => e.id !== id))
        setSelectedIds(prev => { const s = new Set(prev); s.delete(id); return s })
      } else {
        setError(data.error)
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  const openMergeDialog = () => {
    // デフォルトは最初に選択したもの（= 日付が最も新しいもの）
    const selected = events.filter(e => selectedIds.has(e.id))
    if (selected.length >= 2) {
      setMergeTargetId(selected[0].id)
      setShowMergeDialog(true)
    }
  }

  const handleSetBrand = async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    setSettingBrand(true)
    try {
      const res = await fetch('/api/events/bulk-brand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, brand: brandInput.trim() || null }),
      })
      const data = await res.json()
      if (data.success) {
        setShowBrandDialog(false)
        setSelectedIds(new Set())
        dataCache.clear()
        refreshSeriesList() // ヘッダーのブランド一覧に即反映
        await fetchEvents(true)
      } else {
        setError(data.error)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSettingBrand(false)
    }
  }

  const handleMerge = async () => {
    if (!mergeTargetId) return
    const sourceIds = [...selectedIds].filter(id => id !== mergeTargetId)
    setMerging(true)
    try {
      const res = await fetch('/api/events/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: mergeTargetId, sourceIds }),
      })
      const data = await res.json()
      if (data.success) {
        setShowMergeDialog(false)
        setSelectedIds(new Set())
        await fetchEvents()
      } else {
        setError(data.error)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setMerging(false)
    }
  }

  // 登録済みブランド（フィルタ選択肢用）
  const allBrands = [...new Set(events.map(e => e.brand).filter((s): s is string => !!s))].sort()

  let filtered = events.filter(e =>
    e.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    e.date.includes(searchTerm)
  )
  if (globalBrand) filtered = filtered.filter(e => e.brand === globalBrand)
  else if (showUnclassifiedOnly) filtered = filtered.filter(e => !e.brand)

  if (sortBy === 'name') {
    filtered = filtered.sort((a, b) => a.name.localeCompare(b.name))
  } else {
    filtered = filtered.sort((a, b) => {
      const da = `${a.date} ${a.start_time ?? '00:00'}`
      const db2 = `${b.date} ${b.start_time ?? '00:00'}`
      return db2.localeCompare(da)
    })
  }

  const selectedEvents = events.filter(e => selectedIds.has(e.id))

  if (loading) return <div className="event-list loading">読み込み中...</div>
  if (error) return <div className="event-list error">{error}</div>

  return (
    <div className="event-list">
      <div className="event-list-header">
        <div>
          <h2>イベント一覧</h2>
          <p className="event-list-desc">VRChat イベントの参加者データを管理・分析します。イベントをクリックすると詳細分析が表示されます。</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn-refresh" onClick={() => { dataCache.delete('events'); fetchEvents(true) }}>
            ↻ 更新
          </button>
          <a href="#/events/new" className="btn btn-primary">
            ➕ イベントを作成
          </a>
        </div>
      </div>

      <div className="event-list-toolbar">
        <input
          type="text"
          placeholder="イベント名・日付で検索..."
          className="search-input"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
        {!globalBrand && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, whiteSpace: 'nowrap', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showUnclassifiedOnly}
              onChange={e => setShowUnclassifiedOnly(e.target.checked)}
            />
            未分類のみ
          </label>
        )}
        <select
          className="sort-select"
          value={sortBy}
          onChange={e => setSortBy(e.target.value as 'date' | 'name')}
        >
          <option value="date">日付順</option>
          <option value="name">名前順</option>
        </select>
      </div>

      {/* 選択時ツールバー（結合・シリーズ設定） */}
      {selectedIds.size >= 1 && (
        <div className="merge-toolbar">
          <span className="merge-count">{selectedIds.size} 件選択中</span>
          {selectedIds.size >= 2 && (
            <button className="btn btn-merge" onClick={openMergeDialog}>
              🔗 選択したイベントを結合
            </button>
          )}
          <button
            className="btn btn-merge"
            onClick={() => {
              // 選択中イベントの既存ブランドを初期値に（揃っていれば）
              const sel = events.filter(e => selectedIds.has(e.id))
              const uniq = [...new Set(sel.map(e => e.brand ?? ''))]
              setBrandInput(uniq.length === 1 ? uniq[0] : '')
              setShowBrandDialog(true)
            }}
          >
            🎪 ブランドを設定
          </button>
          <button className="btn-small" onClick={() => setSelectedIds(new Set())}>
            選択解除
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="event-list-empty">
          {events.length === 0 ? (
            <>
              <div className="empty-icon">📂</div>
              <p>まだイベントがありません</p>
              <p className="empty-hint">「ログ取込」ページで VRChat のログファイルを取り込むと、イベントが自動生成されます。</p>
              <a href="#/logs" className="btn btn-primary">📂 ログを取り込む</a>
            </>
          ) : (
            <>
              <p>「{searchTerm}」に一致するイベントが見つかりません</p>
            </>
          )}
        </div>
      ) : (
        <div className="event-list-table">
          <div className="table-header">
            <div className="col-check"></div>
            <div className="col-name">イベント名</div>
            <div className="col-date">日付・開始時刻</div>
            <div className="col-world">ワールド</div>
            <div className="col-actions">操作</div>
          </div>
          {filtered.map(event => (
            <div
              key={event.id}
              className={`table-row${selectedIds.has(event.id) ? ' row-selected' : ''}`}
              onClick={() => onSelect?.(event)}
            >
              <div className="col-check" onClick={e => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(event.id)}
                  onChange={() => toggleSelect(event.id)}
                  className="row-checkbox"
                />
              </div>
              <div className="col-name">
                <span className="event-name-text">{event.name}</span>
                {event.brand && (
                  <span style={{
                    marginLeft: 6, padding: '1px 8px', borderRadius: 10, fontSize: 11,
                    background: 'rgba(99,102,241,0.18)', color: '#6366f1', fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}>🎪 {event.brand}</span>
                )}
                {event.start_time && (
                  <span className="event-start-badge">🕐 {event.start_time}</span>
                )}
              </div>
              <div className="col-date">
                <div>{event.date}</div>
                {event.start_time && (
                  <div className="time-range">
                    {event.start_time}{event.end_time ? ` 〜 ${event.end_time}` : '〜'}
                  </div>
                )}
              </div>
              <div className="col-world">
                <div>{event.world_name || event.world_id || '—'}</div>
                <div className="event-meta-badges">
                  {event.region && <span className="badge-region">{event.region.toUpperCase()}</span>}
                  {/* 開催形態: 手動 format 優先、なければログ由来の access_type */}
                  {(event.format || event.access_type) && (
                    <span className="badge-access" title={event.format ? `開催形態（手動設定）${event.access_type ? ` / ログ上は ${event.access_type}` : ''}` : 'ログ由来のアクセス種別'}>
                      {event.format || event.access_type}
                    </span>
                  )}
                </div>
              </div>
              <div className="col-actions" onClick={e => e.stopPropagation()}>
                <a href={`#/events/${event.id}/edit`} className="btn-small">✏️ 編集</a>
                <button
                  className="btn-small btn-danger"
                  onClick={() => handleDelete(event.id)}
                >
                  🗑️ 削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ブランド設定ダイアログ */}
      {showBrandDialog && (
        <div className="merge-dialog-overlay" onClick={() => setShowBrandDialog(false)}>
          <div className="merge-dialog" onClick={e => e.stopPropagation()}>
            <h3>🎪 ブランドを設定</h3>
            <p className="merge-dialog-desc">
              選択した {selectedIds.size} 件のイベントにブランド名を設定します。<br />
              ブランドはイベントの分類（clubVERSE / theALL / VERSARY 等）で、ブランド別の比較・統計に使われます。
            </p>

            <div className="merge-field">
              <label>ブランド名（空にすると未分類に戻ります）</label>
              <input
                value={brandInput}
                onChange={e => setBrandInput(e.target.value)}
                placeholder="例：clubVERSE"
                list="brand-dialog-suggestions"
                className="search-input"
                style={{ width: '100%' }}
              />
              <datalist id="brand-dialog-suggestions">
                {allBrands.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>

            <div className="merge-dialog-actions">
              <button className="btn" onClick={() => setShowBrandDialog(false)}>
                キャンセル
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSetBrand}
                disabled={settingBrand}
              >
                {settingBrand ? '設定中...' : brandInput.trim() ? `「${brandInput.trim()}」に設定` : '未分類に戻す'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 結合ダイアログ */}
      {showMergeDialog && (
        <div className="merge-dialog-overlay" onClick={() => setShowMergeDialog(false)}>
          <div className="merge-dialog" onClick={e => e.stopPropagation()}>
            <h3>🔗 イベントを結合</h3>
            <p className="merge-dialog-desc">
              選択した {selectedIds.size} 件のイベントを1つに結合します。<br />
              「ベースにするイベント」にすべての参加者データが統合されます。他のイベントは削除されます。
            </p>

            <div className="merge-field">
              <label>ベースにするイベント（残すイベント）</label>
              <select
                value={mergeTargetId ?? ''}
                onChange={e => setMergeTargetId(Number(e.target.value))}
                className="sort-select"
                style={{ width: '100%' }}
              >
                {selectedEvents.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.name} — {e.date}{e.start_time ? ` ${e.start_time}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="merge-preview">
              <div className="merge-preview-label">結合されるイベント（削除）：</div>
              {selectedEvents.filter(e => e.id !== mergeTargetId).map(e => (
                <div key={e.id} className="merge-preview-item">
                  🗑 {e.name} — {e.date}{e.start_time ? ` ${e.start_time}` : ''}
                </div>
              ))}
            </div>

            <div className="merge-dialog-actions">
              <button className="btn" onClick={() => setShowMergeDialog(false)}>
                キャンセル
              </button>
              <button
                className="btn btn-primary"
                onClick={handleMerge}
                disabled={merging || !mergeTargetId}
              >
                {merging ? '結合中...' : '結合する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
