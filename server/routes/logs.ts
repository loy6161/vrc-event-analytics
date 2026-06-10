import express, { Router, Request, Response } from 'express'
const expressText = express.text
import fs from 'fs'
import path from 'path'
import {
  parseLogFile,
  parseLogContent,
  segmentIntoSessions,
  getDefaultLogDirectory,
  listLogFiles,
  logicalDate,
  type ParsedPlayerEvent,
  type WorldSession,
} from '../services/log-parser.js'
import {
  createEvent,
  getEventById,
  findEventByDate,
  updateEvent,
  recomputeEventTimespan,
  isLogImported,
  recordImportedLog,
  getImportedLogs,
  deleteImportedLog,
  insertPlayerEventsBatch,
  upsertUsersBatch,
  recordDisplayNameHistoryBatch,
  type InsertPlayerEventInput,
  type UpsertUserInput,
} from '../db/queries.js'

const router = Router()

// ── Shared DB save logic ──────────────────────────────────────────
// Used by both /parse (server-side parsing) and /import-parsed (client-side parsing).
// Takes segmented world sessions + file metadata, runs find-or-create per logical day,
// inserts player_events, upserts users, records display name history.

interface SaveSessionsResult {
  createdEvents: { id: number; name: string; date: string; worldName?: string; merged?: boolean }[]
  totalInserted: number
  usersUpserted: number
}

async function saveSessionsToDB(
  sessions: WorldSession[],
  fileName: string,
  cutoffHour: number,
  mainWorld: string,
): Promise<SaveSessionsResult> {
  const norm = (s?: string) => (s ?? '').toLowerCase()
  const matchesMain = (name?: string) => !!mainWorld && norm(name).includes(norm(mainWorld))
  const uniqueCount = (s: WorldSession) => new Set(s.playerEvents.map(e => e.displayName)).size

  const byDay = new Map<string, WorldSession[]>()
  for (const session of sessions) {
    if (session.playerEvents.length === 0) continue
    const day = logicalDate(session.startTime, cutoffHour)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day)!.push(session)
  }

  const createdEvents: SaveSessionsResult['createdEvents'] = []
  let totalInserted = 0

  for (const [day, daySessions] of byDay) {
    const dayPlayerEvents = daySessions.flatMap(s => s.playerEvents)
    const named = daySessions.filter(s => s.worldName)
    const rep =
      named.find(s => matchesMain(s.worldName)) ??
      [...named].sort((a, b) => uniqueCount(b) - uniqueCount(a))[0] ??
      daySessions[0]
    const worldCount = new Set(daySessions.map(s => s.worldId).filter(Boolean)).size
    const startTime = daySessions[0].startTime.slice(11, 16)
    const endTime = daySessions[daySessions.length - 1].endTime.slice(11, 16)
    const eventName = rep.worldName
      ? (worldCount > 1
          ? `${rep.worldName} 他${worldCount - 1}ワールド (${day})`
          : `${rep.worldName} (${day})`)
      : `イベント ${day}`

    let target = await findEventByDate(day)
    let merged = false
    if (target) {
      merged = true
      if (matchesMain(rep.worldName) && !matchesMain(target.world_name)) {
        target = (await updateEvent(target.id, {
          name: eventName, world_id: rep.worldId, world_name: rep.worldName,
          instance_id: rep.instanceId, region: rep.region, access_type: rep.accessType,
        }))!
      }
    } else {
      target = await createEvent({
        name: eventName, date: day, start_time: startTime, end_time: endTime,
        world_id: rep.worldId, world_name: rep.worldName,
        instance_id: rep.instanceId, region: rep.region, access_type: rep.accessType,
      })
    }

    createdEvents.push({ id: target.id, name: target.name, date: target.date, worldName: target.world_name, merged })

    const insertInputs: InsertPlayerEventInput[] = dayPlayerEvents.map(pe => ({
      event_id: target!.id,
      user_id: (pe as any).userId ?? undefined,
      display_name: pe.displayName,
      event_type: pe.type,
      timestamp: pe.timestamp,
      log_file: fileName,
    }))
    totalInserted += await insertPlayerEventsBatch(insertInputs)
    await recomputeEventTimespan(target!.id)
  }

  // Collect unique players
  const allPlayerEvents = sessions.flatMap(s => s.playerEvents)
  const playerMap = new Map<string, { userId?: string; displayName: string; firstSeen: string }>()
  for (const pe of allPlayerEvents) {
    const key = (pe as any).userId ?? pe.displayName
    if (!playerMap.has(key)) {
      playerMap.set(key, { userId: (pe as any).userId, displayName: pe.displayName, firstSeen: pe.timestamp })
    }
  }
  const userInputs: UpsertUserInput[] = Array.from(playerMap.values()).map(p => ({
    user_id: p.userId, display_name: p.displayName, first_seen: p.firstSeen,
  }))
  await upsertUsersBatch(userInputs)

  const now = new Date().toISOString()
  await recordDisplayNameHistoryBatch(
    userInputs.map(({ user_id, display_name }) => ({ user_id: user_id ?? null, display_name, seen_at: now }))
  )

  return { createdEvents, totalInserted, usersUpserted: userInputs.length }
}

// ── Helpers ──────────────────────────────────────────────────────

function ok<T>(res: Response, data: T, status = 200) {
  res.status(status).json({ success: true, data, timestamp: new Date().toISOString() })
}

function fail(res: Response, message: string, status = 500) {
  res.status(status).json({ success: false, error: message, timestamp: new Date().toISOString() })
}

// ── Routes ───────────────────────────────────────────────────────

/**
 * GET /api/logs
 * List all imported log files with their metadata.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    ok(res, await getImportedLogs())
  } catch (err: any) {
    fail(res, err.message)
  }
})

/**
 * GET /api/logs/files
 * List available VRChat log files from the default directory.
 * Includes import status for each file (already imported or not).
 *
 * Query params:
 *   dir  - optional custom directory path
 */
router.get('/files', async (req: Request, res: Response) => {
  try {
    const dir = typeof req.query.dir === 'string' ? req.query.dir : getDefaultLogDirectory()

    if (!fs.existsSync(dir)) {
      return ok(res, { directory: dir, exists: false, files: [] })
    }

    const filePaths = listLogFiles(dir)
    const importedLogs = await getImportedLogs()
    const importedNames = new Set(importedLogs.map(l => l.file_name))

    const files = filePaths.map(fp => {
      const name = path.basename(fp)
      const stat = fs.statSync(fp)
      return {
        name,
        path: fp,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        imported: importedNames.has(name),
      }
    })

    ok(res, { directory: dir, exists: true, files })
  } catch (err: any) {
    fail(res, err.message)
  }
})

/**
 * POST /api/logs/parse
 *
 * 2つの呼び出し方をサポート:
 *
 * A) text/plain ストリーム (推奨・低メモリ):
 *    Content-Type: text/plain
 *    body: ログファイルの生テキスト
 *    query: fileName, force, eventId
 *
 * B) application/json (後方互換):
 *    body: { filePath?, fileContent?, fileName?, eventId?, force? }
 */
router.post(
  '/parse',
  expressText({ type: 'text/plain', limit: '500mb' }),
  async (req: Request, res: Response) => {

  // ── Detect call format ────────────────────────────────────────
  const isTextUpload = typeof req.body === 'string'

  let fileContent: string | undefined
  let filePath: string | undefined
  let fileName: string | undefined
  let eventId: any
  let force: boolean

  if (isTextUpload) {
    // A) text/plain upload
    fileContent = req.body as string
    fileName = typeof req.query.fileName === 'string' ? req.query.fileName : 'output_log.txt'
    eventId = req.query.eventId
    force = req.query.force === 'true'
  } else {
    // B) legacy JSON body
    fileContent = req.body?.fileContent
    filePath = req.body?.filePath
    fileName = req.body?.fileName
    eventId = req.body?.eventId
    force = req.body?.force ?? false
  }

  // 深夜の区切り時刻（既定: 翌朝6時まで前日のイベント扱い）。0〜12時で指定可
  const cutoffRaw = isTextUpload ? req.query.cutoffHour : req.body?.cutoffHour
  let cutoffHour = cutoffRaw != null ? parseInt(String(cutoffRaw), 10) : 6
  if (isNaN(cutoffHour) || cutoffHour < 0 || cutoffHour > 12) cutoffHour = 6

  // メインのワールド名（部分一致・任意）。指定すると代表ワールド/イベント名に優先採用
  const mainWorldRaw = isTextUpload ? req.query.mainWorld : req.body?.mainWorld
  const mainWorld = typeof mainWorldRaw === 'string' ? mainWorldRaw.trim() : ''

  // ── Validate inputs ──────────────────────────────────────────
  let parsed
  try {
    if (fileContent && typeof fileContent === 'string') {
      const displayFileName = fileName ?? 'output_log.txt'
      parsed = parseLogContent(fileContent, displayFileName)
    } else if (filePath && typeof filePath === 'string') {
      const absPath = path.resolve(filePath)
      if (!fs.existsSync(absPath)) {
        return fail(res, `File not found: ${absPath}`, 400)
      }
      parsed = parseLogFile(absPath)
    } else {
      return fail(res, 'Either filePath or fileContent is required', 400)
    }
  } catch (err: any) {
    return fail(res, `Failed to parse log file: ${err.message}`)
  }

  const parsedEventId: number | null = eventId != null ? parseInt(String(eventId), 10) : null
  if (eventId != null && (isNaN(parsedEventId!) || parsedEventId! <= 0)) {
    return fail(res, 'eventId must be a positive integer', 400)
  }

  // ── DB書き込みは丸ごと try/catch。失敗しても原因をJSONで返す（旧コードは握り潰して荒い500） ──
  try {

  // ── Load target event (if eventId provided) ──────────────────
  let event = parsedEventId != null ? await getEventById(parsedEventId) : null
  if (parsedEventId != null && !event) {
    return fail(res, `Event ${parsedEventId} not found`, 404)
  }

  // ── Duplicate check ──────────────────────────────────────────
  if (!force && await isLogImported(parsed.fileHash)) {
    return ok(res, {
      alreadyImported: true,
      fileName: parsed.fileName,
      fileHash: parsed.fileHash,
      summary: parsed.summary,
    })
  }

  // ── Segment into world sessions ──────────────────────────────
  const allSessions = segmentIntoSessions(parsed.events)

  // ── Auto-create or match events ────────────────────────────────
  const createdEvents: { id: number; name: string; date: string; worldName?: string; merged?: boolean }[] = []
  let totalInserted = 0

  if (event) {
    // ── Existing event: link sessions to it ─────────────────────
    let matchedSessions = allSessions
    if (event.world_id) {
      const byWorld = allSessions.filter(s => s.worldId === event!.world_id)
      if (byWorld.length > 0) matchedSessions = byWorld
    }
    if (!event.world_id && allSessions.length > 0) {
      const firstSession = allSessions[0]
      if (firstSession.worldId) {
        event = (await updateEvent(event.id, {
          world_id: firstSession.worldId ?? undefined,
          world_name: firstSession.worldName ?? undefined,
          instance_id: firstSession.instanceId ?? undefined,
        }))!
      }
    }

    const playerEvents: ParsedPlayerEvent[] = matchedSessions.flatMap(s => s.playerEvents)
    const insertInputs: InsertPlayerEventInput[] = playerEvents.map(pe => ({
      event_id: event!.id,
      user_id: pe.userId,
      display_name: pe.displayName,
      event_type: pe.type,
      timestamp: pe.timestamp,
      log_file: parsed.fileName,
    }))
    if (insertInputs.length > 0) {
      totalInserted = await insertPlayerEventsBatch(insertInputs)
      await recomputeEventTimespan(event.id)
    }
  } else {
    const saved = await saveSessionsToDB(allSessions, parsed.fileName, cutoffHour, mainWorld)
    createdEvents.push(...saved.createdEvents)
    totalInserted = saved.totalInserted
    // userInputs length は saved.usersUpserted で返す
    const userInputsLen = saved.usersUpserted

    // ── Mark log as imported ────────────────────────────────────
    await recordImportedLog(parsed.fileName, parsed.fileHash, totalInserted)

    ok(res, {
      alreadyImported: false,
      fileName: parsed.fileName,
      fileHash: parsed.fileHash,
      eventId: parsedEventId,
      sessionsFound: allSessions.length,
      createdEvents,
      playerEventsInserted: totalInserted,
      usersUpserted: userInputsLen,
      logSummary: parsed.summary,
    })
    return
  }

  // ── existing-event path: record import and return ─────────────
  await recordImportedLog(parsed.fileName, parsed.fileHash, totalInserted)
  ok(res, {
    alreadyImported: false,
    fileName: parsed.fileName,
    fileHash: parsed.fileHash,
    eventId: parsedEventId,
    sessionsFound: allSessions.length,
    createdEvents,
    playerEventsInserted: totalInserted,
    usersUpserted: 0,
    logSummary: parsed.summary,
  })
  } catch (err: any) {
    return fail(res, `ログ取り込み中にエラー: ${err?.message ?? String(err)}`)
  }
})

/**
 * POST /api/logs/import-parsed
 *
 * ブラウザ側で解析済みのセッションデータを受け取って保存する。
 * 生ログ（数十〜数百MB）をサーバーに送らないので、Railway のメモリ上限に
 * かからない。送信されるのは抽出済みの Join/Leave とワールド情報のみ（数百KB程度）。
 *
 * body (application/json):
 *   fileName   - 元のログファイル名
 *   fileHash   - 生ログ内容の SHA-256（重複取込チェック用。サーバー解析時と同一の計算方法）
 *   sessions   - WorldSession[]（ブラウザの logParser.ts が生成）
 *   cutoffHour - 深夜の区切り（既定6）
 *   mainWorld  - メインのワールド名（部分一致・任意）
 *   force      - 重複チェックをスキップ
 */
router.post('/import-parsed', async (req: Request, res: Response) => {
  const { fileName, fileHash, sessions, force } = req.body ?? {}

  if (typeof fileName !== 'string' || !fileName) return fail(res, 'fileName is required', 400)
  if (typeof fileHash !== 'string' || !/^[a-f0-9]{64}$/.test(fileHash)) return fail(res, 'fileHash must be a SHA-256 hex string', 400)
  if (!Array.isArray(sessions)) return fail(res, 'sessions array is required', 400)

  let cutoffHour = req.body?.cutoffHour != null ? parseInt(String(req.body.cutoffHour), 10) : 6
  if (isNaN(cutoffHour) || cutoffHour < 0 || cutoffHour > 12) cutoffHour = 6
  const mainWorld = typeof req.body?.mainWorld === 'string' ? req.body.mainWorld.trim() : ''

  try {
    if (!force && await isLogImported(fileHash)) {
      return ok(res, { alreadyImported: true, fileName, fileHash })
    }

    const saved = await saveSessionsToDB(sessions as WorldSession[], fileName, cutoffHour, mainWorld)
    await recordImportedLog(fileName, fileHash, saved.totalInserted)

    ok(res, {
      alreadyImported: false,
      fileName,
      fileHash,
      sessionsFound: sessions.length,
      createdEvents: saved.createdEvents,
      playerEventsInserted: saved.totalInserted,
      usersUpserted: saved.usersUpserted,
    })
  } catch (err: any) {
    return fail(res, `ログ取り込み中にエラー: ${err?.message ?? String(err)}`)
  }
})

/**
 * DELETE /api/logs/:id
 * Delete an imported log record and its associated player_events.
 * Also removes auto-created events that become empty after deletion.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id) || id <= 0) {
      return fail(res, 'Invalid log id', 400)
    }

    const result = await deleteImportedLog(id)
    if (!result.deleted) {
      return fail(res, `Imported log ${id} not found`, 404)
    }

    ok(res, {
      id,
      playerEventsDeleted: result.playerEventsDeleted,
      eventsDeleted: result.eventsDeleted,
    })
  } catch (err: any) {
    fail(res, err.message)
  }
})

export default router
