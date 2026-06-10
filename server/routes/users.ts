import { Router } from 'express'
import { getDatabase } from '../db/schema.js'
import { getUsers, updateUser, getUserByDisplayName, getCitizenshipTargetSeries } from '../db/queries.js'

const router = Router()

// ── 市民権アラート ──────────────────────────────────────────────────
// 準市民の昇格候補・失効を判定する。判定に数える参加実績は「市民権対象シリーズ」
// (series.citizenship_target=1) のイベントだけ。対象未設定なら全イベントで判定（後方互換）。
// ステータス（準市民タグ）自体はイベント横断の概念なので、ページのシリーズ絞り込みには追従しない。
router.get('/citizenship-alerts', async (_req, res) => {
  try {
    const db = getDatabase()
    const targetSeries = await getCitizenshipTargetSeries()

    // 判定対象イベントID集合（対象シリーズ未設定なら全イベント）
    let targetEventIds: number[] | null = null
    if (targetSeries.length > 0) {
      const ph = targetSeries.map(() => '?').join(',')
      const r = await db.execute({ sql: `SELECT id FROM events WHERE series IN (${ph})`, args: targetSeries })
      targetEventIds = (r.rows as any[]).map(row => row.id as number)
      if (targetEventIds.length === 0) {
        res.json({ success: true, data: { alerts: [], target_series: targetSeries }, timestamp: new Date().toISOString() })
        return
      }
    }

    // 準市民タグを持つユーザーだけ対象
    const users = await getUsers()
    const semicitizens = users.filter(u => Array.isArray(u.tags) && u.tags.includes('準市民'))

    const evClause = targetEventIds ? ` AND pe.event_id IN (${targetEventIds.map(() => '?').join(',')})` : ''
    const evArgs = targetEventIds ?? []

    const now = new Date(); now.setHours(0, 0, 0, 0)
    const alerts: any[] = []

    for (const user of semicitizens) {
      const joinsResult = await db.execute({
        sql: `SELECT pe.timestamp, pe.event_id FROM player_events pe
              WHERE pe.display_name = ? AND pe.event_type = 'join'${evClause}
              ORDER BY pe.timestamp ASC`,
        args: [user.display_name, ...evArgs],
      })
      const joins = joinsResult.rows as any[]
      if (joins.length === 0) continue

      const attendance_count = new Set(joins.filter(j => j.event_id != null && j.event_id !== 0).map(j => j.event_id)).size
      const last_attendance = joins[joins.length - 1].timestamp

      let total_stay = 0
      for (const join of joins) {
        const leave = (await db.execute({
          sql: `SELECT timestamp FROM player_events
                WHERE display_name = ? AND event_id = ? AND event_type = 'leave' AND timestamp > ?
                ORDER BY timestamp ASC LIMIT 1`,
          args: [user.display_name, join.event_id, join.timestamp],
        })).rows[0] as any
        if (leave) {
          const dur = (new Date(leave.timestamp).getTime() - new Date(join.timestamp).getTime()) / 60000
          if (dur > 0 && dur <= 720) total_stay += dur
        }
      }

      const last = new Date(last_attendance); last.setHours(0, 0, 0, 0)
      const daysSinceLast = Math.round((now.getTime() - last.getTime()) / 86_400_000)

      if (daysSinceLast >= 90) {
        alerts.push({ display_name: user.display_name, type: 'expired', days_since_last: daysSinceLast })
      } else if (attendance_count >= 3 && total_stay >= 360) {
        alerts.push({
          display_name: user.display_name, type: 'promotion',
          attendance_count, total_stay_hours: Math.round((total_stay / 60) * 10) / 10,
        })
      }
    }

    res.json({ success: true, data: { alerts, target_series: targetSeries }, timestamp: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ success: false, error: message, timestamp: new Date().toISOString() })
  }
})

router.get('/performers', async (req, res) => {
  try {
    const db = getDatabase()
    const seriesRaw = req.query.series
    const series = typeof seriesRaw === 'string' && seriesRaw.trim() ? seriesRaw.trim() : null

    // series 指定時は出演回数・出演履歴をそのシリーズのイベントに限定
    const performerResult = await db.execute({
      sql: `
      SELECT u.*,
        COUNT(DISTINCT pe.event_id) as appearance_count
      FROM users u
      LEFT JOIN player_events pe ON pe.display_name = u.display_name AND pe.event_type = 'join'
        ${series ? 'AND pe.event_id IN (SELECT id FROM events WHERE series = ?)' : ''}
      WHERE u.performer_role IS NOT NULL
      GROUP BY u.id
      ORDER BY u.performer_role ASC, appearance_count DESC
    `,
      args: series ? [series] : [],
    })

    const performers = await Promise.all(performerResult.rows.map(async (row: any) => {
      const eventsResult = await db.execute({
        sql: `SELECT DISTINCT e.id, e.name, e.date, e.start_time
              FROM player_events pe
              JOIN events e ON e.id = pe.event_id
              WHERE pe.display_name = ? AND pe.event_type = 'join'
              ${series ? 'AND e.series = ?' : ''}
              ORDER BY e.date DESC`,
        args: series ? [row.display_name, series] : [row.display_name],
      })

      return {
        id: row.id,
        user_id: row.user_id ?? null,
        display_name: row.display_name,
        performer_role: row.performer_role,
        is_staff: row.is_staff === 1,
        notes: row.notes ?? null,
        tags: row.tags ? (() => { try { return JSON.parse(row.tags) } catch { return [] } })() : [],
        appearance_count: row.appearance_count ?? 0,
        events: eventsResult.rows,
      }
    }))

    res.json({ success: true, data: performers, timestamp: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ success: false, error: message, timestamp: new Date().toISOString() })
  }
})

router.get('/', async (req, res) => {
  try {
    const db = getDatabase()
    const users = await getUsers()

    const { from, to } = req.query
    const dateFrom = typeof from === 'string' && from ? from : null
    const dateTo = typeof to === 'string' && to ? to : null
    const seriesRaw = req.query.series
    const series = typeof seriesRaw === 'string' && seriesRaw.trim() ? seriesRaw.trim() : null

    const usersWithStats = await Promise.all(users.map(async user => {
      let joinSql = `SELECT pe.timestamp, pe.event_id
                     FROM player_events pe
                     WHERE pe.display_name = ? AND pe.event_type = 'join'`
      const joinArgs: any[] = [user.display_name]
      if (dateFrom) { joinSql += ` AND pe.timestamp >= ?`; joinArgs.push(dateFrom) }
      if (dateTo)   { joinSql += ` AND pe.timestamp <= ?`; joinArgs.push(dateTo + 'T23:59:59') }
      // series 指定時は参加回数・滞在時間・初参加/最終参加をそのシリーズ内だけで計算
      if (series)   { joinSql += ` AND pe.event_id IN (SELECT id FROM events WHERE series = ?)`; joinArgs.push(series) }
      joinSql += ` ORDER BY pe.timestamp ASC`

      const joinsResult = await db.execute({ sql: joinSql, args: joinArgs })
      const joins = joinsResult.rows as any[]

      // ユニークイベント数を参加回数とする（再入室は1回とカウント）
      const attendance_count = new Set(
        joins.filter(j => j.event_id != null && j.event_id !== 0).map(j => j.event_id)
      ).size
      let total_stay_duration = 0
      let first_attendance: string | undefined
      let last_attendance: string | undefined

      if (joins.length > 0) {
        first_attendance = joins[0].timestamp
        last_attendance = joins[joins.length - 1].timestamp

        for (const join of joins) {
          const leaveResult = await db.execute({
            sql: `SELECT timestamp FROM player_events
                  WHERE display_name = ? AND event_id = ? AND event_type = 'leave' AND timestamp > ?
                  ORDER BY timestamp ASC LIMIT 1`,
            args: [user.display_name, join.event_id, join.timestamp],
          })
          const leave = leaveResult.rows[0] as any

          if (leave) {
            const durationMinutes = (new Date(leave.timestamp).getTime() - new Date(join.timestamp).getTime()) / 60000
            if (durationMinutes > 0 && durationMinutes <= 720) {
              total_stay_duration += durationMinutes
            }
          }
        }
      }

      return {
        ...user,
        attendance_count,
        total_stay_duration: Math.round(total_stay_duration),
        avg_stay_duration: attendance_count > 0 ? Math.round((total_stay_duration / attendance_count) * 10) / 10 : 0, // per event
        first_attendance,
        last_attendance,
      }
    }))

    res.json({ success: true, data: usersWithStats, timestamp: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ success: false, error: message, timestamp: new Date().toISOString() })
  }
})

interface UserAttendanceRecord {
  event_id: number
  event_name: string
  event_date: string
  join_time: string
  leave_time: string | null
  stay_duration: number | null
}

router.get('/:displayName', async (req, res) => {
  try {
    const db = getDatabase()
    const decodedName = decodeURIComponent(req.params.displayName)

    const user = await getUserByDisplayName(decodedName)
    if (!user) {
      res.status(404).json({ success: false, error: 'User not found', timestamp: new Date().toISOString() })
      return
    }

    const playerEventsResult = await db.execute({
      sql: `SELECT pe.event_id, pe.event_type, pe.timestamp
            FROM player_events pe
            WHERE pe.display_name = ?
            ORDER BY pe.timestamp ASC`,
      args: [user.display_name],
    })
    const playerEvents = playerEventsResult.rows as any[]

    const eventIds = [...new Set(playerEvents.map(pe => pe.event_id).filter(id => id != null && id !== 0))]
    let eventMap = new Map<number, any>()

    if (eventIds.length > 0) {
      const eventsResult = await db.execute({
        sql: `SELECT id, name, date FROM events WHERE id IN (${eventIds.map(() => '?').join(',')})`,
        args: eventIds,
      })
      eventMap = new Map(eventsResult.rows.map((e: any) => [e.id, e]))
    }

    const attendanceRecords: UserAttendanceRecord[] = []
    for (const event_id of eventIds) {
      const eventPlayerEvents = playerEvents.filter(pe => pe.event_id === event_id)
      const eventData = eventMap.get(event_id)
      if (!eventData) continue

      let joinTime: string | null = null
      for (const pe of eventPlayerEvents) {
        if (pe.event_type === 'join') {
          joinTime = pe.timestamp
        } else if (pe.event_type === 'leave' && joinTime) {
          const stayMinutes = Math.max(0, (new Date(pe.timestamp).getTime() - new Date(joinTime).getTime()) / 60000)
          attendanceRecords.push({
            event_id,
            event_name: eventData.name,
            event_date: eventData.date,
            join_time: joinTime,
            leave_time: pe.timestamp,
            stay_duration: Math.round(stayMinutes * 10) / 10,
          })
          joinTime = null
        }
      }

      if (joinTime) {
        const lastTimestamp = eventPlayerEvents[eventPlayerEvents.length - 1].timestamp
        const stayMinutes = Math.max(0, (new Date(lastTimestamp).getTime() - new Date(joinTime).getTime()) / 60000)
        attendanceRecords.push({
          event_id,
          event_name: eventData.name,
          event_date: eventData.date,
          join_time: joinTime,
          leave_time: null,
          stay_duration: Math.round(stayMinutes * 10) / 10,
        })
      }
    }

    attendanceRecords.sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime())

    res.json({ success: true, data: { user, attendance_records: attendanceRecords }, timestamp: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ success: false, error: message, timestamp: new Date().toISOString() })
  }
})

router.put('/:displayName', async (req, res) => {
  try {
    const displayName = decodeURIComponent(req.params.displayName)
    const { notes, tags, is_staff, is_excluded, performer_role } = req.body

    const updated = await updateUser(displayName, { notes, tags, is_staff, is_excluded, performer_role })
    if (!updated) {
      res.status(404).json({ success: false, error: 'User not found', timestamp: new Date().toISOString() })
      return
    }

    res.json({ success: true, data: updated, timestamp: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ success: false, error: message, timestamp: new Date().toISOString() })
  }
})

export default router
