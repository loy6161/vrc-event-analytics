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
  `)
}

export function closeDatabase(): void {
  db = null
}
