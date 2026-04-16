import { google, youtube_v3 } from 'googleapis'
import type { YouTubeChatMessageType } from '../../src/types/index.js'

// ──────────────────────────────────────────────
// YouTube Data API v3 Service
// ──────────────────────────────────────────────

let youtubeClient: youtube_v3.Youtube | null = null

/**
 * Initialize (or reinitialize) the YouTube API client with an API key.
 */
export function initYouTubeClient(apiKey: string): youtube_v3.Youtube {
  youtubeClient = google.youtube({ version: 'v3', auth: apiKey })
  return youtubeClient
}

function getClient(): youtube_v3.Youtube {
  if (!youtubeClient) {
    throw new Error('YouTube API client not initialized. Set your API key in Settings first.')
  }
  return youtubeClient
}

// ──────────────────────────────────────────────
// Video / Live Stream Metadata
// ──────────────────────────────────────────────

export interface VideoMetadata {
  video_id: string
  title: string
  channel_id: string
  channel_title: string
  scheduled_start: string | null
  actual_start: string | null
  actual_end: string | null
  concurrent_viewers: number | null
  total_view_count: number | null
  like_count: number | null
  comment_count: number | null
  live_chat_id: string | null
}

/**
 * Fetch video metadata + live streaming details from YouTube Data API.
 * Works for both live and archived streams.
 */
export async function fetchVideoMetadata(videoId: string): Promise<VideoMetadata> {
  const yt = getClient()

  const res = await yt.videos.list({
    part: ['snippet', 'liveStreamingDetails', 'statistics'],
    id: [videoId],
  })

  const items = res.data.items
  if (!items || items.length === 0) {
    throw new Error(`Video not found: ${videoId}`)
  }

  const video = items[0]
  const snippet = video.snippet!
  const live = video.liveStreamingDetails
  const stats = video.statistics

  return {
    video_id: videoId,
    title: snippet.title ?? '',
    channel_id: snippet.channelId ?? '',
    channel_title: snippet.channelTitle ?? '',
    scheduled_start: live?.scheduledStartTime ?? null,
    actual_start: live?.actualStartTime ?? null,
    actual_end: live?.actualEndTime ?? null,
    concurrent_viewers: live?.concurrentViewers ? parseInt(live.concurrentViewers, 10) : null,
    total_view_count: stats?.viewCount ? parseInt(stats.viewCount, 10) : null,
    like_count: stats?.likeCount ? parseInt(stats.likeCount, 10) : null,
    comment_count: stats?.commentCount ? parseInt(stats.commentCount, 10) : null,
    live_chat_id: live?.activeLiveChatId ?? null,
  }
}

// ──────────────────────────────────────────────
// Live Chat Messages
// ──────────────────────────────────────────────

export interface RawChatMessage {
  message_id: string
  message_type: YouTubeChatMessageType
  message_text: string | null
  author_channel_id: string
  author_display_name: string
  author_profile_image_url: string | null
  is_moderator: boolean
  is_member: boolean
  super_chat_amount: number | null
  super_chat_currency: string | null
  super_chat_tier: string | null
  membership_level: string | null
  gift_count: number | null
  published_at: string
}

/**
 * Fetch all live chat messages for a given liveChatId.
 * Paginates through all pages using nextPageToken.
 * For archived streams, this fetches the full chat replay.
 *
 * @param liveChatId - The live chat ID from liveStreamingDetails
 * @param onPage - Optional callback invoked after each page (for progress tracking)
 * @returns Array of all chat messages
 */
export async function fetchAllChatMessages(
  liveChatId: string,
  onPage?: (pageCount: number, totalSoFar: number) => void,
): Promise<RawChatMessage[]> {
  const yt = getClient()
  const allMessages: RawChatMessage[] = []
  let pageToken: string | undefined
  let pageCount = 0

  do {
    const res = await yt.liveChatMessages.list({
      part: ['snippet', 'authorDetails'],
      liveChatId,
      maxResults: 2000,
      pageToken,
    })

    const items = res.data.items ?? []
    for (const item of items) {
      const msg = parseChatMessage(item)
      if (msg) allMessages.push(msg)
    }

    pageCount++
    if (onPage) onPage(pageCount, allMessages.length)

    pageToken = res.data.nextPageToken ?? undefined

    // For live streams, pollingIntervalMillis indicates wait time.
    // For replay, we just paginate through.
    if (res.data.offlineAt) {
      // Stream is offline — replay mode, continue paginating
    }
  } while (pageToken)

  return allMessages
}

/**
 * Parse a single YouTube live chat message item into our internal format.
 */
function parseChatMessage(item: youtube_v3.Schema$LiveChatMessage): RawChatMessage | null {
  const snippet = item.snippet
  const author = item.authorDetails
  if (!snippet || !author) return null

  let messageType: YouTubeChatMessageType = 'text'
  let superChatAmount: number | null = null
  let superChatCurrency: string | null = null
  let superChatTier: string | null = null
  let membershipLevel: string | null = null
  let giftCount: number | null = null
  let messageText: string | null = snippet.displayMessage ?? null

  switch (snippet.type) {
    case 'textMessageEvent':
      messageType = 'text'
      messageText = snippet.textMessageDetails?.messageText ?? messageText
      break
    case 'superChatEvent':
      messageType = 'superChat'
      if (snippet.superChatDetails) {
        superChatAmount = snippet.superChatDetails.amountMicros
          ? parseInt(snippet.superChatDetails.amountMicros, 10) / 1_000_000
          : null
        superChatCurrency = snippet.superChatDetails.currency ?? null
        superChatTier = snippet.superChatDetails.tier
          ? String(snippet.superChatDetails.tier)
          : null
        messageText = snippet.superChatDetails.userComment ?? null
      }
      break
    case 'superStickerEvent':
      messageType = 'superSticker'
      if (snippet.superStickerDetails) {
        superChatAmount = snippet.superStickerDetails.amountMicros
          ? parseInt(snippet.superStickerDetails.amountMicros, 10) / 1_000_000
          : null
        superChatCurrency = snippet.superStickerDetails.currency ?? null
        superChatTier = snippet.superStickerDetails.tier
          ? String(snippet.superStickerDetails.tier)
          : null
      }
      break
    case 'newSponsorEvent':
      messageType = 'membership'
      membershipLevel = snippet.membershipGiftingDetails
        ? 'gifted'
        : 'new_member'
      break
    case 'membershipGiftingEvent':
      messageType = 'memberGift'
      giftCount = snippet.membershipGiftingDetails?.giftMembershipsCount ?? null
      break
    default:
      // Skip unknown message types
      return null
  }

  return {
    message_id: item.id ?? `${snippet.publishedAt}_${author.channelId}`,
    message_type: messageType,
    message_text: messageText,
    author_channel_id: author.channelId ?? '',
    author_display_name: author.displayName ?? '',
    author_profile_image_url: author.profileImageUrl ?? null,
    is_moderator: author.isChatModerator ?? false,
    is_member: author.isChatSponsor ?? false,
    super_chat_amount: superChatAmount,
    super_chat_currency: superChatCurrency,
    super_chat_tier: superChatTier,
    membership_level: membershipLevel,
    gift_count: giftCount,
    published_at: snippet.publishedAt ?? new Date().toISOString(),
  }
}

// ──────────────────────────────────────────────
// Chat Statistics Computation
// ──────────────────────────────────────────────

export interface ComputedChatStats {
  total_messages: number
  unique_chatters: number
  super_chat_count: number
  super_chat_total_jpy: number
  membership_count: number
  member_gift_total: number
  peak_chat_per_minute: number
  avg_chat_per_minute: number
}

// Approximate JPY conversion rates for super chat currencies
const JPY_RATES: Record<string, number> = {
  JPY: 1,
  USD: 150,
  EUR: 163,
  GBP: 190,
  KRW: 0.11,
  TWD: 4.7,
  CAD: 110,
  AUD: 98,
  HKD: 19,
  SGD: 112,
  PHP: 2.7,
  MYR: 34,
  INR: 1.8,
  BRL: 30,
  MXN: 8.8,
}

/**
 * Compute aggregate chat statistics from raw messages.
 */
export function computeChatStats(messages: RawChatMessage[]): ComputedChatStats {
  if (messages.length === 0) {
    return {
      total_messages: 0,
      unique_chatters: 0,
      super_chat_count: 0,
      super_chat_total_jpy: 0,
      membership_count: 0,
      member_gift_total: 0,
      peak_chat_per_minute: 0,
      avg_chat_per_minute: 0,
    }
  }

  const uniqueChannels = new Set<string>()
  let superChatCount = 0
  let superChatTotalJpy = 0
  let membershipCount = 0
  let memberGiftTotal = 0

  // For chat-per-minute calculation
  const minuteBuckets = new Map<string, number>()

  for (const msg of messages) {
    uniqueChannels.add(msg.author_channel_id)

    // Minute bucket key: "YYYY-MM-DDTHH:MM"
    const minuteKey = msg.published_at.slice(0, 16)
    minuteBuckets.set(minuteKey, (minuteBuckets.get(minuteKey) ?? 0) + 1)

    switch (msg.message_type) {
      case 'superChat':
      case 'superSticker':
        superChatCount++
        if (msg.super_chat_amount != null && msg.super_chat_currency) {
          const rate = JPY_RATES[msg.super_chat_currency] ?? 150 // default to USD rate
          superChatTotalJpy += msg.super_chat_amount * rate
        }
        break
      case 'membership':
        membershipCount++
        break
      case 'memberGift':
        memberGiftTotal += msg.gift_count ?? 1
        break
    }
  }

  const bucketValues = Array.from(minuteBuckets.values())
  const peakChatPerMinute = bucketValues.length > 0 ? Math.max(...bucketValues) : 0

  // Average chat per minute: total messages / duration in minutes
  const timestamps = messages.map(m => new Date(m.published_at).getTime())
  const durationMs = Math.max(...timestamps) - Math.min(...timestamps)
  const durationMinutes = Math.max(durationMs / 60_000, 1) // at least 1 minute
  const avgChatPerMinute = messages.length / durationMinutes

  return {
    total_messages: messages.length,
    unique_chatters: uniqueChannels.size,
    super_chat_count: superChatCount,
    super_chat_total_jpy: Math.round(superChatTotalJpy),
    membership_count: membershipCount,
    member_gift_total: memberGiftTotal,
    peak_chat_per_minute: peakChatPerMinute,
    avg_chat_per_minute: Math.round(avgChatPerMinute * 100) / 100,
  }
}

// ──────────────────────────────────────────────
// Concurrent Viewers Polling (for live streams)
// ──────────────────────────────────────────────

/**
 * Fetch current concurrent viewers for a live video.
 * Returns null if the stream is not currently live.
 */
export async function fetchConcurrentViewers(videoId: string): Promise<number | null> {
  const yt = getClient()
  const res = await yt.videos.list({
    part: ['liveStreamingDetails'],
    id: [videoId],
  })

  const items = res.data.items
  if (!items || items.length === 0) return null

  const live = items[0].liveStreamingDetails
  if (!live?.concurrentViewers) return null

  return parseInt(live.concurrentViewers, 10)
}

/**
 * Extract video ID from various YouTube URL formats.
 * Supports:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/live/VIDEO_ID
 * - Plain VIDEO_ID string
 */
export function extractVideoId(input: string): string {
  const trimmed = input.trim()

  // youtu.be/VIDEO_ID
  const shortMatch = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/)
  if (shortMatch) return shortMatch[1]

  // youtube.com/watch?v=VIDEO_ID
  const watchMatch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
  if (watchMatch) return watchMatch[1]

  // youtube.com/live/VIDEO_ID
  const liveMatch = trimmed.match(/youtube\.com\/live\/([a-zA-Z0-9_-]{11})/)
  if (liveMatch) return liveMatch[1]

  // Already a bare video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed

  throw new Error(`Cannot extract video ID from: ${input}`)
}
