import { useState, useEffect } from 'react'
import { PlayerEvent } from '../types/index.js'
import '../styles/KPICards.css'

interface KPICardsProps {
  eventId?: number
}

interface KPIData {
  totalVisitors: number
  uniqueVisitors: number
  peakConcurrent: number
  averageStayMinutes: number
  totalStayHours: number
  visitDuration?: string
}

export function KPICards({ eventId }: KPICardsProps) {
  const [data, setData] = useState<KPIData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (eventId) {
      fetchPlayerEvents(eventId)
    } else {
      setLoading(false)
    }
  }, [eventId])

  const fetchPlayerEvents = async (id: number) => {
    try {
      const response = await fetch(`/api/events/${id}/player-events`)
      const data = await response.json()
      if (data.success) {
        const events: PlayerEvent[] = data.data
        const kpi = calculateKPI(events)
        setData(kpi)
      } else {
        setError(data.error)
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const calculateKPI = (events: PlayerEvent[]): KPIData => {
    // Count total join events
    const joinEvents = events.filter(e => e.event_type === 'join')
    const totalVisitors = joinEvents.length

    // Count unique visitors (by user_id or display_name)
    const uniqueUsers = new Set(
      joinEvents.map(e => e.user_id || e.display_name)
    )
    const uniqueVisitors = uniqueUsers.size

    // Calculate concurrent viewers over time
    const timeline: Map<string, number> = new Map()
    let maxConcurrent = 0

    for (const event of events) {
      const time = event.timestamp
      if (!timeline.has(time)) {
        timeline.set(time, 0)
      }
      const delta = event.event_type === 'join' ? 1 : -1
      const newCount = (timeline.get(time) || 0) + delta
      timeline.set(time, Math.max(0, newCount))
      maxConcurrent = Math.max(maxConcurrent, newCount)
    }

    // Calculate stay durations
    const userSessions: Map<string, number[]> = new Map()
    const userJoinTimes: Map<string, string> = new Map()

    for (const event of events.sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
      const userId = event.user_id || event.display_name

      if (event.event_type === 'join') {
        userJoinTimes.set(userId, event.timestamp)
      } else if (event.event_type === 'leave') {
        const joinTime = userJoinTimes.get(userId)
        if (joinTime) {
          const join = new Date(joinTime).getTime()
          const leave = new Date(event.timestamp).getTime()
          const durationMs = leave - join

          if (!userSessions.has(userId)) {
            userSessions.set(userId, [])
          }
          userSessions.get(userId)!.push(durationMs)
          userJoinTimes.delete(userId)
        }
      }
    }

    // Calculate averages
    const allDurations = Array.from(userSessions.values()).flat()
    const averageStayMs = allDurations.length > 0
      ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length
      : 0
    const averageStayMinutes = Math.round(averageStayMs / 60000)

    const totalStayMs = allDurations.reduce((a, b) => a + b, 0)
    const totalStayHours = Math.round(totalStayMs / 3600000 * 10) / 10

    return {
      totalVisitors,
      uniqueVisitors,
      peakConcurrent: maxConcurrent,
      averageStayMinutes,
      totalStayHours,
    }
  }

  if (!eventId) {
    return (
      <div className="kpi-cards">
        <div className="kpi-placeholder">
          <p>イベントを選択してKPIを表示</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="kpi-cards">
        <div className="kpi-placeholder">KPIを読み込み中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="kpi-cards">
        <div className="kpi-placeholder error">{error}</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="kpi-cards">
        <div className="kpi-placeholder">データがありません</div>
      </div>
    )
  }

  return (
    <div className="kpi-cards">
      <div className="kpi-card">
        <div className="kpi-icon">👥</div>
        <div className="kpi-content">
          <div className="kpi-label">総参加者数</div>
          <div className="kpi-value">{data.totalVisitors}</div>
        </div>
      </div>

      <div className="kpi-card">
        <div className="kpi-icon">✨</div>
        <div className="kpi-content">
          <div className="kpi-label">ユニーク参加者</div>
          <div className="kpi-value">{data.uniqueVisitors}</div>
        </div>
      </div>

      <div className="kpi-card">
        <div className="kpi-icon">📈</div>
        <div className="kpi-content">
          <div className="kpi-label">ピーク同時接続</div>
          <div className="kpi-value">{data.peakConcurrent}</div>
        </div>
      </div>

      <div className="kpi-card">
        <div className="kpi-icon">⏱️</div>
        <div className="kpi-content">
          <div className="kpi-label">平均滞在時間</div>
          <div className="kpi-value">{data.averageStayMinutes}m</div>
        </div>
      </div>

      <div className="kpi-card">
        <div className="kpi-icon">🕐</div>
        <div className="kpi-content">
          <div className="kpi-label">総滞在時間</div>
          <div className="kpi-value">{data.totalStayHours}h</div>
        </div>
      </div>
    </div>
  )
}
