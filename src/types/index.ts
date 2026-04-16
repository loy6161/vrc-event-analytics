// イベント型
export interface Event {
  id: number
  name: string
  date: string // YYYY-MM-DD
  start_time?: string // HH:MM
  end_time?: string // HH:MM
  world_id?: string // wrld_xxx
  instance_id?: string
  world_name?: string
  region?: string // us, eu, jp
  access_type?: string // public, invite, friends, friends+, invite+, group
  description?: string
  tags?: string[] // JSON配列を配列型に変換
  created_at: string // ISO 8601
}

// VRChatプレイヤーイベント
export interface PlayerEvent {
  id: number
  event_id: number
  user_id?: string // usr_xxx
  display_name: string
  event_type: 'join' | 'leave'
  timestamp: string // ISO 8601
  log_file?: string
}

// ユーザー型
export interface User {
  id: number
  user_id?: string // usr_xxx
  display_name: string
  first_seen?: string
  notes?: string
  tags?: string[] // JSON配列を配列型に変換
  is_staff: boolean
  is_excluded: boolean       // 分析から除外するユーザー（主催・出演者等）
  performer_role?: 'regular' | 'visitor' | null  // 出演者ロール
}

// ユーザー表示名履歴
export interface DisplayNameHistory {
  id: number
  user_id?: string
  display_name: string
  seen_at: string // ISO 8601
}

// YouTube配信型
export interface YouTubeStream {
  id: number
  event_id?: number
  video_id: string
  title?: string
  channel_id?: string
  channel_title?: string
  scheduled_start?: string
  actual_start?: string
  actual_end?: string
  peak_concurrent_viewers?: number
  total_view_count?: number
  like_count?: number
  comment_count?: number
  fetched_at?: string // ISO 8601
}

// YouTube同接ログ
export interface YouTubeConcurrentLog {
  id: number
  stream_id: number
  concurrent_viewers: number
  recorded_at: string // ISO 8601
}

// YouTubeチャットユーザー型
export interface YouTubeChatUser {
  id: number
  stream_id: number
  channel_id: string
  display_name: string
  profile_image_url?: string
  is_moderator: boolean
  is_member: boolean
  message_count: number
  first_message_at?: string
  last_message_at?: string
}

// YouTubeチャットメッセージ型
export type YouTubeChatMessageType =
  | 'text'
  | 'superChat'
  | 'superSticker'
  | 'membership'
  | 'memberGift'

export interface YouTubeChatMessage {
  id: number
  stream_id: number
  chat_user_id: number
  message_id: string
  message_type: YouTubeChatMessageType
  message_text?: string
  super_chat_amount?: number
  super_chat_currency?: string
  super_chat_tier?: string
  membership_level?: string
  gift_count?: number
  published_at: string // ISO 8601
}

// YouTubeチャット統計
export interface YouTubeChatStats {
  id: number
  stream_id: number
  total_messages: number
  unique_chatters: number
  super_chat_count: number
  super_chat_total_jpy: number
  membership_count: number
  member_gift_total: number
  peak_chat_per_minute: number
  avg_chat_per_minute: number
}

// インポートされたログファイルの履歴
export interface ImportedLog {
  id: number
  file_name: string
  file_hash: string
  imported_at: string // ISO 8601
  event_count: number
}

// API レスポンス型
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  timestamp: string
}

// イベント集計データ
export interface EventStats {
  total_attendees: number // ユニーク参加者数（再入場は1回）
  unique_attendees: number // ユニーク参加者数（後方互換）
  total_joins: number     // 生のJoin回数（再入場含む）
  peak_concurrent: number // ピーク同接
  avg_stay_duration: number // 平均滞在時間 (分)
  median_stay_duration: number
  max_stay_duration: number
  reentry_rate: number // 再入場率
  hourly_attendance: Array<{
    hour: string // 時間帯
    count: number
  }>
}

// YouTube統計
export interface YouTubeStreamStats {
  peak_concurrent_viewers: number
  total_view_count: number
  like_count: number
  comment_count: number
  chat_total_messages: number
  unique_chatters: number
  super_chat_count: number
  super_chat_total_jpy: number
  membership_count: number
  chat_peak_per_minute: number
}

// ユーザーランキング
export interface UserRankingItem {
  user_id?: string
  display_name: string
  attendance_count: number
  total_stay_duration: number
  avg_stay_duration: number
  first_attendance: string
  last_attendance: string
  rank: number
}

// YouTube チャットユーザーランキング
export interface YouTubeChatUserRanking {
  channel_id: string
  display_name: string
  message_count: number
  super_chat_count: number
  super_chat_total_jpy: number
  participation_count: number // 参加配信数
  rank: number
}

// 月次/年次レポート
export interface PeriodStats {
  period: string // "2025-03" or "2025"
  event_count: number
  total_attendees: number
  unique_attendees: number
  avg_attendees_per_event: number
  new_attendees: number
  repeat_attendee_rate: number
  total_super_chat_jpy?: number
  unique_chatters?: number
}

// 詳細イベント分析
export interface DetailedEventStats {
  // 滞在時間分布
  stay_distribution: Array<{
    bucket: string
    min_minutes: number
    max_minutes: number
    count: number
    percentage: number
  }>
  // 到着タイミング分布（イベント開始からの経過分）
  arrival_timeline: Array<{
    minutes_from_start: number
    count: number
    cumulative: number
  }>
  // 離脱タイミング分布
  departure_timeline: Array<{
    minutes_from_start: number
    count: number
    cumulative: number
  }>
  // 初参加者分析
  first_timer_count: number
  returner_count: number
  first_timer_rate: number
  // 早期離脱者
  early_leaver_count: number  // 15分以内に離脱
  early_leaver_rate: number
  // エンゲージメント指標
  engagement_score: number  // 0-100
  engagement_breakdown: {
    stay_score: number       // 滞在時間スコア
    retention_score: number  // リテンションスコア
    activity_score: number   // アクティビティスコア
  }
}

// クロスイベントインサイト
export interface EventInsights {
  // 総合スコア
  health_score: number  // 0-100
  health_grade: 'S' | 'A' | 'B' | 'C' | 'D'
  health_components: {
    growth: number      // 成長性
    retention: number   // リテンション
    engagement: number  // エンゲージメント
    community: number   // コミュニティ健全性
  }
  // 成長トレンド
  growth_trend: 'growing' | 'stable' | 'declining'
  growth_rate: number
  attendance_history: Array<{
    event_id: number
    event_name: string
    date: string
    unique_attendees: number
    total_joins: number
  }>
  // リテンション分析
  overall_retention_rate: number
  retention_by_event: Array<{
    event_id: number
    event_name: string
    date: string
    attendees: number
    returning_from_prev: number
    retention_rate: number
    new_attendees: number
  }>
  // コミュニティ分類
  community: {
    core_count: number      // >50% イベント参加
    regular_count: number   // 25-50%
    casual_count: number    // 2回以上 <25%
    onetime_count: number   // 1回のみ
    churned_count: number   // 最近3回不参加
    total_known: number
  }
  // リコメンデーション
  recommendations: Array<{
    category: 'growth' | 'retention' | 'engagement' | 'community' | 'timing'
    priority: 'high' | 'medium' | 'low'
    icon: string
    title: string
    description: string
    metric?: string
    suggestion?: string
  }>
}

// ログパーサー関連型
export interface LogParseResult {
  fileName: string
  fileHash: string
  summary: {
    totalLines: number
    parsedEvents: number
    joinCount: number
    leaveCount: number
    uniquePlayers: number
    worldChanges: number
    timeRange: { start: string; end: string } | null
  }
  sessions: LogSession[]
}

export interface LogSession {
  worldName?: string
  worldId?: string
  instanceId?: string
  region?: string
  accessType?: string
  startTime: string
  endTime: string
  players: LogSessionPlayer[]
}

export interface LogSessionPlayer {
  displayName: string
  userId?: string
  joinTime: string
  leaveTime: string | null
  durationMinutes: number | null
}
