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
      return ok(res, { shared_event_id: sharedEventId, event_count: 0, unique_attendees: 0, total_joins: 0, peak_concurrent: 0, sessions: [] })
    }
    const ids = evs.map(e => e.id)
    const ph = ids.map(() => '?').join(',')
    // join/leave 両方を時系列で引く（ピーク同接の算出に leave が要る）。
    // 除外ユーザー(is_excluded=1=主催/スタッフ/出演者)も行ごと引いて excluded フラグを付ける。
    // 同接(peak_concurrent)は会場の実在人数なので除外ユーザーも数える。
    // ただし unique_attendees / total_joins は分析指標なので除外ユーザーを除く。
    const rows = (await db.execute({
      sql: `SELECT event_id, COALESCE(user_id, display_name) as key, event_type,
              CASE WHEN display_name IN (SELECT display_name FROM users WHERE is_excluded = 1) THEN 1 ELSE 0 END AS excluded
            FROM player_events
            WHERE event_type IN ('join','leave') AND event_id IN (${ph})
            ORDER BY timestamp ASC`,
      args: ids,
    })).rows as any[]

    const all = new Set<string>()                          // 除外後ユニーク（分析）
    const perEvent = new Map<number, Set<string>>()        // 除外後ユニーク来場（分析）
    const present = new Map<number, Set<string>>()         // いま在場（除外ユーザー込み＝実在人数）
    const peak = new Map<number, number>()                  // セッション別ピーク同接（除外込み）
    const joinsPerEvent = new Map<number, number>()         // セッション別の延べ入場（join数・除外後）
    let totalJoins = 0
    for (const id of ids) { perEvent.set(id, new Set()); present.set(id, new Set()); peak.set(id, 0); joinsPerEvent.set(id, 0) }
    for (const r of rows) {
      const eid = r.event_id as number, k = String(r.key)
      const excluded = r.excluded === 1
      if (r.event_type === 'join') {
        // 同接側（除外込み）
        const p = present.get(eid)!
        p.add(k)
        if (p.size > peak.get(eid)!) peak.set(eid, p.size)
        // 分析側（除外後）
        if (!excluded) {
          totalJoins++
          joinsPerEvent.set(eid, (joinsPerEvent.get(eid) ?? 0) + 1)
          all.add(k); perEvent.get(eid)?.add(k)
        }
      } else {
        present.get(eid)?.delete(k)
      }
    }

    ok(res, {
      shared_event_id: sharedEventId,
      event_count: evs.length,
      unique_attendees: all.size,           // エディション全体の延べ重複なしユニーク
      total_joins: totalJoins,              // エディション全体の延べ入場
      peak_concurrent: Math.max(0, ...peak.values()),   // 期間中の最大同時在場
      sessions: evs.map(e => ({
        id: e.id, name: e.name, date: e.date,
        unique_attendees: perEvent.get(e.id)!.size,
        total_joins: joinsPerEvent.get(e.id)!,
        peak_concurrent: peak.get(e.id)!,
      })),
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
