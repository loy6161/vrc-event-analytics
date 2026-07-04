import { useState, useEffect, useMemo } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { DataTable } from './DataTable'
import { PlayerEvent } from '../types/index.js'
import type { AvatarUser } from './EventAnalyticsPanel'
import '../styles/PlayerEventTable.css'

// ──────────────────────────────────────────────────────────────────
// Per-player aggregated row
// ──────────────────────────────────────────────────────────────────

interface PlayerStatsRow {
  key: string
  userId?: string
  displayName: string
  hasUserId: boolean
  visitCount: number
  totalStayMinutes: number
  avgStayMinutes: number
  firstJoin: string
  lastJoin: string
  // avatar fields (joined from /api/events/:id/avatars by display_name)
  currentAvatar?: string
  currentAuthor?: string
  avatarSwitchCount?: number
  avatarShortSwitchCount?: number
}

function aggregatePlayerStats(events: PlayerEvent[], avatars: AvatarUser[] = []): PlayerStatsRow[] {
  const avatarMap = new Map<string, AvatarUser>()
  for (const a of avatars) avatarMap.set(a.display_name, a)

  const sorted = [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))

  const map = new Map<string, {
    userId?: string
    displayName: string
    joinTimes: string[]
    stays: number[]
    pendingJoin: string | null
  }>()

  for (const ev of sorted) {
    const key = ev.user_id ?? ev.display_name
    if (!map.has(key)) {
      map.set(key, {
        userId: ev.user_id,
        displayName: ev.display_name,
        joinTimes: [],
        stays: [],
        pendingJoin: null,
      })
    }
    const s = map.get(key)!

    if (ev.event_type === 'join') {
      s.joinTimes.push(ev.timestamp)
      s.pendingJoin = ev.timestamp
    } else if (ev.event_type === 'leave' && s.pendingJoin) {
      const ms = new Date(ev.timestamp).getTime() - new Date(s.pendingJoin).getTime()
      s.stays.push(ms / 60_000)
      s.pendingJoin = null
    }
  }

  return Array.from(map.entries()).map(([key, s]) => {
    const total = s.stays.reduce((a, b) => a + b, 0)
    const av = avatarMap.get(s.displayName)
    return {
      key,
      userId: s.userId,
      displayName: s.displayName,
      hasUserId: !!s.userId,
      visitCount: s.joinTimes.length,
      totalStayMinutes: Math.round(total),
      avgStayMinutes: s.stays.length > 0 ? Math.round(total / s.stays.length) : 0,
      firstJoin: s.joinTimes[0] ?? '',
      lastJoin: s.joinTimes[s.joinTimes.length - 1] ?? '',
      currentAvatar: av?.current_avatar,
      currentAuthor: av?.current_author,
      avatarSwitchCount: av?.switch_count,
      avatarShortSwitchCount: av?.short_switch_count,
    }
  })
}

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function fmtTimestamp(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    })
  } catch {
    return iso
  }
}

function fmtDuration(minutes: number): string {
  if (minutes <= 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

// ──────────────────────────────────────────────────────────────────
// Column definitions
// ──────────────────────────────────────────────────────────────────

const rawColHelper = createColumnHelper<PlayerEvent>()
const rawColumns = [
  rawColHelper.accessor('timestamp', {
    header: 'タイムスタンプ',
    cell: info => fmtTimestamp(info.getValue()),
    size: 180,
  }),
  rawColHelper.accessor('event_type', {
    header: 'タイプ',
    cell: info => (
      <span className={`event-badge event-badge--${info.getValue()}`}>
        {info.getValue() === 'join' ? '▶ 入場' : '◀ 退場'}
      </span>
    ),
    size: 90,
  }),
  rawColHelper.accessor('display_name', {
    header: '表示名',
    cell: info => info.getValue(),
  }),
  rawColHelper.accessor('user_id', {
    header: 'ユーザーID',
    cell: info => {
      const v = info.getValue()
      return v ? <span className="user-id-cell" title={v}>{v}</span> : <span className="na-cell">—</span>
    },
    size: 260,
  }),
  rawColHelper.accessor('log_file', {
    header: 'ログファイル',
    cell: info => {
      const v = info.getValue()
      return v ? <span className="log-file-cell" title={v}>{v.split(/[\\/]/).pop()}</span> : <span className="na-cell">—</span>
    },
    size: 200,
  }),
]

const statsColHelper = createColumnHelper<PlayerStatsRow>()
const statsColumns = [
  statsColHelper.accessor('displayName', {
    header: '表示名',
    cell: info => (
      <span className="display-name-cell">
        {!info.row.original.hasUserId && (
          <span className="no-id-badge" title="VRChatIDが取得されていません">?</span>
        )}
        {info.getValue()}
      </span>
    ),
  }),
  statsColHelper.accessor('userId', {
    header: 'ユーザーID',
    cell: info => {
      const v = info.getValue()
      return v ? <span className="user-id-cell" title={v}>{v}</span> : <span className="na-cell">—</span>
    },
    size: 240,
  }),
  statsColHelper.accessor('visitCount', {
    header: '来場回数',
    cell: info => info.getValue(),
    size: 80,
  }),
  statsColHelper.accessor('totalStayMinutes', {
    header: '総滞在',
    cell: info => fmtDuration(info.getValue()),
    size: 100,
  }),
  statsColHelper.accessor('avgStayMinutes', {
    header: '平均滞在',
    cell: info => fmtDuration(info.getValue()),
    size: 100,
  }),
  statsColHelper.accessor('currentAvatar', {
    header: 'アバター',
    cell: info => {
      const v = info.getValue()
      const author = info.row.original.currentAuthor
      if (!v) return <span className="na-cell">—</span>
      return (
        <div className="avatar-cell" title={author ? `${v} (by ${author})` : v}>
          <div className="avatar-name">{v}</div>
          {author && <div className="avatar-author">by {author}</div>}
        </div>
      )
    },
    size: 220,
  }),
  statsColHelper.accessor('avatarSwitchCount', {
    header: '切替',
    cell: info => {
      const v = info.getValue()
      if (!v || v === 0) return <span className="na-cell">—</span>
      return v
    },
    size: 60,
  }),
  statsColHelper.accessor('avatarShortSwitchCount', {
    header: '短時間切替',
    cell: info => {
      const v = info.getValue() ?? 0
      if (v === 0) return <span className="na-cell">—</span>
      const sus = v >= 3
      return (
        <span
          className={sus ? 'av-sus-cell' : ''}
          title={sus ? '60秒以内の連続切替が多い（クラッシャー等の可能性）' : '60秒以内の連続切替回数'}
        >
          {v}{sus ? ' ⚠️' : ''}
        </span>
      )
    },
    size: 100,
  }),
  statsColHelper.accessor('firstJoin', {
    header: '初回入場',
    cell: info => fmtTimestamp(info.getValue()),
    size: 160,
  }),
  statsColHelper.accessor('lastJoin', {
    header: '最終入場',
    cell: info => fmtTimestamp(info.getValue()),
    size: 160,
  }),
]

// ──────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────

type ViewMode = 'players' | 'raw'

interface PlayerEventTableProps {
  eventId: number
  avatars?: AvatarUser[]
}

export function PlayerEventTable({ eventId, avatars = [] }: PlayerEventTableProps) {
  const [events, setEvents] = useState<PlayerEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('players')

  useEffect(() => {
    setLoading(true)
    setError(null)

    fetch(`/api/events/${eventId}/player-events`)
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setEvents(data.data)
        } else {
          setError(data.error ?? 'プレイヤーイベントの読み込みに失敗しました')
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [eventId])

  const playerStats = useMemo(() => aggregatePlayerStats(events, avatars), [events, avatars])

  if (loading) {
    return (
      <div className="player-event-table">
        <div className="pet-loading">プレイヤーイベントを読み込み中…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="player-event-table">
        <div className="pet-error">{error}</div>
      </div>
    )
  }

  const tabBar = (
    <div className="pet-tabs">
      <button
        className={`pet-tab${view === 'players' ? ' active' : ''}`}
        onClick={() => setView('players')}
      >
        👤 ユーザー別 ({playerStats.length})
      </button>
      <button
        className={`pet-tab${view === 'raw' ? ' active' : ''}`}
        onClick={() => setView('raw')}
      >
        📋 生ログイベント ({events.length})
      </button>
    </div>
  )

  if (view === 'raw') {
    return (
      <div className="player-event-table">
        <DataTable
          data={events}
          columns={rawColumns}
          globalFilterPlaceholder="名前、タイプ、IDで検索…"
          defaultPageSize={20}
          toolbarLeft={tabBar}
          emptyMessage="プレイヤーイベントはまだ記録されていません"
        />
      </div>
    )
  }

  return (
    <div className="player-event-table">
      <DataTable
        data={playerStats}
        columns={statsColumns}
        globalFilterPlaceholder="名前またはIDで検索…"
        defaultPageSize={20}
        toolbarLeft={tabBar}
        emptyMessage="プレイヤーデータはまだ記録されていません"
      />
    </div>
  )
}
