import { Router } from 'express'
import { getDatabase } from '../db/schema.js'
import { getUsers, updateUser, getUserByDisplayName } from '../db/queries.js'

const router = Router()

router.get('/performers', async (_req, res) => {
  try {
    const db = getDatabase()

    const performerResult = await db.execute(`
      SELECT u.*,
        COUNT(DISTINCT pe.event_id) as appearance_count
      FROM users u
      LEFT JOIN player_events pe ON pe.display_name = u.display_name AND pe.event_type = 'join'
      WHERE u.performer_role IS NOT NULL
      GROUP BY u.id
      ORDER BY u.performer_role ASC, appearance_count DESC
    `)

    const performers = await Promise.all(performerResult.rows.map(async (row: any) => {
      const eventsResult = await db.execute({
        sql: `SELECT DISTINCT e.id, e.name, e.date, e.start_time
              FROM player_events pe
              JOIN events e ON e.id = pe.event_id
              WHERE pe.display_name = ? AND pe.event_type = 'join'
              ORDER BY e.date DESC`,
        args: [row.display_name],
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

router.get('/', async (_req, res) => {
  try {
    const db = getDatabase()
    const users = await getUsers()

    const usersWithStats = await Promise.all(users.map(async user => {
      const joinsResult = await db.execute({
        sql: `SELECT pe.timestamp, pe.event_id
              FROM player_events pe
              WHERE pe.display_name = ? AND pe.event_type = 'join'
              ORDER BY pe.timestamp ASC`,
        args: [user.display_name],
      })
      const joins = joinsResult.rows as any[]

      const attendance_count = joins.length
      let total_stay_duration = 0
      let first_attendance: string | undefined
      let last_attendance: string | undefined

      if (attendance_count > 0) {
        first_attendance = joins[0].timestamp
        last_attendance = joins[attendance_count - 1].timestamp

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
        avg_stay_duration: attendance_count > 0 ? Math.round((total_stay_duration / attendance_count) * 10) / 10 : 0,
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
