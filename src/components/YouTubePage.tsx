import { useState, useEffect, useCallback } from 'react'
import { DataTable } from './DataTable'
import { ViewerTimelineChart, ChatActivityChart, TopChattersChart } from './charts/YouTubeChatTimeline'
import type {
  YouTubeStream, YouTubeChatStats, YouTubeChatUser, YouTubeChatMessage,
  YouTubeConcurrentLog, Event,
} from '../types/index.js'
import { createColumnHelper } from '@tanstack/react-table'
import '../styles/YouTubePage.css'

const API = '/api'

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function formatDate(s?: string) {
  if (!s) return '-'
  return new Date(s).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatNumber(n?: number) {
  if (n == null) return '-'
  return n.toLocaleString()
}

function formatJPY(n?: number) {
  if (n == null || n === 0) return '-'
  return `¥${n.toLocaleString()}`
}

function formatDuration(startStr?: string, endStr?: string) {
  if (!startStr || !endStr) return '-'
  const ms = new Date(endStr).getTime() - new Date(startStr).getTime()
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  return `${hours}h ${minutes}m`
}

// ──────────────────────────────────────────────
// YouTubePage
// ──────────────────────────────────────────────

export function YouTubePage() {
  const [streams, setStreams] = useState<YouTubeStream[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [selectedStream, setSelectedStream] = useState<YouTubeStream | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [apiInitialized, setApiInitialized] = useState(false)

  // Add stream form
  const [videoUrl, setVideoUrl] = useState('')
  const [linkEventId, setLinkEventId] = useState('')
  const [adding, setAdding] = useState(false)

  // Load API key from localStorage and initialize
  useEffect(() => {
    const settings = localStorage.getItem('vrc-analytics-settings')
    if (settings) {
      try {
        const parsed = JSON.parse(settings)
        if (parsed.youtubeApiKey) {
          initApi(parsed.youtubeApiKey)
        }
      } catch { /* ignore */ }
    }
    fetchStreams()
    fetchEvents()
  }, [])

  const initApi = async (key: string) => {
    try {
      const res = await fetch(`${API}/youtube/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key }),
      })
      const data = await res.json()
      if (data.success) setApiInitialized(true)
    } catch { /* ignore */ }
  }

  const fetchStreams = async () => {
    try {
      setLoading(true)
      const res = await fetch(`${API}/youtube/streams`)
      const data = await res.json()
      if (data.success) setStreams(data.data)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const fetchEvents = async () => {
    try {
      const res = await fetch(`${API}/events`)
      const data = await res.json()
      if (data.success) setEvents(data.data)
    } catch { /* ignore */ }
  }

  const addStream = async () => {
    if (!videoUrl.trim()) return
    setAdding(true)
    setError(null)
    try {
      const body: any = { videoUrl: videoUrl.trim() }
      if (linkEventId) body.eventId = parseInt(linkEventId, 10)

      const res = await fetch(`${API}/youtube/streams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        setVideoUrl('')
        setLinkEventId('')
        await fetchStreams()
        setSelectedStream(data.data.stream)
      } else {
        setError(data.error)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  const deleteStream = async (id: number) => {
    if (!confirm('このストリームと関連するすべてのチャットデータを削除しますか？')) return
    try {
      await fetch(`${API}/youtube/streams/${id}`, { method: 'DELETE' })
      if (selectedStream?.id === id) setSelectedStream(null)
      await fetchStreams()
    } catch (err: any) {
      setError(err.message)
    }
  }

  if (!apiInitialized && streams.length === 0) {
    return (
      <div className="youtube-page">
        <div className="youtube-page-header">
          <h1>YouTube統合</h1>
        </div>
        <div className="yt-api-warning">
          <span>YouTube APIキーが設定されていません。</span>
          <a href="#/settings">設定</a>
          <span>に進んでAPIキーを設定してください。</span>
        </div>
      </div>
    )
  }

  return (
    <div className="youtube-page">
      <div className="youtube-page-header">
        <h1>YouTube統合</h1>
        <div className="yt-add-form">
          <input
            type="text"
            placeholder="YouTube URLまたはビデオID..."
            value={videoUrl}
            onChange={e => setVideoUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addStream()}
          />
          <select value={linkEventId} onChange={e => setLinkEventId(e.target.value)}>
            <option value="">イベントにリンク（オプション）</option>
            {events.map(ev => (
              <option key={ev.id} value={ev.id}>
                {ev.date} - {ev.name}
              </option>
            ))}
          </select>
          <button className="btn-yt" onClick={addStream} disabled={adding || !videoUrl.trim()}>
            {adding ? '追加中...' : 'ストリームを追加'}
          </button>
        </div>
      </div>

      {error && <div className="yt-error">{error}</div>}

      {loading ? (
        <div className="yt-loading">ストリームを読み込み中...</div>
      ) : streams.length === 0 ? (
        <div className="yt-empty">
          まだストリームが登録されていません。上にYouTube URLを貼り付けて開始してください。
        </div>
      ) : (
        <div className="yt-stream-list">
          {streams.map(stream => (
            <div
              key={stream.id}
              className={`yt-stream-card ${selectedStream?.id === stream.id ? 'selected' : ''}`}
              onClick={() => setSelectedStream(stream)}
            >
              <div className="yt-stream-thumb">▶</div>
              <div className="yt-stream-info">
                <h3 className="yt-stream-title">{stream.title || stream.video_id}</h3>
                <div className="yt-stream-meta">
                  <span>{stream.channel_title || '不明なチャンネル'}</span>
                  <span>{formatDate(stream.actual_start || stream.scheduled_start)}</span>
                  {stream.peak_concurrent_viewers != null && (
                    <span>ピーク: {formatNumber(stream.peak_concurrent_viewers)}</span>
                  )}
                  {stream.total_view_count != null && (
                    <span>視聴数: {formatNumber(stream.total_view_count)}</span>
                  )}
                  {stream.event_id && (
                    <span>イベント #{stream.event_id}</span>
                  )}
                </div>
              </div>
              <div className="yt-stream-actions" onClick={e => e.stopPropagation()}>
                <button className="btn-danger" onClick={() => deleteStream(stream.id)}>
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedStream && (
        <StreamDetailPanel
          stream={selectedStream}
          onRefresh={async () => {
            await fetchStreams()
            // Re-select updated stream
            const res = await fetch(`${API}/youtube/streams/${selectedStream.id}`)
            const data = await res.json()
            if (data.success) setSelectedStream(data.data)
          }}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────
// Stream Detail Panel
// ──────────────────────────────────────────────

interface StreamDetailProps {
  stream: YouTubeStream
  onRefresh: () => Promise<void>
}

type DetailTab = 'overview' | 'charts' | 'chatters' | 'super-chats'

function StreamDetailPanel({ stream, onRefresh }: StreamDetailProps) {
  const [tab, setTab] = useState<DetailTab>('overview')
  const [chatStats, setChatStats] = useState<YouTubeChatStats | null>(null)
  const [chatUsers, setChatUsers] = useState<YouTubeChatUser[]>([])
  const [chatMessages, setChatMessages] = useState<YouTubeChatMessage[]>([])
  const [concurrentLog, setConcurrentLog] = useState<YouTubeConcurrentLog[]>([])
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    const id = stream.id
    try {
      const [statsRes, usersRes, msgsRes, logRes] = await Promise.all([
        fetch(`${API}/youtube/streams/${id}/chat-stats`).then(r => r.json()).catch(() => null),
        fetch(`${API}/youtube/streams/${id}/chat-users`).then(r => r.json()).catch(() => null),
        fetch(`${API}/youtube/streams/${id}/chat-messages?limit=5000`).then(r => r.json()).catch(() => null),
        fetch(`${API}/youtube/streams/${id}/concurrent-log`).then(r => r.json()).catch(() => null),
      ])

      if (statsRes?.success) setChatStats(statsRes.data)
      if (usersRes?.success) setChatUsers(usersRes.data)
      if (msgsRes?.success) setChatMessages(msgsRes.data)
      if (logRes?.success) setConcurrentLog(logRes.data)
    } catch { /* ignore */ }
  }, [stream.id])

  useEffect(() => {
    setChatStats(null)
    setChatUsers([])
    setChatMessages([])
    setConcurrentLog([])
    setTab('overview')
    setError(null)
    loadData()
  }, [stream.id, loadData])

  const fetchChat = async () => {
    setFetching(true)
    setError(null)
    try {
      const res = await fetch(`${API}/youtube/streams/${stream.id}/fetch-chat`, {
        method: 'POST',
      })
      const data = await res.json()
      if (data.success) {
        await loadData()
        await onRefresh()
      } else {
        setError(data.error)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setFetching(false)
    }
  }

  const refreshMetadata = async () => {
    try {
      const res = await fetch(`${API}/youtube/streams/${stream.id}/refresh`, {
        method: 'PUT',
      })
      const data = await res.json()
      if (data.success) {
        await onRefresh()
      } else {
        setError(data.error)
      }
    } catch (err: any) {
      setError(err.message)
    }
  }

  const superChatMessages = chatMessages.filter(
    m => m.message_type === 'superChat' || m.message_type === 'superSticker'
  )

  return (
    <div className="yt-detail-panel">
      <div className="yt-detail-header">
        <div>
          <h2 className="yt-detail-title">{stream.title || stream.video_id}</h2>
          <div className="yt-detail-channel">
            {stream.channel_title} | {formatDate(stream.actual_start)} |{' '}
            Duration: {formatDuration(stream.actual_start, stream.actual_end)}
          </div>
        </div>
        <div className="yt-detail-actions">
          <button onClick={refreshMetadata}>Refresh Metadata</button>
          <a
            className="export-btn"
            href={`${API}/export/youtube/streams/${stream.id}/xlsx`}
            download
            title="Download Excel report"
          >
            📥 XLSX
          </a>
          {chatStats && (
            <a
              className="export-btn"
              href={`${API}/export/youtube/streams/${stream.id}/csv/chat-users`}
              download
              title="Download chat users CSV"
            >
              📄 CSV
            </a>
          )}
          <button
            className="btn-yt"
            onClick={fetchChat}
            disabled={fetching}
          >
            {fetching ? 'Fetching Chat...' : chatStats ? 'Re-fetch Chat' : 'Fetch Chat Data'}
          </button>
        </div>
      </div>

      {error && <div className="yt-error" style={{ margin: '0 24px' }}>{error}</div>}

      {/* Stream Stats */}
      <div className="yt-stats-grid">
        <div className="yt-stat-card">
          <div className="yt-stat-label">Peak Viewers</div>
          <div className="yt-stat-value red">{formatNumber(stream.peak_concurrent_viewers)}</div>
        </div>
        <div className="yt-stat-card">
          <div className="yt-stat-label">Total Views</div>
          <div className="yt-stat-value blue">{formatNumber(stream.total_view_count)}</div>
        </div>
        <div className="yt-stat-card">
          <div className="yt-stat-label">Likes</div>
          <div className="yt-stat-value green">{formatNumber(stream.like_count)}</div>
        </div>
        <div className="yt-stat-card">
          <div className="yt-stat-label">Comments</div>
          <div className="yt-stat-value orange">{formatNumber(stream.comment_count)}</div>
        </div>
      </div>

      {/* Chat Stats (if available) */}
      {chatStats && (
        <div className="yt-stats-grid">
          <div className="yt-stat-card">
            <div className="yt-stat-label">Chat Messages</div>
            <div className="yt-stat-value">{formatNumber(chatStats.total_messages)}</div>
          </div>
          <div className="yt-stat-card">
            <div className="yt-stat-label">Unique Chatters</div>
            <div className="yt-stat-value">{formatNumber(chatStats.unique_chatters)}</div>
          </div>
          <div className="yt-stat-card">
            <div className="yt-stat-label">Super Chat Total</div>
            <div className="yt-stat-value orange">{formatJPY(chatStats.super_chat_total_jpy)}</div>
            <div className="yt-stat-sub">{chatStats.super_chat_count} Super Chats</div>
          </div>
          <div className="yt-stat-card">
            <div className="yt-stat-label">Chat Rate</div>
            <div className="yt-stat-value">{chatStats.avg_chat_per_minute}</div>
            <div className="yt-stat-sub">avg/min (peak: {chatStats.peak_chat_per_minute}/min)</div>
          </div>
          <div className="yt-stat-card">
            <div className="yt-stat-label">Memberships</div>
            <div className="yt-stat-value green">{formatNumber(chatStats.membership_count)}</div>
          </div>
          <div className="yt-stat-card">
            <div className="yt-stat-label">Gift Members</div>
            <div className="yt-stat-value green">{formatNumber(chatStats.member_gift_total)}</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="yt-tabs">
        {(['overview', 'charts', 'chatters', 'super-chats'] as DetailTab[]).map(t => (
          <button
            key={t}
            className={`yt-tab ${tab === t ? 'active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'overview' ? 'Overview' :
             t === 'charts' ? 'Charts' :
             t === 'chatters' ? 'Chatters' :
             'Super Chats'}
          </button>
        ))}
      </div>

      <div className="yt-tab-body">
        {tab === 'overview' && (
          <OverviewTab stream={stream} chatStats={chatStats} />
        )}
        {tab === 'charts' && (
          <ChartsTab
            concurrentLog={concurrentLog}
            chatMessages={chatMessages}
            chatUsers={chatUsers}
          />
        )}
        {tab === 'chatters' && (
          <ChattersTab users={chatUsers} />
        )}
        {tab === 'super-chats' && (
          <SuperChatsTab
            messages={superChatMessages}
            chatStats={chatStats}
          />
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// Tab Components
// ──────────────────────────────────────────────

function OverviewTab({ stream, chatStats }: { stream: YouTubeStream; chatStats: YouTubeChatStats | null }) {
  return (
    <div className="overview-tab">
      <h4 className="section-subtitle">Stream Info</h4>
      <div className="stats-grid stats-grid--secondary">
        <div className="stat-card">
          <div className="stat-label">Video ID</div>
          <div className="stat-value" style={{ fontSize: 14 }}>{stream.video_id}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Channel</div>
          <div className="stat-value" style={{ fontSize: 14 }}>{stream.channel_title || '-'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Scheduled Start</div>
          <div className="stat-value" style={{ fontSize: 14 }}>{formatDate(stream.scheduled_start)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Actual Start</div>
          <div className="stat-value" style={{ fontSize: 14 }}>{formatDate(stream.actual_start)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Actual End</div>
          <div className="stat-value" style={{ fontSize: 14 }}>{formatDate(stream.actual_end)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Duration</div>
          <div className="stat-value" style={{ fontSize: 14 }}>
            {formatDuration(stream.actual_start, stream.actual_end)}
          </div>
        </div>
      </div>

      {!chatStats && (
        <div className="yt-empty" style={{ padding: '24px 0' }}>
          Click "Fetch Chat Data" to load chat analytics for this stream.
        </div>
      )}
    </div>
  )
}

function ChartsTab({
  concurrentLog, chatMessages, chatUsers,
}: {
  concurrentLog: YouTubeConcurrentLog[]
  chatMessages: YouTubeChatMessage[]
  chatUsers: YouTubeChatUser[]
}) {
  return (
    <div className="charts-tab">
      <ViewerTimelineChart data={concurrentLog} />
      <ChatActivityChart messages={chatMessages} />
      <TopChattersChart users={chatUsers} />
    </div>
  )
}

function ChattersTab({ users }: { users: YouTubeChatUser[] }) {
  const col = createColumnHelper<YouTubeChatUser>()
  const columns = [
    col.accessor('display_name', {
      header: 'Name',
      cell: info => (
        <span>
          {info.getValue()}
          {info.row.original.is_moderator && <span className="yt-user-badge mod">MOD</span>}
          {info.row.original.is_member && <span className="yt-user-badge member">MBR</span>}
        </span>
      ),
    }),
    col.accessor('message_count', {
      header: 'Messages',
      cell: info => formatNumber(info.getValue()),
    }),
    col.accessor('first_message_at', {
      header: 'First Message',
      cell: info => formatDate(info.getValue()),
    }),
    col.accessor('last_message_at', {
      header: 'Last Message',
      cell: info => formatDate(info.getValue()),
    }),
  ]

  if (users.length === 0) {
    return <div className="yt-empty">No chat user data. Fetch chat data first.</div>
  }

  return <DataTable data={users} columns={columns} />
}

function SuperChatsTab({
  messages, chatStats,
}: {
  messages: YouTubeChatMessage[]
  chatStats: YouTubeChatStats | null
}) {
  if (messages.length === 0) {
    return <div className="yt-empty">No super chats found for this stream.</div>
  }

  const col = createColumnHelper<YouTubeChatMessage>()
  const columns = [
    col.accessor('published_at', {
      header: 'Time',
      cell: info => formatDate(info.getValue()),
    }),
    col.accessor('super_chat_amount', {
      header: 'Amount',
      cell: info => {
        const row = info.row.original
        if (row.super_chat_amount != null && row.super_chat_currency) {
          return `${row.super_chat_currency} ${row.super_chat_amount.toLocaleString()}`
        }
        return '-'
      },
    }),
    col.accessor('message_text', {
      header: 'Message',
      cell: info => info.getValue() || '-',
    }),
    col.accessor('message_type', {
      header: 'Type',
      cell: info => info.getValue() === 'superSticker' ? 'Sticker' : 'Super Chat',
    }),
  ]

  return (
    <div>
      {chatStats && (
        <div className="yt-sc-summary">
          <div className="yt-sc-card">
            <div className="yt-stat-label">Total Super Chats</div>
            <div className="yt-stat-value">{chatStats.super_chat_count}</div>
          </div>
          <div className="yt-sc-card">
            <div className="yt-stat-label">Total Amount (JPY)</div>
            <div className="yt-stat-value">{formatJPY(chatStats.super_chat_total_jpy)}</div>
          </div>
          <div className="yt-sc-card">
            <div className="yt-stat-label">Memberships + Gifts</div>
            <div className="yt-stat-value">
              {chatStats.membership_count + chatStats.member_gift_total}
            </div>
          </div>
        </div>
      )}
      <DataTable data={messages} columns={columns} />
    </div>
  )
}
