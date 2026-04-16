import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line,
} from 'recharts'
import '../../styles/Charts.css'

// ──────────────────────────────────────────────
// Concurrent Viewers Chart
// ──────────────────────────────────────────────

interface ViewerTimelineProps {
  data: Array<{ recorded_at: string; concurrent_viewers: number }>
}

export function ViewerTimelineChart({ data }: ViewerTimelineProps) {
  if (data.length === 0) {
    return <div className="chart-empty">No concurrent viewer data available</div>
  }

  const formatted = data.map(d => ({
    time: new Date(d.recorded_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    viewers: d.concurrent_viewers,
  }))

  return (
    <div className="chart-block">
      <h4 className="section-subtitle">Concurrent Viewers</h4>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={formatted}>
          <defs>
            <linearGradient id="viewerGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#e74c3c" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#e74c3c" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="time" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
            formatter={(v: number) => [v.toLocaleString(), 'Viewers']}
          />
          <Area
            type="monotone"
            dataKey="viewers"
            stroke="#e74c3c"
            fill="url(#viewerGrad)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ──────────────────────────────────────────────
// Chat Activity per Minute Chart
// ──────────────────────────────────────────────

interface ChatMessage {
  published_at: string
  message_type: string
  super_chat_amount?: number
}

interface ChatTimelineProps {
  messages: ChatMessage[]
}

export function ChatActivityChart({ messages }: ChatTimelineProps) {
  if (messages.length === 0) {
    return <div className="chart-empty">No chat data available</div>
  }

  // Bucket messages by minute
  const minuteBuckets = new Map<string, { total: number; superChats: number }>()

  for (const msg of messages) {
    const key = msg.published_at.slice(0, 16) // YYYY-MM-DDTHH:MM
    const bucket = minuteBuckets.get(key) ?? { total: 0, superChats: 0 }
    bucket.total++
    if (msg.message_type === 'superChat' || msg.message_type === 'superSticker') {
      bucket.superChats++
    }
    minuteBuckets.set(key, bucket)
  }

  const sorted = Array.from(minuteBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))

  // Downsample if too many points
  const maxPoints = 200
  const step = Math.max(1, Math.floor(sorted.length / maxPoints))
  const downsampled = sorted.filter((_, i) => i % step === 0)

  const chartData = downsampled.map(([key, val]) => ({
    time: new Date(key).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
    messages: val.total,
    superChats: val.superChats,
  }))

  return (
    <div className="chart-block">
      <h4 className="section-subtitle">Chat Activity (per minute)</h4>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis dataKey="time" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
          <Bar dataKey="messages" fill="#3498db" opacity={0.6} name="Messages" />
          <Line
            type="monotone"
            dataKey="superChats"
            stroke="#f39c12"
            strokeWidth={2}
            dot={false}
            name="Super Chats"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

// ──────────────────────────────────────────────
// Super Chat Breakdown Chart
// ──────────────────────────────────────────────

interface SuperChatUser {
  display_name: string
  message_count: number
  is_member: boolean
  is_moderator: boolean
}

interface TopChattersProps {
  users: SuperChatUser[]
  limit?: number
}

export function TopChattersChart({ users, limit = 15 }: TopChattersProps) {
  if (users.length === 0) {
    return <div className="chart-empty">No chat user data available</div>
  }

  const topUsers = users.slice(0, limit).map(u => ({
    name: u.display_name.length > 12
      ? u.display_name.slice(0, 12) + '...'
      : u.display_name,
    messages: u.message_count,
    badge: u.is_moderator ? 'MOD' : u.is_member ? 'MBR' : '',
  }))

  return (
    <div className="chart-block">
      <h4 className="section-subtitle">Top Chatters</h4>
      <ResponsiveContainer width="100%" height={Math.max(280, topUsers.length * 28)}>
        <BarChart data={topUsers} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
          <XAxis type="number" tick={{ fontSize: 11 }} />
          <YAxis
            type="category"
            dataKey="name"
            width={120}
            tick={{ fontSize: 11 }}
          />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 6 }} />
          <Bar dataKey="messages" fill="#2ecc71" name="Messages" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
