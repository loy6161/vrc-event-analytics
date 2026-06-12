import { Router, Request, Response } from 'express'
import { getDatabase } from '../db/schema.js'
import { fetchSharedEvents, matchEditionForDate } from '../services/shared-events.js'
import { getEvents, setEventSharedId } from '../db/queries.js'

const router = Router()

function ok<T>(res: Response, data: T) { res.json({ success: true, data, timestamp: new Date().toISOString() }) }
function fail(res: Response, message: string, status = 500) {
  res.status(status).json({ success: false, error: message, timestamp: new Date().toISOString() })
}

// GET /api/ledger/events — 共有イベント台帳（読み取り専用プロキシ）
router.get('/events', async (req: Request, res: Response) => {
  try {
    ok(res, await fetchSharedEvents(req.query.force === '1'))
  } catch (err: any) { fail(res, err.message) }
})

// GET /api/ledger/events/:id/vrc-summary
// 台帳エディション(shared_event_id)に紐づくVRChat来場サマリ。Hub横断レポート(E5)が叩く。
router.get('/events/:id/vrc-summary', async (req: Request, res: Response) => {
  try {
    const sharedEventId = req.params.id
    const db = getDatabase()
    const evs = (await db.execute({
      sql: 'SELECT id, name, date FROM events WHERE shared_event_id = ? ORDER BY date',
      args: [sharedEventId],
    })).rows as any[]
    if (evs.length === 0) {
      return ok(res, { shared_event_id: sharedEventId, event_count: 0, unique_attendees: 0, total_joins: 0, sessions: [] })
    }
    const ids = evs.map(e => e.id)
    const ph = ids.map(() => '?').join(',')
    const joins = (await db.execute({
      sql: `SELECT event_id, COALESCE(user_id, display_name) as key
            FROM player_events
            WHERE event_type = 'join' AND event_id IN (${ph})
              AND display_name NOT IN (SELECT display_name FROM users WHERE is_excluded = 1)`,
      args: ids,
    })).rows as any[]

    const all = new Set<string>()
    const perEvent = new Map<number, Set<string>>()
    for (const id of ids) perEvent.set(id, new Set())
    for (const j of joins) { all.add(String(j.key)); perEvent.get(j.event_id as number)?.add(String(j.key)) }

    ok(res, {
      shared_event_id: sharedEventId,
      event_count: evs.length,
      unique_attendees: all.size,           // エディション全体の延べ重複なしユニーク
      total_joins: joins.length,
      sessions: evs.map(e => ({ id: e.id, name: e.name, date: e.date, unique_attendees: perEvent.get(e.id)!.size })),
    })
  } catch (err: any) { fail(res, err.message) }
})

// POST /api/ledger/sync — 全イベントに台帳スラッグを日付照合で一括付与（バックフィル/修復）
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    const ledger = await fetchSharedEvents(true)
    const events = await getEvents()
    let linked = 0, cleared = 0
    for (const e of events) {
      const ed = matchEditionForDate(ledger, e.date)
      const next = ed?.id ?? null
      if ((e.shared_event_id ?? null) !== next) {
        await setEventSharedId(e.id, next)
        next ? linked++ : cleared++
      }
    }
    ok(res, { total: events.length, linked, cleared })
  } catch (err: any) { fail(res, err.message) }
})

export default router
