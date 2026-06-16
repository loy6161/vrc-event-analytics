import { Router, Request, Response } from 'express'
import { getDatabase } from '../db/schema.js'
import { getEventById } from '../db/queries.js'
import type { EventStats, UserRankingItem, PeriodStats, DetailedEventStats, EventInsights } from '../../src/types/index.js'

const router = Router()

function ok<T>(res: Response, data: T) {
  res.json({ success: true, data, timestamp: new Date().toISOString() })
}

function fail(res: Response, message: string, status = 500) {
  res.status(status).json({ success: false, error: message, timestamp: new Date().toISOString() })
}

function parseId(param: string): number | null {
  const n = parseInt(param, 10)
  return isNaN(n) ? null : n
}

// ?brand= クエリ（'' や未指定は undefined = 全イベント）
function brandParam(req: Request): string | undefined {
  const s = req.query.brand
  return typeof s === 'string' && s.trim() ? s.trim() : undefined
}

interface RawPlayerEvent {
  event_id?: number
  user_id: string | null
  display_name: string
  event_type: 'join' | 'leave'
  timestamp: string
  // 分析対象から除外するユーザー（主催・スタッフ・出演者 = users.is_excluded=1）。
  // 注意: 同時在場（ピーク同接）には含める。除外は「分析しない」であって
  // 「会場に居なかった」ではないため。体感人数＝会場に実在した人数と一致させる。
  excluded?: boolean
}

function userKey(e: { user_id: string | null; display_name: string }): string {
  return e.user_id ?? e.display_name
}

// 同時在場（同接）は在場ユーザーの集合サイズで数える。
// 重要: 除外ユーザー(excluded=true)も「会場に実在した body」なので集合に含める。
// VRChatログは leave 欠落・再入場 join が多いため ±1 ではなく Set 方式（上限=ユニーク数）。
function concurrencyPoints(rows: RawPlayerEvent[]): { timestamp: string; concurrent: number }[] {
  const sorted = [...rows].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const points: { timestamp: string; concurrent: number }[] = []
  const present = new Set<string>()
  for (const e of sorted) {
    if (e.event_type === 'join') present.add(userKey(e))
    else present.delete(userKey(e))
    const concurrent = present.size
    if (points.length > 0 && points[points.length - 1].timestamp === e.timestamp) {
      points[points.length - 1].concurrent = concurrent
    } else {
      points.push({ timestamp: e.timestamp, concurrent })
    }
  }
  return points
}

function peakConcurrent(rows: RawPlayerEvent[]): number {
  let peak = 0
  for (const p of concurrencyPoints(rows)) if (p.concurrent > peak) peak = p.concurrent
  return peak
}

function round1(n: number): number { return Math.round(n * 10) / 10 }
function round3(n: number): number { return Math.round(n * 1000) / 1000 }
function floorToHour(ms: number): number { const d = new Date(ms); d.setMinutes(0, 0, 0); return d.getTime() }
function formatHourLabel(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`
}

function computeEventStats(rawEvents: RawPlayerEvent[]): EventStats {
  const empty: EventStats = { total_attendees: 0, unique_attendees: 0, total_joins: 0, peak_concurrent: 0, avg_stay_duration: 0, median_stay_duration: 0, max_stay_duration: 0, reentry_rate: 0, hourly_attendance: [] }
  if (rawEvents.length === 0) return empty

  // ピーク同接は除外ユーザー込み（会場に実在した人数）。
  // それ以外の分析指標（ユニーク数・滞在・再入場・時間帯）は除外ユーザーを除く。
  const peak_concurrent = peakConcurrent(rawEvents)

  const analytical = rawEvents.filter(e => !e.excluded)
  if (analytical.length === 0) return { ...empty, peak_concurrent }
  const sorted = [...analytical].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const joins = sorted.filter(e => e.event_type === 'join')
  const total_joins = joins.length
  const uniqueKeys = new Set(joins.map(userKey))
  const unique_attendees = uniqueKeys.size
  const total_attendees = unique_attendees

  const lastTimestamp = sorted[sorted.length - 1].timestamp
  const lastMs = new Date(lastTimestamp).getTime()
  const pendingJoins = new Map<string, string[]>()
  const durations: number[] = []

  for (const e of sorted) {
    const k = userKey(e)
    if (e.event_type === 'join') {
      let q = pendingJoins.get(k); if (!q) { q = []; pendingJoins.set(k, q) }
      q.push(e.timestamp)
    } else {
      const q = pendingJoins.get(k)
      if (q && q.length > 0) {
        const ms = new Date(e.timestamp).getTime() - new Date(q.shift()!).getTime()
        if (ms >= 0) durations.push(ms / 60_000)
        if (q.length === 0) pendingJoins.delete(k)
      }
    }
  }
  for (const [, q] of pendingJoins) {
    for (const joinTs of q) {
      const ms = lastMs - new Date(joinTs).getTime()
      if (ms > 0) durations.push(ms / 60_000)
    }
  }

  const avg_stay_duration = durations.length > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0
  const sortedDur = [...durations].sort((a, b) => a - b)
  let median_stay_duration = 0
  if (sortedDur.length > 0) {
    const mid = sortedDur.length >> 1
    median_stay_duration = sortedDur.length & 1 ? sortedDur[mid] : (sortedDur[mid - 1] + sortedDur[mid]) / 2
  }
  const max_stay_duration = sortedDur.length > 0 ? sortedDur[sortedDur.length - 1] : 0

  const joinCounts = new Map<string, number>()
  for (const e of joins) joinCounts.set(userKey(e), (joinCounts.get(userKey(e)) ?? 0) + 1)
  let reentrants = 0
  for (const c of joinCounts.values()) if (c > 1) reentrants++
  const reentry_rate = unique_attendees > 0 ? reentrants / unique_attendees : 0

  const intervals = buildPresenceIntervals(sorted, lastMs)
  const firstMs = new Date(sorted[0].timestamp).getTime()
  const startHour = floorToHour(firstMs)
  const endHour = floorToHour(lastMs) + 3600_000
  const hourly_attendance: EventStats['hourly_attendance'] = []
  for (let hMs = startHour; hMs < endHour; hMs += 3600_000) {
    const hEnd = hMs + 3600_000
    const present = new Set<string>()
    for (const iv of intervals) if (iv.startMs < hEnd && iv.endMs > hMs) present.add(iv.key)
    hourly_attendance.push({ hour: formatHourLabel(hMs), count: present.size })
  }

  return { total_attendees, unique_attendees, total_joins, peak_concurrent, avg_stay_duration: round1(avg_stay_duration), median_stay_duration: round1(median_stay_duration), max_stay_duration: round1(max_stay_duration), reentry_rate: round3(reentry_rate), hourly_attendance }
}

interface PresenceInterval { key: string; startMs: number; endMs: number }

function buildPresenceIntervals(sorted: RawPlayerEvent[], capMs: number): PresenceInterval[] {
  const pending = new Map<string, number[]>()
  const result: PresenceInterval[] = []
  for (const e of sorted) {
    const k = userKey(e)
    if (e.event_type === 'join') {
      let q = pending.get(k); if (!q) { q = []; pending.set(k, q) }
      q.push(new Date(e.timestamp).getTime())
    } else {
      const q = pending.get(k)
      if (q && q.length > 0) {
        const startMs = q.shift()!
        const endMs = new Date(e.timestamp).getTime()
        if (endMs > startMs) result.push({ key: k, startMs, endMs })
        if (q.length === 0) pending.delete(k)
      }
    }
  }
  for (const [k, q] of pending) for (const startMs of q) if (capMs > startMs) result.push({ key: k, startMs, endMs: capMs })
  return result
}

// タイムラインの同接は concurrencyPoints に委譲（除外ユーザー込み＝会場の実在人数）。
function computeTimeline(rows: RawPlayerEvent[]) {
  return concurrencyPoints(rows)
}

function computeUserRankings(allEvents: RawPlayerEvent[], sortBy: 'attendance' | 'stay' = 'attendance'): UserRankingItem[] {
  // ランキングは分析指標なので除外ユーザーを落とす
  const events = allEvents.filter(e => !e.excluded)
  if (events.length === 0) return []

  const byEvent = new Map<string, RawPlayerEvent[]>()
  for (const e of events) {
    const key = e.event_id != null ? String(e.event_id) : '__unassigned__'
    let group = byEvent.get(key); if (!group) { group = []; byEvent.set(key, group) }
    group.push(e)
  }

  const stats = new Map<string, { userId: string | undefined; displayName: string; joinTimestamps: string[]; stays: number[]; eventIdsSeen: Set<number> }>()

  function getOrInit(e: RawPlayerEvent) {
    const k = userKey(e)
    let s = stats.get(k)
    if (!s) { s = { userId: e.user_id ?? undefined, displayName: e.display_name, joinTimestamps: [], stays: [], eventIdsSeen: new Set() }; stats.set(k, s) }
    s.displayName = e.display_name
    if (e.user_id) s.userId = e.user_id
    return s
  }

  for (const group of byEvent.values()) {
    const sorted = [...group].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    const capMs = new Date(sorted[sorted.length - 1].timestamp).getTime()
    const pending = new Map<string, number[]>()

    for (const e of sorted) {
      const k = userKey(e)
      const s = getOrInit(e)
      if (e.event_type === 'join') {
        s.joinTimestamps.push(e.timestamp)
        if (e.event_id != null) s.eventIdsSeen.add(e.event_id)
        let q = pending.get(k); if (!q) { q = []; pending.set(k, q) }
        q.push(new Date(e.timestamp).getTime())
      } else {
        const q = pending.get(k)
        if (q && q.length > 0) {
          const dur = (new Date(e.timestamp).getTime() - q.shift()!) / 60_000
          if (dur > 0 && dur <= 720) s.stays.push(dur)
          if (q.length === 0) pending.delete(k)
        }
      }
    }
    for (const [k, q] of pending) {
      const s = stats.get(k)!
      for (const joinMs of q) { const dur = (capMs - joinMs) / 60_000; if (dur > 0 && dur <= 720) s.stays.push(dur) }
    }
  }

  let items: UserRankingItem[] = Array.from(stats.values()).map(s => {
    const total = s.stays.reduce((a, b) => a + b, 0)
    return {
      user_id: s.userId, display_name: s.displayName,
      attendance_count: s.eventIdsSeen.size > 0 ? s.eventIdsSeen.size : 1,
      total_stay_duration: round1(total),
      avg_stay_duration: s.stays.length > 0 ? round1(total / s.stays.length) : 0,
      first_attendance: s.joinTimestamps[0] ?? '', last_attendance: s.joinTimestamps[s.joinTimestamps.length - 1] ?? '', rank: 0,
    }
  })

  if (sortBy === 'stay') items.sort((a, b) => b.total_stay_duration - a.total_stay_duration)
  else items.sort((a, b) => b.attendance_count - a.attendance_count || b.total_stay_duration - a.total_stay_duration)

  for (let i = 0; i < items.length; i++) items[i].rank = i + 1
  return items
}

// 除外ユーザーも行ごと返す（excluded フラグ付き）。同接は会場の実在人数なので
// 除外ユーザーも数える必要があり、SQLで落とすと取り返せないため。
// 分析指標側（ユニーク数・ランキング・滞在等）は各関数で excluded=true を除く。
async function fetchPlayerEvents(eventId: number): Promise<RawPlayerEvent[]> {
  const result = await getDatabase().execute({
    sql: `SELECT pe.event_id, pe.user_id, pe.display_name, pe.event_type, pe.timestamp,
            CASE WHEN pe.display_name IN (SELECT display_name FROM users WHERE is_excluded = 1) THEN 1 ELSE 0 END AS excluded
          FROM player_events pe
          WHERE pe.event_id = ?
          ORDER BY pe.timestamp ASC`,
    args: [eventId],
  })
  return (result.rows as any[]).map(r => ({ ...r, excluded: r.excluded === 1 }))
}

async function computePeriodStats(period: string, brand?: string): Promise<PeriodStats> {
  const db = getDatabase()

  const eventsResult = await db.execute({
    sql: brand
      ? `SELECT id, date FROM events WHERE date LIKE ? AND brand = ? ORDER BY date`
      : `SELECT id, date FROM events WHERE date LIKE ? ORDER BY date`,
    args: brand ? [`${period}%`, brand] : [`${period}%`],
  })
  const events = eventsResult.rows as any[]
  const event_count = events.length
  const eventIds = events.map(e => e.id)

  if (event_count === 0) {
    return { period, event_count: 0, total_attendees: 0, unique_attendees: 0, avg_attendees_per_event: 0, new_attendees: 0, repeat_attendee_rate: 0 }
  }

  const placeholders = eventIds.map(() => '?').join(',')
  const joinRows = (await db.execute({
    sql: `SELECT pe.event_id, pe.user_id, pe.display_name
          FROM player_events pe
          WHERE pe.event_id IN (${placeholders}) AND pe.event_type = 'join'
            AND pe.display_name NOT IN (SELECT display_name FROM users WHERE is_excluded = 1)`,
    args: eventIds,
  })).rows as any[]

  const uniqueUserEventPairs = new Set(joinRows.map(r => `${r.user_id ?? r.display_name}|${r.event_id}`))
  const total_attendees = uniqueUserEventPairs.size
  const uniqueKeys = new Set(joinRows.map(r => r.user_id ?? r.display_name))
  const unique_attendees = uniqueKeys.size
  const avg_attendees_per_event = event_count > 0 ? round1(total_attendees / event_count) : 0

  let new_attendees = 0
  if (unique_attendees > 0) {
    // brand 指定時は「そのブランドで初参加」を新規とみなす
    const priorEventsResult = await db.execute(
      brand
        ? { sql: `SELECT id FROM events WHERE date < ? AND brand = ?`, args: [period, brand] }
        : { sql: `SELECT id FROM events WHERE date < ?`, args: [period] }
    )
    const priorEvents = priorEventsResult.rows as any[]
    if (priorEvents.length > 0) {
      const priorIds = priorEvents.map(e => e.id)
      const priorPh = priorIds.map(() => '?').join(',')
      const priorKeysResult = await db.execute({
        sql: `SELECT DISTINCT COALESCE(user_id, display_name) as key FROM player_events WHERE event_id IN (${priorPh}) AND event_type = 'join'`,
        args: priorIds,
      })
      const priorKeys = new Set((priorKeysResult.rows as any[]).map(r => r.key))
      for (const k of uniqueKeys) if (!priorKeys.has(k)) new_attendees++
    } else {
      new_attendees = unique_attendees
    }
  }

  const userEventSets = new Map<string, Set<number>>()
  for (const r of joinRows) {
    const k = r.user_id ?? r.display_name
    let s = userEventSets.get(k); if (!s) { s = new Set(); userEventSets.set(k, s) }
    s.add(r.event_id)
  }
  let repeatCount = 0
  for (const s of userEventSets.values()) if (s.size >= 2) repeatCount++
  const repeat_attendee_rate = unique_attendees > 0 ? round3(repeatCount / unique_attendees) : 0

  return { period, event_count, total_attendees, unique_attendees, avg_attendees_per_event, new_attendees, repeat_attendee_rate }
}

// ── Routes ────────────────────────────────────────────────────────

router.get('/events/:id/stats', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) return fail(res, 'Invalid event id', 400)
  try {
    const event = await getEventById(id)
    if (!event) return fail(res, 'Event not found', 404)
    ok(res, computeEventStats(await fetchPlayerEvents(id)))
  } catch (err: any) { fail(res, err.message) }
})

router.get('/events/:id/timeline', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) return fail(res, 'Invalid event id', 400)
  try {
    const event = await getEventById(id)
    if (!event) return fail(res, 'Event not found', 404)
    const events = await fetchPlayerEvents(id)
    ok(res, computeTimeline([...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))))
  } catch (err: any) { fail(res, err.message) }
})

router.get('/events/:id/rankings', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) return fail(res, 'Invalid event id', 400)
  try {
    const event = await getEventById(id)
    if (!event) return fail(res, 'Event not found', 404)
    const sortBy = req.query.sort === 'stay' ? 'stay' : 'attendance'
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined
    let rankings = computeUserRankings(await fetchPlayerEvents(id), sortBy as 'attendance' | 'stay')
    if (limit && limit > 0) rankings = rankings.slice(0, limit)
    ok(res, rankings)
  } catch (err: any) { fail(res, err.message) }
})

router.get('/rankings', async (req: Request, res: Response) => {
  try {
    const db = getDatabase()
    const sortBy = req.query.sort === 'stay' ? 'stay' : 'attendance'
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined
    const period = typeof req.query.period === 'string' ? req.query.period : undefined
    const brand = brandParam(req)

    const conds: string[] = []
    const args: any[] = []
    if (period) { conds.push('date LIKE ?'); args.push(`${period}%`) }
    if (brand) { conds.push('brand = ?'); args.push(brand) }
    const idsResult = await db.execute(
      conds.length > 0
        ? { sql: `SELECT id FROM events WHERE ${conds.join(' AND ')}`, args }
        : `SELECT id FROM events`
    )
    const eventIds = (idsResult.rows as any[]).map(r => r.id)
    if (eventIds.length === 0) return ok(res, [])

    const placeholders = eventIds.map(() => '?').join(',')
    const allEventsResult = await db.execute({
      sql: `SELECT pe.event_id, pe.user_id, pe.display_name, pe.event_type, pe.timestamp
            FROM player_events pe
            WHERE pe.event_id IN (${placeholders})
              AND pe.display_name NOT IN (SELECT display_name FROM users WHERE is_excluded = 1)
            ORDER BY pe.timestamp ASC`,
      args: eventIds,
    })

    let rankings = computeUserRankings(allEventsResult.rows as any[], sortBy)
    if (limit && limit > 0) rankings = rankings.slice(0, limit)
    ok(res, rankings)
  } catch (err: any) { fail(res, err.message) }
})

router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const db = getDatabase()
    const brand = brandParam(req)
    // brand 指定時は全集計をそのブランドのイベントに限定する
    const evWhere = brand ? ' WHERE brand = ?' : ''
    const peInEvents = brand ? ` AND event_id IN (SELECT id FROM events WHERE brand = ?)` : ''
    const sArgs = brand ? [brand] : []

    const totalEvents = ((await db.execute({ sql: `SELECT COUNT(*) as n FROM events${evWhere}`, args: sArgs })).rows[0] as any).n as number
    const totalVisits = ((await db.execute({ sql: `SELECT COUNT(*) as n FROM player_events WHERE event_type = 'join'${peInEvents}`, args: sArgs })).rows[0] as any).n as number
    const totalUniqueVisitors = ((await db.execute({ sql: `SELECT COUNT(DISTINCT display_name) as n FROM player_events WHERE event_type = 'join'${peInEvents}`, args: sArgs })).rows[0] as any).n as number
    const avgPerEvent = totalEvents > 0 ? Math.round((totalVisits / totalEvents) * 10) / 10 : 0

    const recentEventsResult = await db.execute({
      sql: `
      SELECT e.id, e.name, e.date, e.world_name, e.brand,
        COUNT(DISTINCT CASE WHEN pe.event_type = 'join' THEN pe.display_name END) as unique_visitors,
        COUNT(CASE WHEN pe.event_type = 'join' THEN 1 END) as total_visits
      FROM events e
      LEFT JOIN player_events pe ON pe.event_id = e.id
      ${brand ? 'WHERE e.brand = ?' : ''}
      GROUP BY e.id
      ORDER BY e.date DESC
      LIMIT 5
    `,
      args: sArgs,
    })

    const now = new Date()
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`

    const monthCond = brand ? ` AND brand = ?` : ''
    const hasCurrentMonth = (await db.execute({ sql: `SELECT 1 FROM events WHERE date LIKE ?${monthCond} LIMIT 1`, args: [`${currentMonth}%`, ...sArgs] })).rows.length > 0
    const hasPrevMonth = (await db.execute({ sql: `SELECT 1 FROM events WHERE date LIKE ?${monthCond} LIMIT 1`, args: [`${prevMonth}%`, ...sArgs] })).rows.length > 0

    const currentMonthStats = hasCurrentMonth ? await computePeriodStats(currentMonth, brand) : null
    const prevMonthStats = hasPrevMonth ? await computePeriodStats(prevMonth, brand) : null

    ok(res, {
      total_events: totalEvents, total_visits: totalVisits, total_unique_visitors: totalUniqueVisitors, avg_per_event: avgPerEvent,
      recent_events: recentEventsResult.rows, current_month: currentMonthStats, previous_month: prevMonthStats,
    })
  } catch (err: any) { fail(res, err.message) }
})

router.get('/period', async (req: Request, res: Response) => {
  const period = typeof req.query.period === 'string' ? req.query.period : null
  if (!period || !/^\d{4}(-\d{2})?$/.test(period)) return fail(res, 'period query parameter required (YYYY-MM or YYYY)', 400)
  try {
    ok(res, await computePeriodStats(period, brandParam(req)))
  } catch (err: any) { fail(res, err.message) }
})

router.get('/periods', async (req: Request, res: Response) => {
  try {
    const db = getDatabase()
    const brand = brandParam(req)
    const periodsResult = await db.execute(
      brand
        ? { sql: `SELECT DISTINCT substr(date, 1, 7) as period FROM events WHERE brand = ? ORDER BY period ASC`, args: [brand] }
        : `SELECT DISTINCT substr(date, 1, 7) as period FROM events ORDER BY period ASC`
    )
    const periods = (periodsResult.rows as any[]).map(r => r.period)
    const result = await Promise.all(periods.map(p => computePeriodStats(p, brand)))
    ok(res, result)
  } catch (err: any) { fail(res, err.message) }
})

const STAY_BUCKETS = [
  { bucket: '0〜15分', min: 0, max: 15 }, { bucket: '15〜30分', min: 15, max: 30 },
  { bucket: '30〜60分', min: 30, max: 60 }, { bucket: '1〜2時間', min: 60, max: 120 },
  { bucket: '2〜3時間', min: 120, max: 180 }, { bucket: '3時間以上', min: 180, max: Infinity },
]

async function computeDetailedStats(allEvents: RawPlayerEvent[], eventId: number): Promise<DetailedEventStats> {
  const empty: DetailedEventStats = { stay_distribution: [], arrival_timeline: [], departure_timeline: [], first_timer_count: 0, returner_count: 0, first_timer_rate: 0, early_leaver_count: 0, early_leaver_rate: 0, engagement_score: 0, engagement_breakdown: { stay_score: 0, retention_score: 0, activity_score: 0 } }
  // 詳細分析は除外ユーザーを落とす（同接以外は従来どおり）
  const rawEvents = allEvents.filter(e => !e.excluded)
  if (rawEvents.length === 0) return empty

  const sorted = [...rawEvents].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  const firstMs = new Date(sorted[0].timestamp).getTime()
  const lastMs = new Date(sorted[sorted.length - 1].timestamp).getTime()

  const pendingJoins = new Map<string, number[]>()
  const userStays = new Map<string, number[]>()
  const userFirstJoin = new Map<string, number>()

  for (const e of sorted) {
    const k = userKey(e)
    if (e.event_type === 'join') {
      const ms = new Date(e.timestamp).getTime()
      let q = pendingJoins.get(k); if (!q) { q = []; pendingJoins.set(k, q) }
      q.push(ms)
      if (!userFirstJoin.has(k)) userFirstJoin.set(k, ms)
    } else {
      const q = pendingJoins.get(k)
      if (q && q.length > 0) {
        const dur = (new Date(e.timestamp).getTime() - q.shift()!) / 60_000
        if (dur > 0 && dur <= 720) {
          let stays = userStays.get(k); if (!stays) { stays = []; userStays.set(k, stays) }
          stays.push(dur)
        }
        if (q.length === 0) pendingJoins.delete(k)
      }
    }
  }
  for (const [k, q] of pendingJoins) {
    for (const joinMs of q) {
      const dur = (lastMs - joinMs) / 60_000
      if (dur > 0 && dur <= 720) {
        let stays = userStays.get(k); if (!stays) { stays = []; userStays.set(k, stays) }
        stays.push(dur)
      }
    }
  }

  const userTotalStay = new Map<string, number>()
  for (const [k, stays] of userStays) userTotalStay.set(k, stays.reduce((a, b) => a + b, 0))
  const allDurations = Array.from(userTotalStay.values())

  const stay_distribution = STAY_BUCKETS.map(b => {
    const count = allDurations.filter(d => d >= b.min && d < b.max).length
    return { bucket: b.bucket, min_minutes: b.min, max_minutes: b.max === Infinity ? 999 : b.max, count, percentage: allDurations.length > 0 ? round1((count / allDurations.length) * 100) : 0 }
  })

  const joins = sorted.filter(e => e.event_type === 'join')
  const uniqueUserFirstJoin = new Map<string, number>()
  for (const e of joins) { const k = userKey(e); if (!uniqueUserFirstJoin.has(k)) uniqueUserFirstJoin.set(k, new Date(e.timestamp).getTime()) }

  const arrivalBuckets = new Map<number, number>()
  for (const [, joinMs] of uniqueUserFirstJoin) {
    const bucket = Math.floor(Math.floor((joinMs - firstMs) / 60_000) / 5) * 5
    arrivalBuckets.set(bucket, (arrivalBuckets.get(bucket) ?? 0) + 1)
  }
  let arrCumulative = 0
  const arrival_timeline = Array.from(arrivalBuckets.keys()).sort((a, b) => a - b).map(k => {
    arrCumulative += arrivalBuckets.get(k)!
    return { minutes_from_start: k, count: arrivalBuckets.get(k)!, cumulative: arrCumulative }
  })

  const leaves = sorted.filter(e => e.event_type === 'leave')
  const uniqueUserLastLeave = new Map<string, number>()
  for (const e of leaves) uniqueUserLastLeave.set(userKey(e), new Date(e.timestamp).getTime())
  const departureBuckets = new Map<number, number>()
  for (const [, leaveMs] of uniqueUserLastLeave) {
    const bucket = Math.floor(Math.floor((leaveMs - firstMs) / 60_000) / 5) * 5
    departureBuckets.set(bucket, (departureBuckets.get(bucket) ?? 0) + 1)
  }
  let deptCumulative = 0
  const departure_timeline = Array.from(departureBuckets.keys()).sort((a, b) => a - b).map(k => {
    deptCumulative += departureBuckets.get(k)!
    return { minutes_from_start: k, count: departureBuckets.get(k)!, cumulative: deptCumulative }
  })

  const db = getDatabase()
  const uniqueKeys = Array.from(uniqueUserFirstJoin.keys())
  let first_timer_count = 0, returner_count = 0

  if (uniqueKeys.length > 0) {
    const thisEventResult = await db.execute({ sql: 'SELECT date FROM events WHERE id = ?', args: [eventId] })
    const thisEvent = thisEventResult.rows[0] as any
    if (thisEvent) {
      const priorResult = await db.execute({ sql: 'SELECT id FROM events WHERE date < ? OR (date = ? AND id < ?)', args: [thisEvent.date, thisEvent.date, eventId] })
      const priorEventIds = (priorResult.rows as any[]).map(e => e.id)
      if (priorEventIds.length > 0) {
        const ph = priorEventIds.map(() => '?').join(',')
        const priorUsersResult = await db.execute({
          sql: `SELECT DISTINCT COALESCE(user_id, display_name) as key FROM player_events WHERE event_id IN (${ph}) AND event_type = 'join'`,
          args: priorEventIds,
        })
        const priorUsers = new Set((priorUsersResult.rows as any[]).map(r => r.key))
        for (const k of uniqueKeys) { if (priorUsers.has(k)) returner_count++; else first_timer_count++ }
      } else {
        first_timer_count = uniqueKeys.length
      }
    } else {
      first_timer_count = uniqueKeys.length
    }
  }

  const total = first_timer_count + returner_count
  const first_timer_rate = total > 0 ? round3(first_timer_count / total) : 0
  const early_leaver_count = allDurations.filter(d => d < 15).length
  const early_leaver_rate = allDurations.length > 0 ? round3(early_leaver_count / allDurations.length) : 0
  const avgStay = allDurations.length > 0 ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length : 0
  const stay_score = Math.min(100, Math.round((avgStay / 90) * 100))
  const retention_score = Math.round((1 - first_timer_rate) * 100)
  const activity_score = Math.max(0, Math.min(100, Math.round(100 - early_leaver_rate * 50)))
  const engagement_score = Math.round(stay_score * 0.4 + retention_score * 0.35 + activity_score * 0.25)

  return { stay_distribution, arrival_timeline, departure_timeline, first_timer_count, returner_count, first_timer_rate: round3(first_timer_rate), early_leaver_count, early_leaver_rate: round3(early_leaver_rate), engagement_score, engagement_breakdown: { stay_score, retention_score, activity_score } }
}

async function computeInsights(brand?: string): Promise<EventInsights> {
  const db = getDatabase()

  // brand 指定時はそのブランドのイベントだけで成長率・リテンション・コミュニティを計算する。
  // 週次イベントの「前回からの継続率」は同ブランド内で比較するほうが正確になる。
  const eventsResult = await db.execute(
    brand
      ? { sql: 'SELECT * FROM events WHERE brand = ? ORDER BY date ASC, start_time ASC', args: [brand] }
      : 'SELECT * FROM events ORDER BY date ASC, start_time ASC'
  )
  const events = eventsResult.rows as any[]
  if (events.length === 0) return emptyInsights()

  const eventAttendance: Array<{
    event_id: number; event_name: string; date: string
    attendees: Set<string>; total_joins: number
    peak_concurrent: number; avg_stay_duration: number
  }> = []

  for (const ev of events) {
    // 除外フラグも引く（同接は除外ユーザー込み、それ以外は除外）
    const rawResult = await db.execute({
      sql: `SELECT event_type, timestamp, COALESCE(user_id, display_name) as key,
              CASE WHEN display_name IN (SELECT display_name FROM users WHERE is_excluded = 1) THEN 1 ELSE 0 END AS excluded
            FROM player_events
            WHERE event_id = ?
            ORDER BY timestamp ASC`,
      args: [ev.id],
    })
    const rawAll = rawResult.rows as any[]                       // 除外込み（同接用）
    const raw = rawAll.filter(r => r.excluded !== 1)             // 除外後（分析用）
    const joins = raw.filter(r => r.event_type === 'join')
    const attendees = new Set<string>(joins.map(r => r.key))
    const total_joins = joins.length

    // peak concurrent: 在場集合サイズ（Set方式）・除外ユーザー込み＝会場の実在人数
    let peak_concurrent = 0
    const presentSet = new Set<string>()
    for (const r of rawAll) {
      if (r.event_type === 'join') presentSet.add(r.key)
      else presentSet.delete(r.key)
      if (presentSet.size > peak_concurrent) peak_concurrent = presentSet.size
    }

    // avg stay duration (minutes) — 分析指標なので除外後の raw を使う
    const lastMs = raw.length > 0 ? new Date(raw[raw.length - 1].timestamp).getTime() : 0
    const pending = new Map<string, number[]>()
    const durations: number[] = []
    for (const r of raw) {
      if (r.event_type === 'join') {
        let q = pending.get(r.key); if (!q) { q = []; pending.set(r.key, q) }
        q.push(new Date(r.timestamp).getTime())
      } else {
        const q = pending.get(r.key)
        if (q && q.length > 0) {
          const ms = new Date(r.timestamp).getTime() - q.shift()!
          if (ms > 0 && ms < 720 * 60_000) durations.push(ms / 60_000)
          if (q.length === 0) pending.delete(r.key)
        }
      }
    }
    for (const [, q] of pending) for (const joinMs of q) {
      const ms = lastMs - joinMs
      if (ms > 0 && ms < 720 * 60_000) durations.push(ms / 60_000)
    }
    const avg_stay_duration = durations.length > 0 ? round1(durations.reduce((s, d) => s + d, 0) / durations.length) : 0

    eventAttendance.push({ event_id: ev.id, event_name: ev.name, date: ev.date, attendees, total_joins, peak_concurrent, avg_stay_duration })
  }

  let growth_rate = 0, growth_trend: 'growing' | 'stable' | 'declining' = 'stable'
  if (eventAttendance.length >= 3) {
    const recent = eventAttendance.slice(-3), older = eventAttendance.slice(-6, -3)
    if (older.length > 0) {
      const recentAvg = recent.reduce((s, e) => s + e.attendees.size, 0) / recent.length
      const olderAvg = older.reduce((s, e) => s + e.attendees.size, 0) / older.length
      growth_rate = olderAvg > 0 ? round1(((recentAvg - olderAvg) / olderAvg) * 100) : 0
      if (growth_rate > 10) growth_trend = 'growing'; else if (growth_rate < -10) growth_trend = 'declining'
    }
  } else if (eventAttendance.length >= 2) {
    const first = eventAttendance[0].attendees.size, last = eventAttendance[eventAttendance.length - 1].attendees.size
    growth_rate = first > 0 ? round1(((last - first) / first) * 100) : 0
    if (growth_rate > 10) growth_trend = 'growing'; else if (growth_rate < -10) growth_trend = 'declining'
  }

  const retention_by_event: EventInsights['retention_by_event'] = []
  let totalReturning = 0, totalRetentionDenom = 0

  for (let i = 0; i < eventAttendance.length; i++) {
    const curr = eventAttendance[i]
    if (i === 0) { retention_by_event.push({ event_id: curr.event_id, event_name: curr.event_name, date: curr.date, attendees: curr.attendees.size, returning_from_prev: 0, retention_rate: 0, new_attendees: curr.attendees.size }); continue }
    const prev = eventAttendance[i - 1]
    let returning = 0
    for (const k of curr.attendees) if (prev.attendees.has(k)) returning++
    const retRate = prev.attendees.size > 0 ? round3(returning / prev.attendees.size) : 0
    totalReturning += returning; totalRetentionDenom += prev.attendees.size
    const allPrior = new Set<string>()
    for (let j = 0; j < i; j++) for (const k of eventAttendance[j].attendees) allPrior.add(k)
    let newCount = 0
    for (const k of curr.attendees) if (!allPrior.has(k)) newCount++
    retention_by_event.push({ event_id: curr.event_id, event_name: curr.event_name, date: curr.date, attendees: curr.attendees.size, returning_from_prev: returning, retention_rate: retRate, new_attendees: newCount })
  }

  const overall_retention_rate = totalRetentionDenom > 0 ? round3(totalReturning / totalRetentionDenom) : 0

  // Build attendance_history with merged retention data
  const attendance_history = eventAttendance.map((ea, i) => {
    const ret = retention_by_event[i]
    return {
      event_id: ea.event_id, event_name: ea.event_name, date: ea.date,
      unique_attendees: ea.attendees.size, total_joins: ea.total_joins,
      peak_concurrent: ea.peak_concurrent, avg_stay_duration: ea.avg_stay_duration,
      new_attendees: ret?.new_attendees ?? ea.attendees.size,
      returning_attendees: ret?.returning_from_prev ?? 0,
      retention_rate: ret?.retention_rate ?? 0,
    }
  })

  const totalEvents = eventAttendance.length
  const userEventCount = new Map<string, number>()
  const userLastEventIdx = new Map<string, number>()
  for (let i = 0; i < eventAttendance.length; i++) for (const k of eventAttendance[i].attendees) { userEventCount.set(k, (userEventCount.get(k) ?? 0) + 1); userLastEventIdx.set(k, i) }

  let core_count = 0, regular_count = 0, casual_count = 0, onetime_count = 0, churned_count = 0
  const lastIdx = totalEvents - 1, churnThreshold = Math.min(3, totalEvents)
  for (const [k, count] of userEventCount) {
    const lastSeen = userLastEventIdx.get(k) ?? 0
    const rate = count / totalEvents
    const isChurned = totalEvents > 3 && lastSeen < lastIdx - churnThreshold + 1
    if (isChurned && count > 1) churned_count++
    else if (count === 1) onetime_count++
    else if (rate >= 0.5) core_count++
    else if (rate >= 0.25) regular_count++
    else casual_count++
  }

  const community = { core_count, regular_count, casual_count, onetime_count, churned_count, total_known: userEventCount.size }
  const avgAtt = eventAttendance.reduce((s, e) => s + e.attendees.size, 0) / totalEvents
  const peakAtt = Math.max(...eventAttendance.map(e => e.attendees.size), 1)
  const growthScore = Math.max(0, Math.min(100, growth_trend === 'growing' ? Math.min(100, 60 + growth_rate) : growth_trend === 'declining' ? Math.max(0, 40 + growth_rate) : 50))
  const retentionScore = Math.round(overall_retention_rate * 100)
  const engagementScore = Math.round((avgAtt / peakAtt) * 100)
  const communityTotal = userEventCount.size || 1
  const communityScore = Math.round(((core_count * 3 + regular_count * 2 + casual_count) / (communityTotal * 3)) * 100)
  const health_score = Math.round(growthScore * 0.25 + retentionScore * 0.3 + engagementScore * 0.2 + communityScore * 0.25)
  let health_grade: EventInsights['health_grade'] = 'C'
  if (health_score >= 80) health_grade = 'S'; else if (health_score >= 65) health_grade = 'A'; else if (health_score >= 50) health_grade = 'B'; else if (health_score >= 35) health_grade = 'C'; else health_grade = 'D'

  const recommendations: EventInsights['recommendations'] = []
  if (growth_trend === 'declining') recommendations.push({ category: 'growth', priority: 'high', icon: '📉', title: '参加者数が減少傾向です', description: `直近のイベントでは参加者が${Math.abs(growth_rate).toFixed(0)}%減少しています。`, metric: `成長率: ${growth_rate > 0 ? '+' : ''}${growth_rate.toFixed(1)}%`, suggestion: '新規参加者の獲得施策（SNS告知の強化、コラボイベント等）を検討しましょう。' })
  else if (growth_trend === 'growing') recommendations.push({ category: 'growth', priority: 'low', icon: '📈', title: '参加者数が成長しています！', description: `直近のイベントで参加者が${growth_rate.toFixed(0)}%増加しています。`, metric: `成長率: +${growth_rate.toFixed(1)}%`, suggestion: '成長を維持するため、新規参加者のフォローアップと定着施策に注力しましょう。' })
  if (overall_retention_rate < 0.3 && eventAttendance.length >= 3) recommendations.push({ category: 'retention', priority: 'high', icon: '🔄', title: 'リテンション率が低いです', description: `前回イベントの参加者のうち${(overall_retention_rate * 100).toFixed(0)}%しか次回に戻ってきていません。`, metric: `リテンション率: ${(overall_retention_rate * 100).toFixed(1)}%`, suggestion: 'イベント後のコミュニケーションを強化しましょう。' })
  else if (overall_retention_rate >= 0.5) recommendations.push({ category: 'retention', priority: 'low', icon: '🔄', title: 'リテンション率が良好です', description: `${(overall_retention_rate * 100).toFixed(0)}%の参加者が継続して参加しています。`, metric: `リテンション率: ${(overall_retention_rate * 100).toFixed(1)}%` })
  if (onetime_count > communityTotal * 0.6 && eventAttendance.length >= 3) recommendations.push({ category: 'community', priority: 'high', icon: '👥', title: '一度きりの参加者が多いです', description: `全参加者の${((onetime_count / communityTotal) * 100).toFixed(0)}%が一度しか参加していません。`, metric: `1回のみ参加: ${onetime_count}人 / ${communityTotal}人`, suggestion: '初参加者が居心地よく感じる工夫を導入しましょう。' })
  if (churned_count > 0 && eventAttendance.length >= 4) recommendations.push({ category: 'community', priority: 'medium', icon: '💤', title: '離脱した常連がいます', description: `${churned_count}人の参加者が最近のイベントに来なくなりました。`, metric: `離脱者: ${churned_count}人`, suggestion: '離脱した方に個別メッセージで次回イベントをお知らせしてみましょう。' })
  if (core_count >= 3) recommendations.push({ category: 'community', priority: 'low', icon: '⭐', title: 'コアメンバーがいます', description: `${core_count}人が半数以上のイベントに参加しています。`, metric: `コアメンバー: ${core_count}人`, suggestion: 'コアメンバーにスタッフや運営協力をお願いしましょう。' })
  if (eventAttendance.length >= 2) {
    const sizes = eventAttendance.map(e => e.attendees.size)
    const cv = Math.sqrt(sizes.reduce((s, v) => s + Math.pow(v - avgAtt, 2), 0) / sizes.length) / avgAtt
    if (cv > 0.4) recommendations.push({ category: 'timing', priority: 'medium', icon: '📊', title: '参加者数のばらつきが大きいです', description: `イベントごとの参加者数に大きな差があります（${Math.min(...sizes)}〜${Math.max(...sizes)}人）。`, metric: `変動係数: ${(cv * 100).toFixed(0)}%`, suggestion: '曜日や時間帯を固定してみましょう。' })
  }
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

  return { health_score, health_grade, health_components: { growth: growthScore, retention: retentionScore, engagement: engagementScore, community: communityScore }, growth_trend, growth_rate, attendance_history, overall_retention_rate, retention_by_event, community, recommendations }
}

function emptyInsights(): EventInsights {
  return { health_score: 0, health_grade: 'D', health_components: { growth: 0, retention: 0, engagement: 0, community: 0 }, growth_trend: 'stable', growth_rate: 0, attendance_history: [], overall_retention_rate: 0, retention_by_event: [], community: { core_count: 0, regular_count: 0, casual_count: 0, onetime_count: 0, churned_count: 0, total_known: 0 }, recommendations: [] }
}
// Note: attendance_history items now include peak_concurrent, avg_stay_duration, new_attendees, returning_attendees, retention_rate

router.get('/events/:id/detailed', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) return fail(res, 'Invalid event id', 400)
  try {
    const event = await getEventById(id)
    if (!event) return fail(res, 'Event not found', 404)
    ok(res, await computeDetailedStats(await fetchPlayerEvents(id), id))
  } catch (err: any) { fail(res, err.message) }
})

router.get('/insights', async (req: Request, res: Response) => {
  try {
    const brand = typeof req.query.brand === 'string' && req.query.brand.trim() ? req.query.brand.trim() : undefined
    ok(res, await computeInsights(brand))
  } catch (err: any) { fail(res, err.message) }
})

// ── ブランド比較 ───────────────────────────────────────────────────
// ブランド（clubVERSE / theALL / VERSARY...）ごとの集計を横並びで返す。
// 未分類イベントは brand='' として1グループにまとめる。
export interface BrandComparisonItem {
  brand: string             // '' = 未分類
  event_count: number
  first_date: string
  last_date: string
  avg_attendees: number     // 1回あたり平均ユニーク参加者
  max_attendees: number
  total_attendees: number   // 延べ（イベント×人）
  unique_users: number      // ブランド全体のユニーク参加者
  repeat_rate: number       // ブランド内で2回以上参加した人の割合
}

router.get('/brand-comparison', async (_req: Request, res: Response) => {
  try {
    const db = getDatabase()
    const events = (await db.execute('SELECT id, brand, date FROM events')).rows as any[]
    if (events.length === 0) return ok(res, [])

    const joins = (await db.execute(
      `SELECT pe.event_id, COALESCE(pe.user_id, pe.display_name) as key
       FROM player_events pe
       WHERE pe.event_type = 'join'
         AND pe.display_name NOT IN (SELECT display_name FROM users WHERE is_excluded = 1)`
    )).rows as any[]

    // event_id → brand ('' = 未分類)
    const evBrand = new Map<number, string>()
    const evDate = new Map<number, string>()
    for (const e of events) {
      evBrand.set(e.id as number, (e.brand as string) ?? '')
      evDate.set(e.id as number, e.date as string)
    }

    // brand → { eventId → Set<userKey> }
    const groups = new Map<string, Map<number, Set<string>>>()
    for (const e of events) {
      const b = (e.brand as string) ?? ''
      if (!groups.has(b)) groups.set(b, new Map())
      groups.get(b)!.set(e.id as number, new Set())
    }
    for (const j of joins) {
      const b = evBrand.get(j.event_id as number)
      if (b === undefined) continue
      groups.get(b)!.get(j.event_id as number)!.add(String(j.key))
    }

    const result: BrandComparisonItem[] = []
    for (const [b, perEvent] of groups) {
      const eventIds = Array.from(perEvent.keys())
      const dates = eventIds.map(id => evDate.get(id)!).sort()
      const sizes = eventIds.map(id => perEvent.get(id)!.size)
      const total = sizes.reduce((a, b) => a + b, 0)
      const userEvents = new Map<string, number>()
      for (const attendees of perEvent.values()) {
        for (const k of attendees) userEvents.set(k, (userEvents.get(k) ?? 0) + 1)
      }
      let repeaters = 0
      for (const c of userEvents.values()) if (c >= 2) repeaters++
      result.push({
        brand: b,
        event_count: eventIds.length,
        first_date: dates[0] ?? '',
        last_date: dates[dates.length - 1] ?? '',
        avg_attendees: eventIds.length > 0 ? round1(total / eventIds.length) : 0,
        max_attendees: sizes.length > 0 ? Math.max(...sizes) : 0,
        total_attendees: total,
        unique_users: userEvents.size,
        repeat_rate: userEvents.size > 0 ? round3(repeaters / userEvents.size) : 0,
      })
    }

    // イベント数の多い順、未分類は最後
    result.sort((a, b) => (a.brand === '' ? 1 : 0) - (b.brand === '' ? 1 : 0) || b.event_count - a.event_count)
    ok(res, result)
  } catch (err: any) { fail(res, err.message) }
})

// ── 開催形態比較 ───────────────────────────────────────────────────
// 開催形態（手動の format > ログ由来の access_type）ごとの集計を横並びで返す。
// Group Only / Group+ / 事前申請制 などで集客がどう変わるかを比較する。
// ?brand= でブランド内に絞った比較も可能（グローバル絞り込みに追従）。
router.get('/format-comparison', async (req: Request, res: Response) => {
  try {
    const db = getDatabase()
    const brand = brandParam(req)
    const events = (await db.execute(
      brand
        ? { sql: 'SELECT id, format, access_type, date FROM events WHERE brand = ?', args: [brand] }
        : 'SELECT id, format, access_type, date FROM events'
    )).rows as any[]
    if (events.length === 0) return ok(res, [])

    const eventIds = events.map(e => e.id)
    const ph = eventIds.map(() => '?').join(',')
    const joins = (await db.execute({
      sql: `SELECT pe.event_id, COALESCE(pe.user_id, pe.display_name) as key
            FROM player_events pe
            WHERE pe.event_type = 'join' AND pe.event_id IN (${ph})
              AND pe.display_name NOT IN (SELECT display_name FROM users WHERE is_excluded = 1)`,
      args: eventIds,
    })).rows as any[]

    // 形態キー: 手動 format 優先、なければ access_type、どちらも無ければ '不明'
    const formatOf = (e: any) => (e.format as string) || (e.access_type as string) || '不明'
    const evFormat = new Map<number, string>()
    for (const e of events) evFormat.set(e.id as number, formatOf(e))

    const groups = new Map<string, Map<number, Set<string>>>()
    for (const e of events) {
      const f = formatOf(e)
      if (!groups.has(f)) groups.set(f, new Map())
      groups.get(f)!.set(e.id as number, new Set())
    }
    for (const j of joins) {
      const f = evFormat.get(j.event_id as number)
      if (f === undefined) continue
      groups.get(f)!.get(j.event_id as number)!.add(String(j.key))
    }

    const result = []
    for (const [format, perEvent] of groups) {
      const sizes = Array.from(perEvent.values()).map(s => s.size)
      const total = sizes.reduce((a, b) => a + b, 0)
      const userEvents = new Map<string, number>()
      for (const attendees of perEvent.values()) for (const k of attendees) userEvents.set(k, (userEvents.get(k) ?? 0) + 1)
      let repeaters = 0
      for (const c of userEvents.values()) if (c >= 2) repeaters++
      result.push({
        format,
        event_count: perEvent.size,
        avg_attendees: perEvent.size > 0 ? round1(total / perEvent.size) : 0,
        max_attendees: sizes.length > 0 ? Math.max(...sizes) : 0,
        total_attendees: total,
        unique_users: userEvents.size,
        repeat_rate: userEvents.size > 0 ? round3(repeaters / userEvents.size) : 0,
      })
    }
    result.sort((a, b) => b.event_count - a.event_count)
    ok(res, result)
  } catch (err: any) { fail(res, err.message) }
})

// ブランド別の参加者推移（重ね描きチャート用）。
// 各ブランドについて、イベントごとの {date, event_name, unique_attendees} を時系列で返す。
router.get('/brand-trends', async (_req: Request, res: Response) => {
  try {
    const db = getDatabase()
    const events = (await db.execute(
      `SELECT id, name, date, brand FROM events WHERE brand IS NOT NULL AND brand != '' ORDER BY date ASC`
    )).rows as any[]
    if (events.length === 0) return ok(res, [])

    const joins = (await db.execute(
      `SELECT pe.event_id, COALESCE(pe.user_id, pe.display_name) as key
       FROM player_events pe
       WHERE pe.event_type = 'join'
         AND pe.display_name NOT IN (SELECT display_name FROM users WHERE is_excluded = 1)`
    )).rows as any[]

    const perEvent = new Map<number, Set<string>>()
    for (const e of events) perEvent.set(e.id as number, new Set())
    for (const j of joins) {
      const s = perEvent.get(j.event_id as number)
      if (s) s.add(String(j.key))
    }

    const byBrand = new Map<string, { date: string; event_name: string; unique_attendees: number }[]>()
    for (const e of events) {
      const b = e.brand as string
      if (!byBrand.has(b)) byBrand.set(b, [])
      byBrand.get(b)!.push({
        date: e.date as string,
        event_name: e.name as string,
        unique_attendees: perEvent.get(e.id as number)!.size,
      })
    }

    ok(res, Array.from(byBrand.entries()).map(([brand, points]) => ({ brand, points })))
  } catch (err: any) { fail(res, err.message) }
})

export default router
