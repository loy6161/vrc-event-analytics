import { Router, Request, Response } from 'express'
import {
  initYouTubeClient,
  fetchVideoMetadata,
  fetchAllChatMessages,
  fetchConcurrentViewers,
  computeChatStats,
  extractVideoId,
} from '../services/youtube.js'
import {
  getStreams,
  getStreamById,
  getStreamByVideoId,
  getStreamsByEventId,
  createStream,
  updateStreamMetadata,
  linkStreamToEvent,
  deleteStream,
  upsertChatUsersBatch,
  insertChatMessagesBatch,
  saveChatStats,
  getChatStats,
  getChatUsersByStreamId,
  getChatMessagesByStreamId,
  recordConcurrentViewers,
  getConcurrentLog,
  updatePeakConcurrent,
} from '../db/youtube-queries.js'
import { ok, fail, toMessage } from '../utils/response.js'

const router = Router()

// ──────────────────────────────────────────────
// API Key initialization
// ──────────────────────────────────────────────

/**
 * POST /api/youtube/init
 * Body: { apiKey: string }
 * Initialize the YouTube API client with the provided key.
 */
router.post('/init', (req: Request, res: Response) => {
  const { apiKey } = req.body
  if (!apiKey || typeof apiKey !== 'string') {
    return fail(res, 'apiKey is required', 400)
  }

  try {
    initYouTubeClient(apiKey)
    ok(res, { initialized: true })
  } catch (error) {
    fail(res, toMessage(error))
  }
})

// ──────────────────────────────────────────────
// Streams CRUD
// ──────────────────────────────────────────────

/**
 * GET /api/youtube/streams
 * Query: ?eventId=N (optional filter)
 */
router.get('/streams', async (req: Request, res: Response) => {
  try {
    const eventId = req.query.eventId ? parseInt(req.query.eventId as string, 10) : null
    const streams = eventId ? await getStreamsByEventId(eventId) : await getStreams()
    ok(res, streams)
  } catch (error) {
    fail(res, toMessage(error))
  }
})

/**
 * GET /api/youtube/streams/:id
 */
router.get('/streams/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return fail(res, 'Invalid stream ID', 400)

    const stream = await getStreamById(id)
    if (!stream) return fail(res, 'Stream not found', 404)

    ok(res, stream)
  } catch (error) {
    fail(res, toMessage(error))
  }
})

/**
 * POST /api/youtube/streams
 * Body: { videoUrl: string, eventId?: number }
 * Registers a YouTube stream by fetching its metadata from the API.
 */
router.post('/streams', async (req: Request, res: Response) => {
  try {
    const { videoUrl, eventId } = req.body
    if (!videoUrl || typeof videoUrl !== 'string') {
      return fail(res, 'videoUrl is required', 400)
    }

    const videoId = extractVideoId(videoUrl)

    // Check if already registered
    const existing = await getStreamByVideoId(videoId)
    if (existing) {
      return fail(res, `Stream already registered (id: ${existing.id})`, 409)
    }

    // Fetch metadata from YouTube API
    const meta = await fetchVideoMetadata(videoId)

    // Save to database
    const parsedEventId = eventId ? parseInt(eventId, 10) : undefined
    const stream = await createStream(meta, parsedEventId)

    ok(res, { stream, live_chat_id: meta.live_chat_id })
  } catch (error) {
    fail(res, toMessage(error))
  }
})

/**
 * PUT /api/youtube/streams/:id/refresh
 * Re-fetch metadata from YouTube API and update the DB record.
 */
router.put('/streams/:id/refresh', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return fail(res, 'Invalid stream ID', 400)

    const stream = await getStreamById(id)
    if (!stream) return fail(res, 'Stream not found', 404)

    const meta = await fetchVideoMetadata(stream.video_id)
    await updateStreamMetadata(id, meta)

    const updated = await getStreamById(id)
    ok(res, { stream: updated, live_chat_id: meta.live_chat_id })
  } catch (error) {
    fail(res, toMessage(error))
  }
})

/**
 * PUT /api/youtube/streams/:id/link
 * Body: { eventId: number }
 * Link a stream to an event.
 */
router.put('/streams/:id/link', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    const { eventId } = req.body
    if (isNaN(id)) return fail(res, 'Invalid stream ID', 400)
    if (!eventId || isNaN(parseInt(eventId, 10))) return fail(res, 'eventId is required', 400)

    const stream = await getStreamById(id)
    if (!stream) return fail(res, 'Stream not found', 404)

    await linkStreamToEvent(id, parseInt(eventId, 10))
    ok(res, await getStreamById(id))
  } catch (error) {
    fail(res, toMessage(error))
  }
})

/**
 * DELETE /api/youtube/streams/:id
 * Deletes stream and all associated chat data.
 */
router.delete('/streams/:id', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return fail(res, 'Invalid stream ID', 400)

    const deleted = await deleteStream(id)
    if (!deleted) return fail(res, 'Stream not found', 404)

    ok(res, { deleted: true })
  } catch (error) {
    fail(res, toMessage(error))
  }
})

// ──────────────────────────────────────────────
// Chat Data Fetching
// ──────────────────────────────────────────────

/**
 * POST /api/youtube/streams/:id/fetch-chat
 * Fetches all chat messages for the stream from YouTube API,
 * stores users + messages in DB, and computes stats.
 */
router.post('/streams/:id/fetch-chat', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return fail(res, 'Invalid stream ID', 400)

    const stream = await getStreamById(id)
    if (!stream) return fail(res, 'Stream not found', 404)

    // Get live chat ID by re-fetching video metadata
    const meta = await fetchVideoMetadata(stream.video_id)
    if (!meta.live_chat_id) {
      return fail(res, 'No live chat available for this video. It may not be a live stream or chat replay may be disabled.', 400)
    }

    // Fetch all chat messages
    const rawMessages = await fetchAllChatMessages(meta.live_chat_id)

    if (rawMessages.length === 0) {
      return ok(res, {
        messages_fetched: 0,
        users_created: 0,
        messages_inserted: 0,
        stats: null,
      })
    }

    // Upsert chat users
    const channelMap = await upsertChatUsersBatch(id, rawMessages)

    // Insert chat messages
    const messagesInserted = await insertChatMessagesBatch(id, rawMessages, channelMap)

    // Compute and save chat stats
    const stats = computeChatStats(rawMessages)
    await saveChatStats(id, stats)

    // Update stream metadata with latest counts
    await updateStreamMetadata(id, meta)

    ok(res, {
      messages_fetched: rawMessages.length,
      users_created: channelMap.size,
      messages_inserted: messagesInserted,
      stats,
    })
  } catch (error) {
    fail(res, toMessage(error))
  }
})

// ──────────────────────────────────────────────
// Chat Data Retrieval
// ──────────────────────────────────────────────

/**
 * GET /api/youtube/streams/:id/chat-stats
 */
router.get('/streams/:id/chat-stats', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return fail(res, 'Invalid stream ID', 400)

    const stats = await getChatStats(id)
    if (!stats) return fail(res, 'No chat stats found. Fetch chat data first.', 404)

    ok(res, stats)
  } catch (error) {
    fail(res, toMessage(error))
  }
})

/**
 * GET /api/youtube/streams/:id/chat-users
 * Query: ?limit=N
 */
router.get('/streams/:id/chat-users', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return fail(res, 'Invalid stream ID', 400)

    let users = await getChatUsersByStreamId(id)

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : null
    if (limit && limit > 0) {
      users = users.slice(0, limit)
    }

    ok(res, users)
  } catch (error) {
    fail(res, toMessage(error))
  }
})

/**
 * GET /api/youtube/streams/:id/chat-messages
 * Query: ?type=superChat&limit=100&offset=0
 */
router.get('/streams/:id/chat-messages', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return fail(res, 'Invalid stream ID', 400)

    const type = req.query.type as string | undefined
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined

    const messages = await getChatMessagesByStreamId(id, { type, limit, offset })
    ok(res, messages)
  } catch (error) {
    fail(res, toMessage(error))
  }
})

// ──────────────────────────────────────────────
// Concurrent Viewer Polling
// ──────────────────────────────────────────────

/**
 * POST /api/youtube/streams/:id/poll-viewers
 * Polls current concurrent viewers and records in the log.
 * Used for live streams — call periodically from the frontend.
 */
router.post('/streams/:id/poll-viewers', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return fail(res, 'Invalid stream ID', 400)

    const stream = await getStreamById(id)
    if (!stream) return fail(res, 'Stream not found', 404)

    const viewers = await fetchConcurrentViewers(stream.video_id)
    if (viewers == null) {
      return fail(res, 'Stream is not currently live', 400)
    }

    await recordConcurrentViewers(id, viewers)
    await updatePeakConcurrent(id)

    ok(res, { concurrent_viewers: viewers, recorded_at: new Date().toISOString() })
  } catch (error) {
    fail(res, toMessage(error))
  }
})

/**
 * GET /api/youtube/streams/:id/concurrent-log
 * Returns the full concurrent viewer history for charting.
 */
router.get('/streams/:id/concurrent-log', async (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10)
    if (isNaN(id)) return fail(res, 'Invalid stream ID', 400)

    const log = await getConcurrentLog(id)
    ok(res, log)
  } catch (error) {
    fail(res, toMessage(error))
  }
})

export default router
