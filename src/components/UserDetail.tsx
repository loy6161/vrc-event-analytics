import { useState, useEffect, useRef } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { DataTable } from './DataTable'
import type { User } from '../types/index.js'
import '../styles/UserDetail.css'

interface UserAttendanceRecord {
  event_id: number
  event_name: string
  event_date: string
  join_time: string
  leave_time: string | null
  stay_duration: number | null
}

interface UserDetailData {
  user: User
  attendance_records: UserAttendanceRecord[]
}

const col = createColumnHelper<UserAttendanceRecord>()

const attendanceColumns = [
  col.accessor('event_date', {
    header: '日付',
    cell: info => new Date(info.getValue()).toLocaleDateString('ja-JP'),
    size: 100,
  }),
  col.accessor('event_name', {
    header: 'イベント',
    cell: info => <span className="event-name-cell">{info.getValue()}</span>,
    size: 180,
  }),
  col.accessor('join_time', {
    header: '入場',
    cell: info => new Date(info.getValue()).toLocaleTimeString('ja-JP'),
    size: 100,
  }),
  col.accessor('leave_time', {
    header: '退場',
    cell: info => {
      const time = info.getValue()
      return time ? new Date(time).toLocaleTimeString('ja-JP') : <span className="text-muted">-</span>
    },
    size: 100,
  }),
  col.accessor('stay_duration', {
    header: '滞在時間',
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

  const handleToggleStaff = () => updateUser({ is_staff: !data?.user.is_staff })
  const handleToggleExcluded = () => updateUser({ is_excluded: !data?.user.is_excluded })
  const handleSetRole = (role: 'regular' | 'visitor' | null) => updateUser({ performer_role: role })

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

  const { user, attendance_records } = data
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
            {user.performer_role === 'regular' && <span className="badge badge-regular">🎤 レギュラー</span>}
            {user.performer_role === 'visitor' && <span className="badge badge-visitor">🌟 ビジター</span>}
            {user.is_staff && <span className="badge badge-staff">⭐ スタッフ</span>}
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
          {/* 出演者ロール */}
          <div className="setting-item">
            <div className="setting-label">出演者ロール</div>
            <div className="setting-desc">出演者一覧に表示されます</div>
            <div className="role-buttons">
              <button
                className={`toggle-btn ${user.performer_role === 'regular' ? 'toggle-regular-on' : 'toggle-off'}`}
                onClick={() => handleSetRole(user.performer_role === 'regular' ? null : 'regular')}
              >
                🎤 レギュラー
              </button>
              <button
                className={`toggle-btn ${user.performer_role === 'visitor' ? 'toggle-visitor-on' : 'toggle-off'}`}
                onClick={() => handleSetRole(user.performer_role === 'visitor' ? null : 'visitor')}
              >
                🌟 ビジター
              </button>
            </div>
          </div>

          {/* スタッフ */}
          <div className="setting-item">
            <div className="setting-label">スタッフ</div>
            <div className="setting-desc">スタッフとしてマーク</div>
            <button
              className={`toggle-btn ${user.is_staff ? 'toggle-on' : 'toggle-off'}`}
              onClick={handleToggleStaff}
            >
              {user.is_staff ? '⭐ スタッフ解除' : '⭐ スタッフに設定'}
            </button>
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

      {/* 来場履歴 */}
      <div className="user-detail-attendance">
        <h3>来場履歴</h3>
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
    </div>
  )
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  return `${hours}h ${mins}m`
}
