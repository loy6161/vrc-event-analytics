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
  type ParsedPlayerEvent,
} from '../services/log-parser.js'
import {
  createEvent,
  getEventById,
  updateEvent,
  isLogImported,
  recordImportedLog,
  getImportedLogs,
  deleteImportedLog,
  insertPlayerEventsBatch,
  upsertUsersBatch,
  recordDisplayNameHistory,
  type InsertPlayerEventInput,
  type UpsertUserInput,
} from '../db/queries.js'

const router = Router()

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
  const createdEvents: { id: number; name: string; date: string; worldName?: string }[] = []
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
    }
  } else {
    // ── No event specified: auto-create one event per session ────
    for (const session of allSessions) {
      if (session.playerEvents.length === 0) continue

      // Extract date from session start time (ISO format)
      const sessionDate = session.startTime.slice(0, 10) // YYYY-MM-DD
      const startTime = session.startTime.slice(11, 16)  // HH:MM
      const endTime = session.endTime.slice(11, 16)

      // Generate event name
      const eventName = session.worldName
        ? `${session.worldName} (${sessionDate})`
        : `Session ${sessionDate} ${startTime}`

      // Create event
      const newEvent = await createEvent({
        name: eventName,
        date: sessionDate,
        start_time: startTime,
        end_time: endTime,
        world_id: session.worldId,
        world_name: session.worldName,
        instance_id: session.instanceId,
        region: session.region,
        access_type: session.accessType,
      })

      createdEvents.push({
        id: newEvent.id,
        name: newEvent.name,
        date: newEvent.date,
        worldName: session.worldName,
      })

      // Insert player events linked to this new event
      const insertInputs: InsertPlayerEventInput[] = session.playerEvents.map(pe => ({
        event_id: newEvent.id,
        user_id: pe.userId,
        display_name: pe.displayName,
        event_type: pe.type,
        timestamp: pe.timestamp,
        log_file: parsed.fileName,
      }))
      totalInserted += await insertPlayerEventsBatch(insertInputs)
    }
  }

  // ── Collect unique players for user upsert ────────────────────
  const allPlayerEvents: ParsedPlayerEvent[] = allSessions.flatMap(s => s.playerEvents)
  const playerMap = new Map<string, { userId?: string; displayName: string; firstSeen: string }>()

  for (const pe of allPlayerEvents) {
    const key = pe.userId ?? pe.displayName
    if (!playerMap.has(key)) {
      playerMap.set(key, {
        userId: pe.userId,
        displayName: pe.displayName,
        firstSeen: pe.timestamp,
      })
    }
  }

  const userInputs: UpsertUserInput[] = Array.from(playerMap.values()).map(p => ({
    user_id: p.userId,
    display_name: p.displayName,
    first_seen: p.firstSeen,
  }))

  await upsertUsersBatch(userInputs)

  // Record display name history for each unique player
  const now = new Date().toISOString()
  await Promise.all(
    userInputs.map(({ user_id, display_name }) =>
      recordDisplayNameHistory(user_id ?? null, display_name, now)
    )
  )

  // ── Mark log as imported ──────────────────────────────────────
  await recordImportedLog(parsed.fileName, parsed.fileHash, totalInserted)

  // ── Return summary ────────────────────────────────────────────
  ok(res, {
    alreadyImported: false,
    fileName: parsed.fileName,
    fileHash: parsed.fileHash,
    eventId: parsedEventId,
    sessionsFound: allSessions.length,
    createdEvents,
    playerEventsInserted: totalInserted,
    usersUpserted: userInputs.length,
    logSummary: parsed.summary,
  })
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
