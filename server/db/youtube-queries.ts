import { getDatabase } from './schema.js'
import type {
  YouTubeStream,
  YouTubeChatUser,
  YouTubeChatMessage,
  YouTubeChatStats,
  YouTubeConcurrentLog,
} from '../../src/types/index.js'
import type { RawChatMessage, VideoMetadata, ComputedChatStats } from '../services/youtube.js'

// ──────────────────────────────────────────────
// Row Mappers
// ──────────────────────────────────────────────

function mapStream(row: any): YouTubeStream {
  return {
    id: row.id,
    event_id: row.event_id ?? undefined,
    video_id: row.video_id,
    title: row.title ?? undefined,
    channel_id: row.channel_id ?? undefined,
    channel_title: row.channel_title ?? undefined,
    scheduled_start: row.scheduled_start ?? undefined,
    actual_start: row.actual_start ?? undefined,
    actual_end: row.actual_end ?? undefined,
    peak_concurrent_viewers: row.peak_concurrent_viewers ?? undefined,
    total_view_count: row.total_view_count ?? undefined,
    like_count: row.like_count ?? undefined,
    comment_count: row.comment_count ?? undefined,
    fetched_at: row.fetched_at ?? undefined,
  }
}

function mapChatUser(row: any): YouTubeChatUser {
  return {
    id: row.id,
    stream_id: row.stream_id,
    channel_id: row.channel_id,
    display_name: row.display_name,
    profile_image_url: row.profile_image_url ?? undefined,
    is_moderator: row.is_moderator === 1,
    is_member: row.is_member === 1,
    message_count: row.message_count,
    first_message_at: row.first_message_at ?? undefined,
    last_message_at: row.last_message_at ?? undefined,
  }
}

function mapChatMessage(row: any): YouTubeChatMessage {
  return {
    id: row.id,
    stream_id: row.stream_id,
    chat_user_id: row.chat_user_id,
    message_id: row.message_id,
    message_type: row.message_type,
    message_text: row.message_text ?? undefined,
    super_chat_amount: row.super_chat_amount ?? undefined,
    super_chat_currency: row.super_chat_currency ?? undefined,
    super_chat_tier: row.super_chat_tier ?? undefined,
    membership_level: row.membership_level ?? undefined,
    gift_count: row.gift_count ?? undefined,
    published_at: row.published_at,
  }
}

function mapChatStats(row: any): YouTubeChatStats {
  return {
    id: row.id,
    stream_id: row.stream_id,
    total_messages: row.total_messages,
    unique_chatters: row.unique_chatters,
    super_chat_count: row.super_chat_count,
    super_chat_total_jpy: row.super_chat_total_jpy,
    membership_count: row.membership_count,
    member_gift_total: row.member_gift_total,
    peak_chat_per_minute: row.peak_chat_per_minute,
    avg_chat_per_minute: row.avg_chat_per_minute,
  }
}

// ──────────────────────────────────────────────
// YouTube Streams
// ──────────────────────────────────────────────

export async function getStreams(): Promise<YouTubeStream[]> {
  const result = await getDatabase().execute(
    'SELECT * FROM youtube_streams ORDER BY actual_start DESC, scheduled_start DESC'
  )
  return result.rows.map(r => mapStream(r as any))
}

export async function getStreamById(id: number): Promise<YouTubeStream | null> {
  const result = await getDatabase().execute({
    sql: 'SELECT * FROM youtube_streams WHERE id = ?',
    args: [id],
  })
  const row = result.rows[0]
  return row ? mapStream(row as any) : null
}

export async function getStreamByVideoId(videoId: string): Promise<YouTubeStream | null> {
  const result = await getDatabase().execute({
    sql: 'SELECT * FROM youtube_streams WHERE video_id = ?',
    args: [videoId],
  })
  const row = result.rows[0]
  return row ? mapStream(row as any) : null
}

export async function getStreamsByEventId(eventId: number): Promise<YouTubeStream[]> {
  const result = await getDatabase().execute({
    sql: 'SELECT * FROM youtube_streams WHERE event_id = ? ORDER BY actual_start DESC',
    args: [eventId],
  })
  return result.rows.map(r => mapStream(r as any))
}

export async function createStream(meta: VideoMetadata, eventId?: number): Promise<YouTubeStream> {
  const result = await getDatabase().execute({
    sql: `INSERT INTO youtube_streams
            (event_id, video_id, title, channel_id, channel_title,
             scheduled_start, actual_start, actual_end,
             peak_concurrent_viewers, total_view_count, like_count, comment_count, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    args: [
      eventId ?? null,
      meta.video_id,
      meta.title,
      meta.channel_id,
      meta.channel_title,
      meta.scheduled_start,
      meta.actual_start,
      meta.actual_end,
      meta.concurrent_viewers,
      meta.total_view_count,
      meta.like_count,
      meta.comment_count,
    ],
  })
  return (await getStreamById(Number(result.lastInsertRowid)))!
}

export async function updateStreamMetadata(id: number, meta: VideoMetadata): Promise<void> {
  await getDatabase().execute({
    sql: `UPDATE youtube_streams SET
            title = ?, channel_id = ?, channel_title = ?,
            scheduled_start = ?, actual_start = ?, actual_end = ?,
            peak_concurrent_viewers = ?, total_view_count = ?,
            like_count = ?, comment_count = ?, fetched_at = datetime('now')
          WHERE id = ?`,
    args: [
      meta.title, meta.channel_id, meta.channel_title,
      meta.scheduled_start, meta.actual_start, meta.actual_end,
      meta.concurrent_viewers, meta.total_view_count,
      meta.like_count, meta.comment_count,
      id,
    ],
  })
}

export async function linkStreamToEvent(streamId: number, eventId: number): Promise<void> {
  await getDatabase().execute({
    sql: 'UPDATE youtube_streams SET event_id = ? WHERE id = ?',
    args: [eventId, streamId],
  })
}

export async function deleteStream(id: number): Promise<boolean> {
  const db = getDatabase()
  await db.batch([
    { sql: 'DELETE FROM youtube_chat_messages WHERE stream_id = ?', args: [id] },
    { sql: 'DELETE FROM youtube_chat_users WHERE stream_id = ?', args: [id] },
    { sql: 'DELETE FROM youtube_chat_stats WHERE stream_id = ?', args: [id] },
    { sql: 'DELETE FROM youtube_concurrent_log WHERE stream_id = ?', args: [id] },
    { sql: 'DELETE FROM youtube_streams WHERE id = ?', args: [id] },
  ], 'write')
  return true
}

// ──────────────────────────────────────────────
// Chat Users
// ──────────────────────────────────────────────

export async function upsertChatUsersBatch(
  streamId: number,
  messages: RawChatMessage[],
): Promise<Map<string, number>> {
  const db = getDatabase()
  const channelMap = new Map<string, number>()

  const userStats = new Map<string, {
    display_name: string
    profile_image_url: string | null
    is_moderator: boolean
    is_member: boolean
    message_count: number
    first_message_at: string
    last_message_at: string
  }>()

  for (const msg of messages) {
    const existing = userStats.get(msg.author_channel_id)
    if (existing) {
      existing.message_count++
      if (msg.published_at < existing.first_message_at) existing.first_message_at = msg.published_at
      if (msg.published_at > existing.last_message_at) existing.last_message_at = msg.published_at
      if (msg.is_moderator) existing.is_moderator = true
      if (msg.is_member) existing.is_member = true
      existing.display_name = msg.author_display_name
    } else {
      userStats.set(msg.author_channel_id, {
        display_name: msg.author_display_name,
        profile_image_url: msg.author_profile_image_url,
        is_moderator: msg.is_moderator,
        is_member: msg.is_member,
        message_count: 1,
        first_message_at: msg.published_at,
        last_message_at: msg.published_at,
      })
    }
  }

  const stmts = Array.from(userStats.entries()).map(([channelId, stats]) => ({
    sql: `INSERT INTO youtube_chat_users
            (stream_id, channel_id, display_name, profile_image_url,
             is_moderator, is_member, message_count, first_message_at, last_message_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(stream_id, channel_id) DO UPDATE SET
            display_name = excluded.display_name,
            profile_image_url = excluded.profile_image_url,
            is_moderator = MAX(is_moderator, excluded.is_moderator),
            is_member = MAX(is_member, excluded.is_member),
            message_count = excluded.message_count,
            first_message_at = MIN(first_message_at, excluded.first_message_at),
            last_message_at = MAX(last_message_at, excluded.last_message_at)`,
    args: [
      streamId, channelId, stats.display_name, stats.profile_image_url,
      stats.is_moderator ? 1 : 0, stats.is_member ? 1 : 0,
      stats.message_count, stats.first_message_at, stats.last_message_at,
    ],
  }))

  if (stmts.length > 0) {
    await db.batch(stmts, 'write')
  }

  const rows = await db.execute({
    sql: 'SELECT id, channel_id FROM youtube_chat_users WHERE stream_id = ?',
    args: [streamId],
  })
  for (const row of rows.rows) {
    channelMap.set((row as any).channel_id, (row as any).id)
  }

  return channelMap
}

export async function getChatUsersByStreamId(streamId: number): Promise<YouTubeChatUser[]> {
  const result = await getDatabase().execute({
    sql: 'SELECT * FROM youtube_chat_users WHERE stream_id = ? ORDER BY message_count DESC',
    args: [streamId],
  })
  return result.rows.map(r => mapChatUser(r as any))
}

// ──────────────────────────────────────────────
// Chat Messages
// ──────────────────────────────────────────────

export async function insertChatMessagesBatch(
  streamId: number,
  messages: RawChatMessage[],
  channelMap: Map<string, number>,
): Promise<number> {
  if (messages.length === 0) return 0
  const db = getDatabase()

  const stmts = messages
    .filter(msg => channelMap.has(msg.author_channel_id))
    .map(msg => ({
      sql: `INSERT OR IGNORE INTO youtube_chat_messages
              (stream_id, chat_user_id, message_id, message_type, message_text,
               super_chat_amount, super_chat_currency, super_chat_tier,
               membership_level, gift_count, published_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        streamId, channelMap.get(msg.author_channel_id)!, msg.message_id, msg.message_type, msg.message_text,
        msg.super_chat_amount, msg.super_chat_currency, msg.super_chat_tier,
        msg.membership_level, msg.gift_count, msg.published_at,
      ],
    }))

  if (stmts.length === 0) return 0
  const results = await db.batch(stmts, 'write')
  return results.reduce((sum, r) => sum + r.rowsAffected, 0)
}

export async function getChatMessagesByStreamId(
  streamId: number,
  options?: { type?: string; limit?: number; offset?: number },
): Promise<YouTubeChatMessage[]> {
  let sql = 'SELECT * FROM youtube_chat_messages WHERE stream_id = ?'
  const args: any[] = [streamId]

  if (options?.type) {
    sql += ' AND message_type = ?'
    args.push(options.type)
  }

  sql += ' ORDER BY published_at ASC'

  if (options?.limit) {
    sql += ' LIMIT ?'
    args.push(options.limit)
    if (options?.offset) {
      sql += ' OFFSET ?'
      args.push(options.offset)
    }
  }

  const result = await getDatabase().execute({ sql, args })
  return result.rows.map(r => mapChatMessage(r as any))
}

// ──────────────────────────────────────────────
// Chat Stats
// ──────────────────────────────────────────────

export async function saveChatStats(streamId: number, stats: ComputedChatStats): Promise<void> {
  await getDatabase().execute({
    sql: `INSERT INTO youtube_chat_stats
            (stream_id, total_messages, unique_chatters, super_chat_count,
             super_chat_total_jpy, membership_count, member_gift_total,
             peak_chat_per_minute, avg_chat_per_minute)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(stream_id) DO UPDATE SET
            total_messages = excluded.total_messages,
            unique_chatters = excluded.unique_chatters,
            super_chat_count = excluded.super_chat_count,
            super_chat_total_jpy = excluded.super_chat_total_jpy,
            membership_count = excluded.membership_count,
            member_gift_total = excluded.member_gift_total,
            peak_chat_per_minute = excluded.peak_chat_per_minute,
            avg_chat_per_minute = excluded.avg_chat_per_minute`,
    args: [
      streamId,
      stats.total_messages, stats.unique_chatters,
      stats.super_chat_count, stats.super_chat_total_jpy,
      stats.membership_count, stats.member_gift_total,
      stats.peak_chat_per_minute, stats.avg_chat_per_minute,
    ],
  })
}

export async function getChatStats(streamId: number): Promise<YouTubeChatStats | null> {
  const result = await getDatabase().execute({
    sql: 'SELECT * FROM youtube_chat_stats WHERE stream_id = ?',
    args: [streamId],
  })
  const row = result.rows[0]
  return row ? mapChatStats(row as any) : null
}

// ──────────────────────────────────────────────
// Concurrent Viewer Log
// ──────────────────────────────────────────────

export async function recordConcurrentViewers(streamId: number, viewers: number): Promise<void> {
  await getDatabase().execute({
    sql: `INSERT INTO youtube_concurrent_log (stream_id, concurrent_viewers, recorded_at)
          VALUES (?, ?, datetime('now'))`,
    args: [streamId, viewers],
  })
}

export async function getConcurrentLog(streamId: number): Promise<YouTubeConcurrentLog[]> {
  const result = await getDatabase().execute({
    sql: 'SELECT * FROM youtube_concurrent_log WHERE stream_id = ? ORDER BY recorded_at ASC',
    args: [streamId],
  })
  return result.rows.map(row => ({
    id: (row as any).id,
    stream_id: (row as any).stream_id,
    concurrent_viewers: (row as any).concurrent_viewers,
    recorded_at: (row as any).recorded_at,
  }))
}

export async function updatePeakConcurrent(streamId: number): Promise<void> {
  const result = await getDatabase().execute({
    sql: 'SELECT MAX(concurrent_viewers) as peak FROM youtube_concurrent_log WHERE stream_id = ?',
    args: [streamId],
  })
  const peak = (result.rows[0] as any)?.peak
  if (peak != null) {
    await getDatabase().execute({
      sql: 'UPDATE youtube_streams SET peak_concurrent_viewers = ? WHERE id = ?',
      args: [peak, streamId],
    })
  }
}
