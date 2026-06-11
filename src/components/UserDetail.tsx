import { useState, useEffect, useRef } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { DataTable } from './DataTable'
import type { User, UserBadge } from '../types/index.js'
import { BadgeChips, BadgeEditorModal } from './UserBadges'
import '../styles/UserDetail.css'

// イベント単位の来場記録（1イベント=1行。サーバー側で夜単位に集計済み）
interface UserAttendanceRecord {
  event_id: number
  event_name: string
  event_date: string
  first_join: string
  last_leave: string | null
  stay_duration: number
  entries: number
}

interface UserDetailData {
  user: User
  badges: UserBadge[]
  attendance_records: UserAttendanceRecord[]
}

const col = createColumnHelper<UserAttendanceRecord>()

function fmtTime(iso: string | null): string {
  if (!iso) return '-'
  try { return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) } catch { return '-' }
}

const attendanceColumns = [
  col.accessor('event_date', {
    header: '日付',
    cell: info => new Date(info.getValue()).toLocaleDateString('ja-JP'),
    size: 100,
  }),
  col.accessor('event_name', {
    header: 'イベント',
    cell: info => <span className="event-name-cell">{info.getValue()}</span>,
    size: 200,
  }),
  col.accessor('first_join', {
    header: '入場',
    cell: info => fmtTime(info.getValue()),
    size: 80,
  }),
  col.accessor('last_leave', {
    header: '退場',
    cell: info => <span className={info.getValue() ? '' : 'text-muted'}>{fmtTime(info.getValue())}</span>,
    size: 80,
  }),
  col.accessor('stay_duration', {
    header: '合計滞在',
    cell: info => {
      const mins = info.getValue()
      if (!mins) return '-'
      if (mins < 60) return `${Math.round(mins)}m`
      const h = Math.floor(mins / 60)
      const m = Math.round(mins % 60)
      return `${h}h ${m}m`
    },
    size: 90,
  }),
  col.accessor('entries', {
    header: '入退場',
    cell: info => {
      const n = info.getValue()
      return n > 1 ? <span title="再入場あり">⟳ {n}回</span> : `${n}回`
    },
    size: 70,
  }),
]

interface UserDetailProps {
  displayName: string
  onBack?: () => void
}

export function UserDetail({ displayName, onBack }: UserDetailProps) {
  const [data, setData] = useState<UserDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ノート編集
  const [isEditingNotes, setIsEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [isSavingNotes, setIsSavingNotes] = useState(false)

  // タグ追加
  const [newTag, setNewTag] = useState('')
  const [isSavingTag, setIsSavingTag] = useState(false)
  const tagInputRef = useRef<HTMLInputElement>(null)

  // バッジ編集モーダル
  const [badgeModalOpen, setBadgeModalOpen] = useState(false)

  useEffect(() => {
    loadUser()
  }, [displayName])

  const normalizeUser = (u: any): User => ({
    ...u,
    tags: Array.isArray(u.tags)
      ? u.tags
      : typeof u.tags === 'string'
        ? (() => { try { return JSON.parse(u.tags) } catch { return [] } })()
        : [],
  })

  const loadUser = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(displayName)}`)
      const json = await res.json()
      if (json.success) {
        setData({
          ...json.data,
          user: normalizeUser(json.data.user),
        })
      } else {
        setError(json.error ?? 'Failed to load user details')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user details')
    } finally {
      setLoading(false)
    }
  }

  // 汎用ユーザー更新
  const updateUser = async (updates: Partial<Pick<User, 'is_staff' | 'is_excluded' | 'notes' | 'tags' | 'performer_role'>>) => {
    if (!data?.user.display_name) return false
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(data.user.display_name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      const json = await res.json()
      if (json.success && data) {
        setData({ ...data, user: normalizeUser({ ...data.user, ...updates }) })
        return true
      } else {
        setError(json.error ?? 'Failed to update')
        return false
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update')
      return false
    }
  }

  const handleToggleExcluded = () => updateUser({ is_excluded: !data?.user.is_excluded })

  const handleSaveNotes = async () => {
    setIsSavingNotes(true)
    const ok = await updateUser({ notes: notesDraft })
    if (ok) { setIsEditingNotes(false); setNotesDraft('') }
    setIsSavingNotes(false)
  }

  const handleAddTag = async () => {
    const tag = newTag.trim()
    if (!tag || !data) return
    if (data.user.tags?.includes(tag)) { setNewTag(''); return }
    setIsSavingTag(true)
    const newTags = [...(data.user.tags ?? []), tag]
    const ok = await updateUser({ tags: newTags })
    if (ok) setNewTag('')
    setIsSavingTag(false)
    tagInputRef.current?.focus()
  }

  const handleRemoveTag = async (tag: string) => {
    if (!data) return
    const newTags = (data.user.tags ?? []).filter(t => t !== tag)
    await updateUser({ tags: newTags })
  }

  if (loading) return <div className="user-detail-loading">ユーザー詳細を読み込み中…</div>
  if (error) return <div className="user-detail-error">{error}</div>
  if (!data) return <div className="user-detail-error">ユーザーが見つかりません</div>

  const { user, badges, attendance_records } = data
  const totalAttendance = attendance_records.length
  const totalDuration = attendance_records.reduce((sum, r) => sum + (r.stay_duration || 0), 0)
  const avgDuration = totalAttendance > 0 ? totalDuration / totalAttendance : 0

  return (
    <div className="user-detail-container">
      <div className="user-detail-header">
        {onBack && (
          <button className="btn-back" onClick={onBack}>← 戻る</button>
        )}
        <div className="user-detail-title">
          <h2>{user.display_name}</h2>
          <div className="user-detail-badges">
            <BadgeChips badges={badges} />
            {user.is_staff && <span className="badge badge-staff">⭐ スタッフ(旧)</span>}
            {user.is_excluded && <span className="badge badge-excluded">🚫 分析除外</span>}
            {user.tags?.map(tag => (
              <span key={tag} className="badge badge-tag">{tag}</span>
            ))}
          </div>
        </div>
      </div>

      {/* 統計カード */}
      <div className="user-detail-info-grid">
        <div className="info-card">
          <div className="info-label">ユーザーID</div>
          <div className="info-value mono">{user.user_id || 'N/A'}</div>
        </div>
        <div className="info-card">
          <div className="info-label">総来場回数</div>
          <div className="info-value">{totalAttendance}</div>
        </div>
        <div className="info-card">
          <div className="info-label">総滞在時間</div>
          <div className="info-value">{formatDuration(totalDuration)}</div>
        </div>
        <div className="info-card">
          <div className="info-label">平均滞在時間</div>
          <div className="info-value">{formatDuration(avgDuration)}</div>
        </div>
        <div className="info-card">
          <div className="info-label">初来場日</div>
          <div className="info-value">
            {attendance_records.length > 0
              ? new Date(attendance_records[attendance_records.length - 1].event_date).toLocaleDateString('ja-JP')
              : 'N/A'}
          </div>
        </div>
        <div className="info-card">
          <div className="info-label">最終来場日</div>
          <div className="info-value">
            {attendance_records.length > 0
              ? new Date(attendance_records[0].event_date).toLocaleDateString('ja-JP')
              : 'N/A'}
          </div>
        </div>
      </div>

      {/* ユーザー設定 */}
      <div className="user-detail-settings">
        <h3>ユーザー設定</h3>

        <div className="settings-row">
          {/* バッジ（出演者・関係者・スタッフ・要注意） */}
          <div className="setting-item">
            <div className="setting-label">バッジ</div>
            <div className="setting-desc">出演者（シリーズ別）・マネージャー・スタッフ・要注意</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <BadgeChips badges={badges} />
              <button className="btn btn-sm btn-secondary" onClick={() => setBadgeModalOpen(true)}>
                🏷 バッジ編集
              </button>
            </div>
          </div>

          {/* 分析除外 */}
          <div className="setting-item">
            <div className="setting-label">分析から除外</div>
            <div className="setting-desc">主催・出演者など統計に含めないユーザー</div>
            <button
              className={`toggle-btn ${user.is_excluded ? 'toggle-excluded-on' : 'toggle-off'}`}
              onClick={handleToggleExcluded}
            >
              {user.is_excluded ? '🚫 除外を解除' : '🚫 分析から除外'}
            </button>
          </div>
        </div>

        {/* タグ */}
        <div className="setting-tags">
          <div className="setting-label">タグ</div>
          <div className="tags-editor">
            <div className="tags-list">
              {(user.tags ?? []).length === 0 && (
                <span className="tags-empty">タグなし</span>
              )}
              {(user.tags ?? []).map(tag => (
                <span key={tag} className="tag-pill">
                  {tag}
                  <button
                    className="tag-remove"
                    onClick={() => handleRemoveTag(tag)}
                    title="削除"
                  >✕</button>
                </span>
              ))}
            </div>
            <div className="tag-input-row">
              <input
                ref={tagInputRef}
                type="text"
                className="tag-input"
                placeholder="タグを追加..."
                value={newTag}
                onChange={e => setNewTag(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddTag() }}
                disabled={isSavingTag}
              />
              <button
                className="btn btn-sm btn-primary"
                onClick={handleAddTag}
                disabled={isSavingTag || !newTag.trim()}
              >
                追加
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* メモ */}
      <div className="user-detail-notes">
        <div className="notes-header">
          <h3>メモ・備考</h3>
          {!isEditingNotes && (
            <button className="btn-edit-notes" onClick={() => { setNotesDraft(user.notes || ''); setIsEditingNotes(true) }}>
              ✎ 編集
            </button>
          )}
        </div>
        {isEditingNotes ? (
          <div className="notes-edit-section">
            <textarea
              className="notes-textarea"
              value={notesDraft}
              onChange={e => setNotesDraft(e.target.value)}
              placeholder="このユーザーについてのメモを追加..."
              rows={5}
            />
            <div className="notes-actions">
              <button className="btn btn-sm btn-primary" onClick={handleSaveNotes} disabled={isSavingNotes}>
                {isSavingNotes ? '💾 保存中...' : '💾 保存'}
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => { setIsEditingNotes(false); setNotesDraft('') }} disabled={isSavingNotes}>
                ✕ キャンセル
              </button>
            </div>
          </div>
        ) : (
          <div className="notes-display">
            {user.notes
              ? <p>{user.notes}</p>
              : <p className="text-muted">まだメモはありません。「編集」をクリックしてメモを追加してください。</p>
            }
          </div>
        )}
      </div>

      {/* 来場履歴（イベント別・1イベント=1行） */}
      <div className="user-detail-attendance">
        <h3>来場履歴 <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.6 }}>イベント別（再入場は「入退場」列に集約）</span></h3>
        {attendance_records.length === 0 ? (
          <p className="text-muted">来場記録がありません</p>
        ) : (
          <DataTable
            data={attendance_records}
            columns={attendanceColumns}
            globalFilterPlaceholder="イベントで絞り込み…"
            defaultPageSize={15}
            emptyMessage="イベントが見つかりません"
          />
        )}
      </div>

      {/* バッジ・タグ編集モーダル */}
      {badgeModalOpen && (
        <BadgeEditorModal
          displayName={user.display_name}
          badges={badges}
          tags={user.tags ?? []}
          allTags={user.tags ?? []}
          onClose={() => setBadgeModalOpen(false)}
          onChange={patch => {
            setData(prev => prev ? {
              ...prev,
              badges: patch.badges ?? prev.badges,
              user: patch.tags ? { ...prev.user, tags: patch.tags } : prev.user,
            } : prev)
          }}
        />
      )}
    </div>
  )
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  return `${hours}h ${mins}m`
}
