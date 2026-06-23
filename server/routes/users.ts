import { Router } from 'express'
import { getDatabase } from '../db/schema.js'
import {
  getUsers, updateUser, getUserByDisplayName, getCitizenshipTargetBrands,
  getAllBadgesByUser, getBadgesForUser, setBadge, removeBadge, getRelatedDisplayNames,
  BADGE_TYPES, type BadgeType,
} from '../db/queries.js'

const router = Router()

// ── バッジ API ──────────────────────────────────────────────────────
// PUT  /api/users/:displayName/badges   body: { badge_type, series?, note? } → upsert
// DELETE /api/users/:displayName/badges body: { badge_type, series? } → 削除

router.put('/:displayName/badges', async (req, res) => {
  try {
    const displayName = decodeURIComponent(req.params.displayName)
    const { badge_type, series, note } = req.body ?? {}
    if (!BADGE_TYPES.includes(badge_type)) {
      res.status(400).json({ success: false, error: `badge_type は ${BADGE_TYPES.join('/')} のいずれか`, timestamp: new Date().toISOString() })
      return
    }
    await setBadge(displayName, badge_type as BadgeType, typeof series === 'string' ? series : '', typeof note === 'string' && note.trim() ? note.trim() : null)
    res.json({ success: true, data: await getBadgesForUser(displayName), timestamp: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ success: false, error: message, timestamp: new Date().toISOString() })
  }
})

router.delete('/:displayName/badges', async (req, res) => {
  try {
    const displayName = decodeURIComponent(req.params.displayName)
    const { badge_type, series } = req.body ?? {}
    if (!BADGE_TYPES.includes(badge_type)) {
      res.status(400).json({ success: false, error: `badge_type は ${BADGE_TYPES.join('/')} のいずれか`, timestamp: new Date().toISOString() })
      return
    }
    await removeBadge(displayName, badge_type as BadgeType, typeof series === 'string' ? series : '')
    res.json({ success: true, data: await getBadgesForUser(displayName), timestamp: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ success: false, error: message, timestamp: new Date().toISOString() })
  }
})

// ── 市民権アラート ──────────────────────────────────────────────────
// 準市民の昇格候補・失効を判定する。判定に数える参加実績は「市民権対象シリーズ」
// (series.citizenship_target=1) のイベントだけ。対象未設定なら全イベントで判定（後方互換）。
// ステータス（準市民タグ）自体はイベント横断の概念なので、ページのシリーズ絞り込みには追従しない。
router.get('/citizenship-alerts', async (_req, res) => {
  try {
    const db = getDatabase()
    const targetSeries = await getCitizenshipTargetBrands()

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

    // 準市民タグを持つユーザーだけ対象。
    // 出演者・関係者（レギュラー/ビジター/出演者/マネージャー/スタッフのバッジ持ち・旧is_staff）は
    // 市民権の対象外なのでアラートから除外する（要注意 watch は除外しない）
    const related = await getRelatedDisplayNames()
    const users = await getUsers()
    const semicitizens = users.filter(u =>
      Array.isArray(u.tags) && u.tags.includes('準市民')
      && !related.has(u.display_name)
      && !u.is_staff
    )

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
      } else if (attendance_count >= 2 && total_stay >= 300) {
        // 🎯 リーチ: 昇格まであと一歩（あと参加1回 or 滞在1時間以内）。「あと何が足りないか」を返す
        alerts.push({
          display_name: user.display_name, type: 'reach',
          attendance_count, total_stay_hours: Math.round((total_stay / 60) * 10) / 10,
          need_attend: Math.max(0, 3 - attendance_count),
          need_stay_minutes: Math.max(0, Math.round(360 - total_stay)),
        })
      }
    }

    // 失効 → 昇格 → リーチ の順
    const order: Record<string, number> = { expired: 0, promotion: 1, reach: 2 }
    alerts.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9))

    res.json({ success: true, data: { alerts, target_series: targetSeries }, timestamp: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ success: false, error: message, timestamp: new Date().toISOString() })
  }
})

router.get('/performers', async (req, res) => {
  try {
    const db = getDatabase()
    const brandRaw = req.query.brand
    const brand = typeof brandRaw === 'string' && brandRaw.trim() ? brandRaw.trim() : null

    // バッジ（出演者系＋関係者）を持つユーザーを対象にする。
    // グローバルのブランド絞り込み時は「そのブランドのバッジ or 全体バッジ」を持つ人に限定。
    const badgeRows = (await db.execute({
      sql: `SELECT b.*, u.id as uid, u.user_id, u.is_staff, u.notes as unotes, u.tags as utags
            FROM user_badges b
            JOIN users u ON u.display_name = b.display_name
            WHERE b.badge_type IN ('regular','visitor','performer','manager','staff')
            ${brand ? "AND (b.series = ? OR b.series = '')" : ''}
            ORDER BY b.display_name`,
      args: brand ? [brand] : [],
    })).rows as any[]

    // ユーザー単位に集約
    const byUser = new Map<string, any>()
    for (const row of badgeRows) {
      if (!byUser.has(row.display_name)) {
        byUser.set(row.display_name, {
          id: row.uid,
          user_id: row.user_id ?? null,
          display_name: row.display_name,
          is_staff: row.is_staff === 1,
          notes: row.unotes ?? null,
          tags: row.utags ? (() => { try { return JSON.parse(row.utags) } catch { return [] } })() : [],
          badges: [],
          appearance_count: 0,
          events: [] as any[],
        })
      }
      byUser.get(row.display_name)!.badges.push({
        id: row.id, badge_type: row.badge_type, series: row.series ?? '', note: row.note ?? undefined,
      })
    }

    // 出演回数・出演履歴（brand 指定時はそのブランドのイベントに限定）
    const performers = await Promise.all(Array.from(byUser.values()).map(async p => {
      const eventsResult = await db.execute({
        sql: `SELECT DISTINCT e.id, e.name, e.date, e.start_time
              FROM player_events pe
              JOIN events e ON e.id = pe.event_id
              WHERE pe.display_name = ? AND pe.event_type = 'join'
              ${brand ? 'AND e.brand = ?' : ''}
              ORDER BY e.date DESC`,
        args: brand ? [p.display_name, brand] : [p.display_name],
      })
      p.events = eventsResult.rows
      p.appearance_count = eventsResult.rows.length
      return p
    }))

    // レギュラー→ビジター→出演者→マネージャー→スタッフの順、同役は出演回数降順
    const roleRank = (p: any) => {
      const order = ['regular', 'visitor', 'performer', 'manager', 'staff']
      let best = 99
      for (const b of p.badges) { const i = order.indexOf(b.badge_type); if (i >= 0 && i < best) best = i }
      return best
    }
    performers.sort((a, b) => roleRank(a) - roleRank(b) || b.appearance_count - a.appearance_count)

    res.json({ success: true, data: performers, timestamp: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ success: false, error: message, timestamp: new Date().toISOString() })
  }
})

// 軽量版の名簿（外部ツール=loyall Data 用）。'/' は参加者ごとに滞在時間を
// N+1で算出するため数分かかり、フロント直叩きでタイムアウトする。こちらは
// 1本の集約クエリで「参加回数・入場回数・初/最終参加」だけを高速に返す（滞在時間は持たない）。
// ?brand= で対象ブランドに絞る（参加回数もそのブランド内で再計算）。
router.get('/roster', async (req, res) => {
  try {
    const db = getDatabase()
    const brandRaw = req.query.brand
    const brand = typeof brandRaw === 'string' && brandRaw.trim() ? brandRaw.trim() : null

    let sql = `SELECT display_name,
                      COUNT(DISTINCT event_id) AS attendance_count,
                      COUNT(*)                 AS entries,
                      MIN(timestamp)           AS first_attendance,
                      MAX(timestamp)           AS last_attendance
               FROM player_events
               WHERE event_type = 'join' AND event_id IS NOT NULL AND event_id != 0`
    const args: any[] = []
    if (brand) { sql += ` AND event_id IN (SELECT id FROM events WHERE brand = ?)`; args.push(brand) }
    sql += ` GROUP BY display_name ORDER BY attendance_count DESC`

    const result = await db.execute({ sql, args })
    const badgesByUser = await getAllBadgesByUser()
    const data = (result.rows as any[]).map((r) => ({
      display_name: r.display_name,
      attendance_count: Number(r.attendance_count) || 0,
      entries: Number(r.entries) || 0,
      first_attendance: r.first_attendance ?? null,
      last_attendance: r.last_attendance ?? null,
      badges: badgesByUser.get(r.display_name) ?? [],
    }))
    res.json({ success: true, data, timestamp: new Date().toISOString() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    res.status(500).json({ success: false, error: message, timestamp: new Date().toISOString() })
  }
})

router.get('/', async (req, res) => {
  try {
    const db = getDatabase()
    const users = await getUsers()
    const badgesByUser = await getAllBadgesByUser()

    const { from, to } = req.query
    const dateFrom = typeof from === 'string' && from ? from : null
    const dateTo = typeof to === 'string' && to ? to : null
    const brandRaw = req.query.brand
    const brand = typeof brandRaw === 'string' && brandRaw.trim() ? brandRaw.trim() : null

    const usersWithStats = await Promise.all(users.map(async user => {
      // user_id があれば改名前の参加も合算する（user_id キー統一リファクタ・2026-06-23）。
      // join と leave は必ず同じキーで引く（別人扱い防止）。
      const joinKey     = user.user_id ? 'pe.user_id = ?' : 'pe.display_name = ?'
      const joinKeyArg  = user.user_id ?? user.display_name
      const leaveKey    = user.user_id ? 'user_id = ?'    : 'display_name = ?'
      const leaveKeyArg = joinKeyArg

      let joinSql = `SELECT pe.timestamp, pe.event_id
                     FROM player_events pe
                     WHERE ${joinKey} AND pe.event_type = 'join'`
      const joinArgs: any[] = [joinKeyArg]
      if (dateFrom) { joinSql += ` AND pe.timestamp >= ?`; joinArgs.push(dateFrom) }
      if (dateTo)   { joinSql += ` AND pe.timestamp <= ?`; joinArgs.push(dateTo + 'T23:59:59') }
      // brand 指定時は参加回数・滞在時間・初参加/最終参加をそのブランド内だけで計算
      if (brand)    { joinSql += ` AND pe.event_id IN (SELECT id FROM events WHERE brand = ?)`; joinArgs.push(brand) }
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
                  WHERE ${leaveKey} AND event_id = ? AND event_type = 'leave' AND timestamp > ?
                  ORDER BY timestamp ASC LIMIT 1`,
            args: [leaveKeyArg, join.event_id, join.timestamp],
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
        badges: badgesByUser.get(user.display_name) ?? [],
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

// イベント単位の来場記録（1イベント=1行。ログファイル/入退場ペア単位ではなく夜単位で集計）
interface UserAttendanceRecord {
  event_id: number
  event_name: string
  event_date: string
  first_join: string        // そのイベントでの初入場
  last_leave: string | null // 最終退場（未記録なら null）
  stay_duration: number     // 合計滞在（分・再入場分を合算）
  entries: number           // 入場回数（再入場含む）
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

    // user_id があれば改名前の参加も合算する（user_id キー統一リファクタ・2026-06-23）。
    // user_id が無い場合は従来どおり display_name で引く（後方互換）。
    const playerEventsResult = await db.execute(
      user.user_id
        ? {
            sql: `SELECT pe.event_id, pe.event_type, pe.timestamp
                  FROM player_events pe
                  WHERE pe.user_id = ?
                  ORDER BY pe.timestamp ASC`,
            args: [user.user_id],
          }
        : {
            sql: `SELECT pe.event_id, pe.event_type, pe.timestamp
                  FROM player_events pe
                  WHERE pe.display_name = ?
                  ORDER BY pe.timestamp ASC`,
            args: [user.display_name],
          }
    )
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

      // イベント単位で集計: 入場回数・初入場〜最終退場・合計滞在（再入場を合算）
      let entries = 0
      let totalStay = 0
      let firstJoin: string | null = null
      let lastLeave: string | null = null
      let openJoin: string | null = null

      for (const pe of eventPlayerEvents) {
        if (pe.event_type === 'join') {
          entries++
          if (!firstJoin) firstJoin = pe.timestamp
          openJoin = pe.timestamp
        } else if (pe.event_type === 'leave') {
          lastLeave = pe.timestamp
          if (openJoin) {
            const mins = (new Date(pe.timestamp).getTime() - new Date(openJoin).getTime()) / 60000
            if (mins > 0 && mins <= 720) totalStay += mins
            openJoin = null
          }
        }
      }
      // 退場記録が無いまま終わった場合は、そのイベント内の最後の記録までを滞在として加算
      if (openJoin) {
        const lastTimestamp = eventPlayerEvents[eventPlayerEvents.length - 1].timestamp
        const mins = (new Date(lastTimestamp).getTime() - new Date(openJoin).getTime()) / 60000
        if (mins > 0 && mins <= 720) totalStay += mins
      }

      if (entries === 0 || !firstJoin) continue
      attendanceRecords.push({
        event_id,
        event_name: eventData.name,
        event_date: eventData.date,
        first_join: firstJoin,
        last_leave: lastLeave,
        stay_duration: Math.round(totalStay * 10) / 10,
        entries,
      })
    }

    attendanceRecords.sort((a, b) => new Date(b.event_date).getTime() - new Date(a.event_date).getTime())

    res.json({
      success: true,
      data: {
        user,
        badges: await getBadgesForUser(user.display_name),
        attendance_records: attendanceRecords,
      },
      timestamp: new Date().toISOString(),
    })
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
