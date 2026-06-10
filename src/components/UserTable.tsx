import { useState, useEffect } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { DataTable } from './DataTable'
import type { User, UserBadge } from '../types/index.js'
import { dataCache } from '../utils/dataCache.js'
import { useSeries } from '../contexts/SeriesContext'
import { BadgeChips, BadgeEditorModal } from './UserBadges'
import '../styles/UserTable.css'

interface UserWithStats extends User {
  badges: UserBadge[]
  attendance_count: number
  total_stay_duration: number
  avg_stay_duration: number
  first_attendance?: string
  last_attendance?: string
}

const col = createColumnHelper<UserWithStats>()

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  return `${hours}h ${mins}m`
}

const userColumns = [
  col.accessor('display_name', {
    header: '名前',
    cell: info => <span className="user-name">{info.getValue()}</span>,
    size: 150,
  }),
  col.accessor('attendance_count', {
    header: '参加回数',
    cell: info => <span className="user-visits">{info.getValue()}</span>,
    size: 80,
  }),
  col.accessor('total_stay_duration', {
    header: '合計滞在',
    cell: info => formatMinutes(info.getValue()),
    size: 100,
  }),
  col.accessor('avg_stay_duration', {
    header: '平均滞在',
    cell: info => formatMinutes(info.getValue()),
    size: 100,
  }),
  col.accessor('first_attendance', {
    header: '初回参加',
    cell: info => {
      const date = info.getValue()
      return date ? new Date(date).toLocaleDateString('ja-JP') : '-'
    },
    size: 110,
  }),
  col.accessor('last_attendance', {
    header: '最終参加',
    cell: info => {
      const date = info.getValue()
      return date ? new Date(date).toLocaleDateString('ja-JP') : '-'
    },
    size: 110,
  }),
  col.accessor('is_staff', {
    header: 'スタッフ',
    cell: info => (info.getValue() ? <span className="badge badge-staff">⭐ Staff</span> : '-'),
    size: 80,
  }),
  col.accessor('is_excluded', {
    header: '分析除外',
    cell: info => (info.getValue()
      ? <span className="badge badge-excluded">🚫 除外中</span>
      : '-'),
    size: 80,
  }),
  col.accessor('tags', {
    header: 'タグ',
    cell: info => {
      const tags = info.getValue() as string[] | undefined
      return (
        <div className="user-tags">
          {tags?.map(tag => (
            <span key={tag} className="tag-badge">{tag}</span>
          ))}
        </div>
      )
    },
    size: 150,
  }),
]

interface UserTableProps {
  onSelectUser?: (user: UserWithStats) => void
}

function daysSince(dateStr: string | undefined): number | null {
  if (!dateStr) return null
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const d = new Date(dateStr)
  d.setHours(0, 0, 0, 0)
  return Math.round((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
}

export function UserTable({ onSelectUser }: UserTableProps) {
  const [users, setUsers] = useState<UserWithStats[]>([])
  const [allUsers, setAllUsers] = useState<UserWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [tagFilter, setTagFilter] = useState<string>('')
  const [staffFilter, setStaffFilter] = useState<'all' | 'staff' | 'non-staff'>('all')
  const [excludedFilter, setExcludedFilter] = useState<'all' | 'excluded' | 'not-excluded'>('all')
  const [updating, setUpdating] = useState(false)
  const [bulkTagInput, setBulkTagInput] = useState('')
  // バッジフィルタ: 出演者系/関係者/要注意/バッジなし
  const [badgeFilter, setBadgeFilter] = useState<'all' | 'performers' | 'related' | 'watch' | 'none'>('all')
  // バッジ編集モーダルの対象ユーザー
  const [editingUser, setEditingUser] = useState<UserWithStats | null>(null)

  // 詳細フィルター
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [firstDaysMin, setFirstDaysMin] = useState('')
  const [firstDaysMax, setFirstDaysMax] = useState('')
  const [lastDaysMin, setLastDaysMin] = useState('')
  const [lastDaysMax, setLastDaysMax] = useState('')
  const [countMin, setCountMin] = useState('')
  const [countMax, setCountMax] = useState('')
  const [stayMinHours, setStayMinHours] = useState('')
  const [stayMaxHours, setStayMaxHours] = useState('')

  const hasAdvancedFilters = !!(
    periodStart || periodEnd ||
    firstDaysMin || firstDaysMax ||
    lastDaysMin || lastDaysMax ||
    countMin || countMax ||
    stayMinHours || stayMaxHours
  )

  const resetAdvancedFilters = () => {
    setPeriodStart(''); setPeriodEnd('')
    setFirstDaysMin(''); setFirstDaysMax('')
    setLastDaysMin(''); setLastDaysMax('')
    setCountMin(''); setCountMax('')
    setStayMinHours(''); setStayMaxHours('')
  }

  const { series } = useSeries()

  const loadUsers = async (from?: string, to?: string, force = false) => {
    // series 指定時は参加回数・滞在時間などの統計がそのシリーズ内だけで再計算される
    const cacheKey = `users:${series}:${from ?? ''}:${to ?? ''}`
    const cached = dataCache.get<UserWithStats[]>(cacheKey)
    if (cached && !force) {
      setAllUsers(cached)
      setUsers(cached)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (series) params.set('series', series)
      const url = `/api/users${params.toString() ? '?' + params.toString() : ''}`
      const res = await fetch(url)
      const data = await res.json()
      if (data.success) {
        dataCache.set(cacheKey, data.data)
        setAllUsers(data.data)
        setUsers(data.data)
      } else {
        setError(data.error ?? 'Failed to load users')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const refresh = () => {
    dataCache.deletePrefix('users')
    loadUsers(periodStart || undefined, periodEnd || undefined, true)
  }

  // 期間・シリーズが変わったらサーバーから再取得（統計値も絞り込み内で再計算）
  useEffect(() => {
    loadUsers(periodStart || undefined, periodEnd || undefined)
  }, [periodStart, periodEnd, series])

  useEffect(() => {
    let filtered = allUsers

    // 基本フィルター
    if (staffFilter === 'staff') filtered = filtered.filter(u => u.is_staff)
    else if (staffFilter === 'non-staff') filtered = filtered.filter(u => !u.is_staff)

    if (excludedFilter === 'excluded') filtered = filtered.filter(u => u.is_excluded)
    else if (excludedFilter === 'not-excluded') filtered = filtered.filter(u => !u.is_excluded)

    if (tagFilter) filtered = filtered.filter(u => u.tags?.includes(tagFilter))

    // バッジフィルタ
    if (badgeFilter === 'performers') {
      filtered = filtered.filter(u => u.badges?.some(b => ['regular', 'visitor', 'performer'].includes(b.badge_type)))
    } else if (badgeFilter === 'related') {
      filtered = filtered.filter(u => u.badges?.some(b => ['manager', 'staff'].includes(b.badge_type)))
    } else if (badgeFilter === 'watch') {
      filtered = filtered.filter(u => u.badges?.some(b => b.badge_type === 'watch'))
    } else if (badgeFilter === 'none') {
      filtered = filtered.filter(u => !u.badges || u.badges.length === 0)
    }

    // 初参加から何日
    if (firstDaysMin || firstDaysMax) {
      filtered = filtered.filter(u => {
        const days = daysSince(u.first_attendance)
        if (days === null) return false
        if (firstDaysMin && days < parseInt(firstDaysMin)) return false
        if (firstDaysMax && days > parseInt(firstDaysMax)) return false
        return true
      })
    }

    // 最終参加から何日
    if (lastDaysMin || lastDaysMax) {
      filtered = filtered.filter(u => {
        const days = daysSince(u.last_attendance)
        if (days === null) return false
        if (lastDaysMin && days < parseInt(lastDaysMin)) return false
        if (lastDaysMax && days > parseInt(lastDaysMax)) return false
        return true
      })
    }

    // 参加回数
    if (countMin || countMax) {
      filtered = filtered.filter(u => {
        if (countMin && u.attendance_count < parseInt(countMin)) return false
        if (countMax && u.attendance_count > parseInt(countMax)) return false
        return true
      })
    }

    // 滞在時間（時間単位）
    if (stayMinHours || stayMaxHours) {
      filtered = filtered.filter(u => {
        const hours = u.total_stay_duration / 60
        if (stayMinHours && hours < parseFloat(stayMinHours)) return false
        if (stayMaxHours && hours > parseFloat(stayMaxHours)) return false
        return true
      })
    }

    setUsers(filtered)
  }, [
    allUsers, tagFilter, staffFilter, excludedFilter, badgeFilter,
    firstDaysMin, firstDaysMax,
    lastDaysMin, lastDaysMax,
    countMin, countMax,
    stayMinHours, stayMaxHours,
  ])

  const allTags = Array.from(new Set(allUsers.flatMap(u => u.tags || [])))

  // データの日付範囲（カレンダーの min/max に使う）
  const dateRange = (() => {
    const dates = allUsers
      .flatMap(u => [u.first_attendance, u.last_attendance])
      .filter((d): d is string => !!d)
      .map(d => d.slice(0, 10))
      .sort()
    return { min: dates[0] ?? '', max: dates[dates.length - 1] ?? '' }
  })()

  const toggleSelect = (userId: number) => {
    const s = new Set(selected)
    if (s.has(userId)) s.delete(userId)
    else s.add(userId)
    setSelected(s)
  }

  const toggleSelectAll = () => {
    if (selected.size === users.length) setSelected(new Set())
    else setSelected(new Set(users.map(u => u.id)))
  }

  const bulkUpdate = async (field: 'is_staff' | 'is_excluded', value: boolean) => {
    if (selected.size === 0) return
    setUpdating(true)
    try {
      const selectedUsers = users.filter(u => selected.has(u.id))
      await Promise.all(selectedUsers.map(user =>
        fetch(`/api/users/${encodeURIComponent(user.display_name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: value }),
        })
      ))
      setSelected(new Set())
      await loadUsers()
    } catch (err: any) {
      setError(String(err))
    } finally {
      setUpdating(false)
    }
  }

  // 一括バッジ付与/解除。対象シリーズはヘッダーで選択中のグローバルシリーズ（全体なら ''）。
  const bulkSetBadge = async (badgeType: 'regular' | 'visitor' | 'performer' | null) => {
    if (selected.size === 0) return
    setUpdating(true)
    try {
      const selectedUsers = users.filter(u => selected.has(u.id))
      if (badgeType === null) {
        // 出演者系（レギュラー/ビジター/出演者）をこのシリーズから一括解除
        await Promise.all(selectedUsers.flatMap(user =>
          (['regular', 'visitor', 'performer'] as const).map(t =>
            fetch(`/api/users/${encodeURIComponent(user.display_name)}/badges`, {
              method: 'DELETE',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ badge_type: t, series }),
            })
          )
        ))
      } else {
        await Promise.all(selectedUsers.map(user =>
          fetch(`/api/users/${encodeURIComponent(user.display_name)}/badges`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ badge_type: badgeType, series }),
          })
        ))
      }
      dataCache.deletePrefix('performers:')
      dataCache.delete('citizenship-alerts')
      setSelected(new Set())
      await loadUsers(periodStart || undefined, periodEnd || undefined, true)
    } catch (err: any) {
      setError(String(err))
    } finally {
      setUpdating(false)
    }
  }

  const bulkAddTag = async () => {
    const tag = bulkTagInput.trim()
    if (!tag || selected.size === 0) return
    setUpdating(true)
    try {
      const selectedUsers = allUsers.filter(u => selected.has(u.id))
      await Promise.all(selectedUsers.map(user => {
        const newTags = Array.from(new Set([...(user.tags ?? []), tag]))
        return fetch(`/api/users/${encodeURIComponent(user.display_name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: newTags }),
        })
      }))
      setBulkTagInput('')
      await loadUsers()
    } catch (err: any) {
      setError(String(err))
    } finally {
      setUpdating(false)
    }
  }

  if (loading) return <div className="user-table-loading">読み込み中...</div>
  if (error) return <div className="user-table-error">{error}</div>

  const columnDefs = [
    col.display({
      id: 'select',
      header: () => (
        <input
          type="checkbox"
          checked={selected.size === users.length && users.length > 0}
          onChange={toggleSelectAll}
          title="全選択"
        />
      ),
      cell: info => (
        <input
          type="checkbox"
          checked={selected.has(info.row.original.id)}
          onClick={e => e.stopPropagation()}
          onChange={() => toggleSelect(info.row.original.id)}
        />
      ),
      size: 40,
    }),
    userColumns[0], // 名前
    // バッジ列（クリックで編集）
    col.display({
      id: 'badges',
      header: 'バッジ',
      cell: info => {
        const u = info.row.original
        return (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); setEditingUser(u) }}
            title="クリックでバッジを編集"
          >
            <BadgeChips badges={u.badges ?? []} small />
            <span style={{ opacity: 0.45, fontSize: 12 }}>{(u.badges?.length ?? 0) === 0 ? '＋付与' : '✏️'}</span>
          </span>
        )
      },
      size: 200,
    }),
    ...userColumns.slice(1),
  ]

  return (
    <div className="user-table-container">
      <div className="user-table-page-header">
        <h2>ユーザー一覧</h2>
        <p className="user-table-desc">
          ログから検出された参加者の一覧です。参加回数・滞在時間を確認できます。
          名前をクリックすると詳細プロフィールが表示されます。<br />
          <strong>分析除外</strong>に設定すると、主催・出演者など統計に含めたくないユーザーを集計から除外できます。
        </p>
      </div>

      {/* フィルタ・アクションバー */}
      <div className="user-table-toolbar">
        <div className="user-table-filters">
          <select value={staffFilter} onChange={e => setStaffFilter(e.target.value as any)} className="filter-select">
            <option value="all">全ユーザー</option>
            <option value="staff">スタッフのみ</option>
            <option value="non-staff">非スタッフ</option>
          </select>

          <select value={excludedFilter} onChange={e => setExcludedFilter(e.target.value as any)} className="filter-select">
            <option value="all">除外状態: 全て</option>
            <option value="excluded">🚫 除外中のみ</option>
            <option value="not-excluded">除外なしのみ</option>
          </select>

          <select value={tagFilter} onChange={e => setTagFilter(e.target.value)} className="filter-select">
            <option value="">全タグ</option>
            {allTags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>

          <select value={badgeFilter} onChange={e => setBadgeFilter(e.target.value as any)} className="filter-select">
            <option value="all">バッジ: 全て</option>
            <option value="performers">🎤 出演者系のみ</option>
            <option value="related">💼 関係者（ﾏﾈ/ｽﾀｯﾌ）</option>
            <option value="watch">⚠️ 要注意のみ</option>
            <option value="none">バッジなし</option>
          </select>

          <button
            className={`advanced-filter-toggle${advancedOpen ? ' active' : ''}${hasAdvancedFilters ? ' has-filters' : ''}`}
            onClick={() => setAdvancedOpen(o => !o)}
          >
            {advancedOpen ? '▲' : '▼'} 詳細フィルター
            {hasAdvancedFilters && <span className="filter-active-dot" />}
          </button>

          {hasAdvancedFilters && (
            <button className="filter-reset-btn" onClick={resetAdvancedFilters}>
              ✕ リセット
            </button>
          )}

          <button className="btn-refresh" onClick={refresh} disabled={loading}>
            ↻ 更新
          </button>
        </div>

        {selected.size > 0 && (
          <div className="user-table-actions">
            <span className="selection-info">{selected.size}人選択中</span>

            <button onClick={() => bulkUpdate('is_excluded', true)} disabled={updating} className="btn btn-sm btn-excluded">
              🚫 分析から除外
            </button>
            <button onClick={() => bulkUpdate('is_excluded', false)} disabled={updating} className="btn btn-sm btn-secondary">
              ✓ 除外を解除
            </button>

            <span className="action-divider">|</span>

            <span style={{ fontSize: 11, opacity: 0.6 }}>対象: {series || '全体'}</span>
            <button onClick={() => bulkSetBadge('regular')} disabled={updating} className="btn btn-sm btn-regular" title={`選択ユーザーに⭐レギュラー（${series || '全体'}）を付与`}>
              ⭐ レギュラー
            </button>
            <button onClick={() => bulkSetBadge('visitor')} disabled={updating} className="btn btn-sm btn-visitor" title={`選択ユーザーに🎟ビジター（${series || '全体'}）を付与`}>
              🎟 ビジター
            </button>
            <button onClick={() => bulkSetBadge('performer')} disabled={updating} className="btn btn-sm btn-secondary" title={`選択ユーザーに🎤出演者（${series || '全体'}）を付与`}>
              🎤 出演者
            </button>
            <button onClick={() => bulkSetBadge(null)} disabled={updating} className="btn btn-sm btn-secondary" title={`選択ユーザーの出演者系バッジ（${series || '全体'}）を解除`}>
              ✗ 出演者解除
            </button>

            <span className="action-divider">|</span>

            <button onClick={() => bulkUpdate('is_staff', true)} disabled={updating} className="btn btn-sm btn-primary">
              ⭐ スタッフに設定
            </button>
            <button onClick={() => bulkUpdate('is_staff', false)} disabled={updating} className="btn btn-sm btn-secondary">
              ✗ スタッフ解除
            </button>

            <span className="action-divider">|</span>

            <div className="bulk-tag-input-row">
              <input
                type="text"
                className="bulk-tag-input"
                placeholder="タグを追加..."
                value={bulkTagInput}
                onChange={e => setBulkTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') bulkAddTag() }}
                disabled={updating}
              />
              <button
                onClick={bulkAddTag}
                disabled={updating || !bulkTagInput.trim()}
                className="btn btn-sm btn-secondary"
              >
                🏷️ タグ付け
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 詳細フィルターパネル */}
      {advancedOpen && (
        <div className="advanced-filters-panel">
          {/* 期間 */}
          <div className="filter-row">
            <span className="filter-row-label">期間</span>
            <div className="filter-row-inputs">
              <input
                type="date"
                className="filter-input"
                value={periodStart}
                min={dateRange.min}
                max={periodEnd || dateRange.max}
                onChange={e => setPeriodStart(e.target.value)}
              />
              <span className="filter-range-sep">〜</span>
              <input
                type="date"
                className="filter-input"
                value={periodEnd}
                min={periodStart || dateRange.min}
                max={dateRange.max}
                onChange={e => setPeriodEnd(e.target.value)}
              />
            </div>
          </div>

          {/* 初参加から何日 */}
          <div className="filter-row">
            <span className="filter-row-label">初参加から</span>
            <div className="filter-row-inputs">
              <input
                type="number"
                className="filter-input filter-input-num"
                placeholder="0"
                min="0"
                value={firstDaysMin}
                onChange={e => setFirstDaysMin(e.target.value)}
              />
              <span className="filter-unit">日以上</span>
              <span className="filter-range-sep">〜</span>
              <input
                type="number"
                className="filter-input filter-input-num"
                placeholder="∞"
                min="0"
                value={firstDaysMax}
                onChange={e => setFirstDaysMax(e.target.value)}
              />
              <span className="filter-unit">日以下</span>
            </div>
          </div>

          {/* 最終参加から何日 */}
          <div className="filter-row">
            <span className="filter-row-label">最終参加から</span>
            <div className="filter-row-inputs">
              <input
                type="number"
                className="filter-input filter-input-num"
                placeholder="0"
                min="0"
                value={lastDaysMin}
                onChange={e => setLastDaysMin(e.target.value)}
              />
              <span className="filter-unit">日以上</span>
              <span className="filter-range-sep">〜</span>
              <input
                type="number"
                className="filter-input filter-input-num"
                placeholder="∞"
                min="0"
                value={lastDaysMax}
                onChange={e => setLastDaysMax(e.target.value)}
              />
              <span className="filter-unit">日以下</span>
            </div>
          </div>

          {/* 参加回数 */}
          <div className="filter-row">
            <span className="filter-row-label">参加回数</span>
            <div className="filter-row-inputs">
              <input
                type="number"
                className="filter-input filter-input-num"
                placeholder="0"
                min="0"
                value={countMin}
                onChange={e => setCountMin(e.target.value)}
              />
              <span className="filter-unit">回以上</span>
              <span className="filter-range-sep">〜</span>
              <input
                type="number"
                className="filter-input filter-input-num"
                placeholder="∞"
                min="0"
                value={countMax}
                onChange={e => setCountMax(e.target.value)}
              />
              <span className="filter-unit">回以下</span>
            </div>
          </div>

          {/* 合計滞在時間 */}
          <div className="filter-row">
            <span className="filter-row-label">合計滞在時間</span>
            <div className="filter-row-inputs">
              <input
                type="number"
                className="filter-input filter-input-num"
                placeholder="0"
                min="0"
                step="0.5"
                value={stayMinHours}
                onChange={e => setStayMinHours(e.target.value)}
              />
              <span className="filter-unit">時間以上</span>
              <span className="filter-range-sep">〜</span>
              <input
                type="number"
                className="filter-input filter-input-num"
                placeholder="∞"
                min="0"
                step="0.5"
                value={stayMaxHours}
                onChange={e => setStayMaxHours(e.target.value)}
              />
              <span className="filter-unit">時間以下</span>
            </div>
          </div>
        </div>
      )}

      <div className="user-table-count">
        {users.length} 人表示中
        {allUsers.length !== users.length && ` / ${allUsers.length} 人中`}
      </div>

      <DataTable
        data={users}
        columns={columnDefs}
        globalFilterPlaceholder="ユーザー名で検索..."
        defaultPageSize={20}
        emptyMessage="ユーザーが見つかりません"
        onRowClick={onSelectUser}
      />

      {/* バッジ編集モーダル */}
      {editingUser && (
        <BadgeEditorModal
          displayName={editingUser.display_name}
          badges={editingUser.badges ?? []}
          onClose={() => setEditingUser(null)}
          onSaved={newBadges => {
            // 一覧とモーダルの両方へ即時反映（サーバー再取得なし）
            setAllUsers(prev => prev.map(u => u.display_name === editingUser.display_name ? { ...u, badges: newBadges } : u))
            setEditingUser(prev => prev ? { ...prev, badges: newBadges } : prev)
          }}
        />
      )}
    </div>
  )
}
