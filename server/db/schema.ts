import { createClient, type Client } from '@libsql/client'

let db: Client | null = null

export function getDatabase(): Client {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.')
  }
  return db
}

export async function initializeDatabase(): Promise<void> {
  db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  })

  // Create tables
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      world_id TEXT,
      instance_id TEXT,
      world_name TEXT,
      region TEXT,
      access_type TEXT,
      description TEXT,
      tags TEXT,
      series TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS player_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER REFERENCES events(id),
      user_id TEXT,
      display_name TEXT NOT NULL,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      log_file TEXT,
      UNIQUE(event_id, display_name, event_type, timestamp)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT UNIQUE,
      display_name TEXT NOT NULL,
      first_seen TEXT,
      notes TEXT,
      tags TEXT,
      is_staff INTEGER DEFAULT 0,
      is_excluded INTEGER DEFAULT 0,
      performer_role TEXT
    );

    CREATE TABLE IF NOT EXISTS display_name_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      display_name TEXT NOT NULL,
      seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS youtube_streams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER REFERENCES events(id),
      video_id TEXT NOT NULL,
      title TEXT,
      channel_id TEXT,
      channel_title TEXT,
      scheduled_start TEXT,
      actual_start TEXT,
      actual_end TEXT,
      peak_concurrent_viewers INTEGER,
      total_view_count INTEGER,
      like_count INTEGER,
      comment_count INTEGER,
      fetched_at TEXT
    );

    CREATE TABLE IF NOT EXISTS youtube_concurrent_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id INTEGER REFERENCES youtube_streams(id),
      concurrent_viewers INTEGER,
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS youtube_chat_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id INTEGER REFERENCES youtube_streams(id),
      channel_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      profile_image_url TEXT,
      is_moderator INTEGER DEFAULT 0,
      is_member INTEGER DEFAULT 0,
      message_count INTEGER DEFAULT 0,
      first_message_at TEXT,
      last_message_at TEXT,
      UNIQUE(stream_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS youtube_chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id INTEGER REFERENCES youtube_streams(id),
      chat_user_id INTEGER REFERENCES youtube_chat_users(id),
      message_id TEXT UNIQUE,
      message_type TEXT NOT NULL,
      message_text TEXT,
      super_chat_amount REAL,
      super_chat_currency TEXT,
      super_chat_tier TEXT,
      membership_level TEXT,
      gift_count INTEGER,
      published_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS youtube_chat_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id INTEGER REFERENCES youtube_streams(id) UNIQUE,
      total_messages INTEGER DEFAULT 0,
      unique_chatters INTEGER DEFAULT 0,
      super_chat_count INTEGER DEFAULT 0,
      super_chat_total_jpy REAL DEFAULT 0,
      membership_count INTEGER DEFAULT 0,
      member_gift_total INTEGER DEFAULT 0,
      peak_chat_per_minute INTEGER DEFAULT 0,
      avg_chat_per_minute REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS imported_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      file_hash TEXT NOT NULL UNIQUE,
      imported_at TEXT DEFAULT (datetime('now')),
      event_count INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_player_events_event ON player_events(event_id);
    CREATE INDEX IF NOT EXISTS idx_player_events_user ON player_events(display_name);
    CREATE INDEX IF NOT EXISTS idx_player_events_time ON player_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_users_user_id ON users(user_id);
    CREATE INDEX IF NOT EXISTS idx_youtube_event ON youtube_streams(event_id);
    CREATE INDEX IF NOT EXISTS idx_chat_users_stream ON youtube_chat_users(stream_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_stream ON youtube_chat_messages(stream_id);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_time ON youtube_chat_messages(published_at);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_type ON youtube_chat_messages(message_type);

    -- シリーズ（clubVERSE / theALL / VERSARY...）のマスタ。
    -- events.series は name を非正規化で保持し、こちらは色・市民権判定対象・並び順などのメタを持つ。
    CREATE TABLE IF NOT EXISTS series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      citizenship_target INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- ユーザーバッジ。出演者制度（シリーズ別）・関係者・スタッフ・要注意を一元管理。
    -- badge_type: 'regular'(レギュラー出演) | 'visitor'(ビジター出演) | 'performer'(出演者・汎用)
    --           | 'manager'(出演者の関係者/マネージャー) | 'staff'(イベントスタッフ) | 'watch'(要注意人物)
    -- series: 対象シリーズ名（'' = 全体）。レギュラー/ビジターは clubVERSE の制度なのでシリーズ別に持つ。
    -- note: 補足（誰のマネージャーか・要注意の事由 等）
    CREATE TABLE IF NOT EXISTS user_badges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      badge_type TEXT NOT NULL,
      series TEXT NOT NULL DEFAULT '',
      note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(display_name, badge_type, series)
    );

    CREATE INDEX IF NOT EXISTS idx_user_badges_name ON user_badges(display_name);
    CREATE INDEX IF NOT EXISTS idx_user_badges_type ON user_badges(badge_type);

    -- アバター切替イベント。VRChatログの "Switching <name> to avatar <avatar>" 行から抽出。
    -- avatar_author は "Unpacking Avatar (<avatar> by <author>)" 行から名前一致で補完。
    CREATE TABLE IF NOT EXISTS avatar_switches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER REFERENCES events(id),
      display_name TEXT NOT NULL,
      avatar_name TEXT NOT NULL,
      avatar_author TEXT,
      timestamp TEXT NOT NULL,
      log_file TEXT,
      UNIQUE(event_id, display_name, avatar_name, timestamp)
    );

    CREATE INDEX IF NOT EXISTS idx_avatar_switches_event ON avatar_switches(event_id);
    CREATE INDEX IF NOT EXISTS idx_avatar_switches_name ON avatar_switches(display_name);
  `)

  // ── Migrations for pre-existing databases ─────────────────────────
  // CREATE TABLE IF NOT EXISTS は既存テーブルに列を足さないので、後付け列は ALTER で補う。
  // 既に列がある場合は "duplicate column name" で失敗するだけなので握りつぶす。
  try {
    await db.execute('ALTER TABLE events ADD COLUMN series TEXT')
  } catch { /* column already exists */ }
  await db.execute('CREATE INDEX IF NOT EXISTS idx_events_series ON events(series)')

  // 開催形態（手動）。事前申請制・招待制など、ログから取れない運用形態を記録する
  try {
    await db.execute('ALTER TABLE events ADD COLUMN format TEXT')
  } catch { /* column already exists */ }

  // access_type の精緻化バックフィル（冪等）。
  // 旧パーサーは group インスタンスを一律 'group' にしていたが、instance_id には
  // ~groupAccessType(plus|members|public) が残っているので、そこから Group+/Group公開 を復元する。
  await db.execute(`UPDATE events SET access_type = 'group+'
    WHERE instance_id LIKE '%groupAccessType(plus)%' AND access_type != 'group+'`)
  await db.execute(`UPDATE events SET access_type = 'group public'
    WHERE instance_id LIKE '%groupAccessType(public)%' AND access_type != 'group public'`)

  // 旧 users.performer_role を user_badges へ移行（消費型＝一度きり）。
  // レギュラー/ビジターは clubVERSE の制度なので series='clubVERSE' で移す。
  await db.execute(`INSERT OR IGNORE INTO user_badges (display_name, badge_type, series)
    SELECT display_name, performer_role, 'clubVERSE' FROM users WHERE performer_role IS NOT NULL`)
  await db.execute(`UPDATE users SET performer_role = NULL WHERE performer_role IS NOT NULL`)

  // 既存イベントで使われているシリーズ名を series マスタへ取り込む（初回のみ・色などは未設定）。
  // 既に行があれば無視されるので何度実行しても安全。
  await db.execute(`
    INSERT OR IGNORE INTO series (name)
    SELECT DISTINCT series FROM events
    WHERE series IS NOT NULL AND series != ''
  `)
}

export function closeDatabase(): void {
  db = null
}
