import { Router, Request, Response } from 'express'
import {
  getEvents,
  getEventById,
  createEvent,
  updateEvent,
  deleteEvent,
  mergeEvents,
  getPlayerEventsByEventId,
  deletePlayerEventsByEventId,
} from '../db/queries.js'

const router = Router()

function ok<T>(res: Response, data: T, status = 200) {
  res.status(status).json({ success: true, data, timestamp: new Date().toISOString() })
}

function fail(res: Response, message: string, status = 500) {
  res.status(status).json({ success: false, error: message, timestamp: new Date().toISOString() })
}

function parseId(param: string): number | null {
  const id = parseInt(param, 10)
  return isNaN(id) ? null : id
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    ok(res, await getEvents())
  } catch (err: any) {
    fail(res, err.message)
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) return fail(res, 'Invalid event id', 400)
  try {
    const event = await getEventById(id)
    if (!event) return fail(res, 'Event not found', 404)
    ok(res, event)
  } catch (err: any) {
    fail(res, err.message)
  }
})

router.get('/:id/player-events', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) return fail(res, 'Invalid event id', 400)
  try {
    const event = await getEventById(id)
    if (!event) return fail(res, 'Event not found', 404)
    ok(res, await getPlayerEventsByEventId(id))
  } catch (err: any) {
    fail(res, err.message)
  }
})

router.post('/', async (req: Request, res: Response) => {
  const { name, date, start_time, end_time, world_id, instance_id, world_name, region, access_type, description, tags } = req.body
  if (!name || typeof name !== 'string') return fail(res, 'name is required', 400)
  if (!date || typeof date !== 'string') return fail(res, 'date is required (YYYY-MM-DD)', 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(res, 'date must be YYYY-MM-DD format', 400)
  try {
    const event = await createEvent({ name, date, start_time, end_time, world_id, instance_id, world_name, region, access_type, description, tags })
    ok(res, event, 201)
  } catch (err: any) {
    fail(res, err.message)
  }
})

router.put('/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) return fail(res, 'Invalid event id', 400)
  const { name, date, start_time, end_time, world_id, instance_id, world_name, region, access_type, description, tags } = req.body
  if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return fail(res, 'date must be YYYY-MM-DD format', 400)
  }
  try {
    const event = await updateEvent(id, { name, date, start_time, end_time, world_id, instance_id, world_name, region, access_type, description, tags })
    if (!event) return fail(res, 'Event not found', 404)
    ok(res, event)
  } catch (err: any) {
    fail(res, err.message)
  }
})

router.post('/merge', async (req: Request, res: Response) => {
  const { targetId, sourceIds } = req.body
  if (!targetId || !Array.isArray(sourceIds) || sourceIds.length === 0) {
    return fail(res, 'targetId と sourceIds[] が必要です', 400)
  }
  const target = parseId(String(targetId))
  if (target === null) return fail(res, 'targetId が不正です', 400)
  const sources = (sourceIds as any[]).map(id => parseId(String(id))).filter((id): id is number => id !== null)
  if (sources.length === 0) return fail(res, '有効な sourceIds がありません', 400)
  try {
    const event = await mergeEvents(target, sources)
    if (!event) return fail(res, 'ターゲットイベントが見つかりません', 404)
    ok(res, event)
  } catch (err: any) {
    fail(res, err.message)
  }
})

router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) return fail(res, 'Invalid event id', 400)
  try {
    await deletePlayerEventsByEventId(id)
    const deleted = await deleteEvent(id)
    if (!deleted) return fail(res, 'Event not found', 404)
    ok(res, { id })
  } catch (err: any) {
    fail(res, err.message)
  }
})

export default router
