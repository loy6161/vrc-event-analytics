import { getDatabase } from './schema.js'
import type { Event, PlayerEvent, User, ImportedLog } from '../../src/types/index.js'

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function tagsToJson(tags: string[] | undefined): string | null {
  return tags && tags.length > 0 ? JSON.stringify(tags) : null
}

function jsonToTags(json: string | null): string[] | undefined {
  if (!json) return undefined
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

function mapEvent(row: any): Event {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    start_time: row.start_time ?? undefined,
    end_time: row.end_time ?? undefined,
    world_id: row.world_id ?? undefined,
    instance_id: row.instance_id ?? undefined,
    world_name: row.world_name ?? undefined,
    region: row.region ?? undefined,
    access_type: row.access_type ?? undefined,
    description: row.description ?? undefined,
    tags: jsonToTags(row.tags),
    series: row.series ?? undefined,
    created_at: row.created_at,
  }
}

function mapUser(row: any): User {
  return {
    id: row.id,
    user_id: row.user_id ?? undefined,
    display_name: row.display_name,
    first_seen: row.first_seen ?? undefined,
    notes: row.notes ?? undefined,
    tags: jsonToTags(row.tags),
    is_staff: row.is_staff === 1,
    is_excluded: row.is_excluded === 1,
    performer_role: (row.performer_role as 'regular' | 'visitor' | null) ?? null,
  }
}

function mapPlayerEvent(row: any): PlayerEvent {
  return {
    id: row.id,
    event_id: row.event_id,
    user_id: row.user_id ?? undefined,
    display_name: row.display_name,
    event_type: row.event_type,
    timestamp: row.timestamp,
    log_file: row.log_file ?? undefined,
  }
}

// ──────────────────────────────────────────────
// Events
// ──────────────────────────────────────────────

export async function getEvents(): Promise<Event[]> {
  const result = await getDatabase().execute(
    'SELECT * FROM events ORDER BY date DESC, start_time DESC'
  )
  return result.rows.map(r => mapEvent(r as any))
}

export async function getEventById(id: number): Promise<Event | null> {
  const result = await getDatabase().execute({
    sql: 'SELECT * FROM events WHERE id = ?',
    args: [id],
  })
  const row = result.rows[0]
  return row ? mapEvent(row as any) : null
}

// 同じ論理日の既存イベントを1件返す（ログ取込の find-or-create 用。1夜=1イベントに結合）。
export async function findEventByDate(date: string): Promise<Event | null> {
  const result = await getDatabase().execute({
    sql: 'SELECT * FROM events WHERE date = ? ORDER BY start_time ASC LIMIT 1',
    args: [date],
  })
  const row = result.rows[0]
  return row ? mapEvent(row as any) : null
}

export interface CreateEventInput {
  name: string
  date: string
  start_time?: string
  end_time?: string
  world_id?: string
  instance_id?: string
  world_name?: string
  region?: string
  access_type?: string
  description?: string
  tags?: string[]
  series?: string
}

export async function createEvent(data: CreateEventInput): Promise<Event> {
  const result = await getDatabase().execute({
    sql: `INSERT INTO events (name, date, start_time, end_time, world_id, instance_id, world_name, region, access_type, description, tags, series)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      data.name,
      data.date,
      data.start_time ?? null,
      data.end_time ?? null,
      data.world_id ?? null,
      data.instance_id ?? null,
      data.world_name ?? null,
      data.region ?? null,
      data.access_type ?? null,
      data.description ?? null,
      tagsToJson(data.tags),
      data.series || null, // 空文字は未分類(null)として保存
    ],
  })
  return (await getEventById(Number(result.lastInsertRowid)))!
}

export async function updateEvent(id: number, data: Partial<CreateEventInput>): Promise<Event | null> {
  const existing = await getEventById(id)
  if (!existing) return null

  await getDatabase().execute({
    sql: `UPDATE events SET
            name = ?, date = ?, start_time = ?, end_time = ?,
            world_id = ?, instance_id = ?, world_name = ?,
            region = ?, access_type = ?, description = ?, tags = ?, series = ?
          WHERE id = ?`,
    args: [
      data.name ?? existing.name,
      data.date ?? existing.date,
      data.start_time ?? existing.start_time ?? null,
      data.end_time ?? existing.end_time ?? null,
      data.world_id ?? existing.world_id ?? null,
      data.instance_id ?? existing.instance_id ?? null,
      data.world_name ?? existing.world_name ?? null,
      data.region ?? existing.region ?? null,
      data.access_type ?? existing.access_type ?? null,
      data.description ?? existing.description ?? null,
      tagsToJson(data.tags ?? existing.tags),
      // 空文字は「シリーズ解除」として null に正規化
      (data.series ?? existing.series) || null,
      id,
    ],
  })
  return getEventById(id)
}

// ── Series ─────────────────────────────────────

// 登録済みシリーズ名の一覧（サジェスト・フィルタ用）。新しいイベントで使われた順。
export async function getDistinctSeries(): Promise<string[]> {
  const result = await getDatabase().execute(
    `SELECT series, MAX(date) as latest FROM events
     WHERE series IS NOT NULL AND series != ''
     GROUP BY series ORDER BY latest DESC`
  )
  return (result.rows as any[]).map(r => String(r.series))
}

// シリーズの自動推定。
//  1. 同じ world_id の過去イベントに series が付いていれば再利用（同じ会場の再訪）
//  2. ワールド名（空白除去・小文字化）に既知のシリーズ名が含まれていればそれ
//     例: series "club VERSE" は「【毎週金曜定期ライブ】club VERSE ver1.3」にマッチ
export async function inferSeries(worldId?: string, worldName?: string): Promise<string | null> {
  const db = getDatabase()
  if (worldId) {
    const r = await db.execute({
      sql: `SELECT series FROM events
            WHERE world_id = ? AND series IS NOT NULL AND series != ''
            ORDER BY date DESC LIMIT 1`,
      args: [worldId],
    })
    if (r.rows[0]) return String((r.rows[0] as any).series)
  }
  if (worldName) {
    const known = await getDistinctSeries()
    const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '')
    const w = squash(worldName)
    for (const s of known) {
      if (w.includes(squash(s))) return s
    }
  }
  return null
}

// 複数イベントへシリーズを一括設定（null で解除）
export async function bulkSetSeries(eventIds: number[], series: string | null): Promise<number> {
  if (eventIds.length === 0) return 0
  const placeholders = eventIds.map(() => '?').join(',')
  const result = await getDatabase().execute({
    sql: `UPDATE events SET series = ? WHERE id IN (${placeholders})`,
    args: [series, ...eventIds],
  })
  return result.rowsAffected
}

export async function deleteEvent(id: number): Promise<boolean> {
  const result = await getDatabase().execute({
    sql: 'DELETE FROM events WHERE id = ?',
    args: [id],
  })
  return result.rowsAffected > 0
}

// イベントの開始/終了時刻を、紐づく player_events の実タイムスタンプ最小〜最大から再計算する。
// ・複数ログファイルを結合しても夜全体の範囲になる
// ・timestamp は ISO ローカル("2025-01-17T23:50:00")なので MIN/MAX の文字列比較で
//   日付込みで正しく並ぶ（深夜0時跨ぎでも開始/終了が逆転しない）
export async function recomputeEventTimespan(eventId: number): Promise<void> {
  const result = await getDatabase().execute({
    sql: 'SELECT MIN(timestamp) AS min_ts, MAX(timestamp) AS max_ts FROM player_events WHERE event_id = ?',
    args: [eventId],
  })
  const row = result.rows[0] as any
  if (!row || !row.min_ts) return
  const start = String(row.min_ts).slice(11, 16) // "HH:MM"
  const end = String(row.max_ts).slice(11, 16)
  await getDatabase().execute({
    sql: 'UPDATE events SET start_time = ?, end_time = ? WHERE id = ?',
    args: [start, end, eventId],
  })
}

export async function mergeEvents(targetId: number, sourceIds: number[]): Promise<Event | null> {
  const db = getDatabase()
  const stmts = sourceIds.flatMap(srcId => [
    { sql: 'UPDATE player_events SET event_id = ? WHERE event_id = ?', args: [targetId, srcId] },
    { sql: 'DELETE FROM events WHERE id = ?', args: [srcId] },
  ])
  await db.batch(stmts, 'write')
  return getEventById(targetId)
}

// ──────────────────────────────────────────────
// Player Events
// ──────────────────────────────────────────────

export interface InsertPlayerEventInput {
  event_id: number
  user_id?: string
  display_name: string
  event_type: 'join' | 'leave'
  timestamp: string
  log_file?: string
}

// libSQL(Turso) のバッチ/ペイロード上限とサーバーレスのタイムアウトを避けるため、
// 大きいログは一定件数ずつに分割して書き込む。
const DB_CHUNK = 500

export async function insertPlayerEventsBatch(events: InsertPlayerEventInput[]): Promise<number> {
  if (events.length === 0) return 0
  const db = getDatabase()
  let inserted = 0
  for (let i = 0; i < events.length; i += DB_CHUNK) {
    const slice = events.slice(i, i + DB_CHUNK)
    const stmts = slice.map(e => ({
      sql: `INSERT OR IGNORE INTO player_events (event_id, user_id, display_name, event_type, timestamp, log_file)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [e.event_id, e.user_id ?? null, e.display_name, e.event_type, e.timestamp, e.log_file ?? null],
    }))
    const results = await db.batch(stmts, 'write')
    inserted += results.reduce((sum, r) => sum + r.rowsAffected, 0)
  }
  return inserted
}

export async function getPlayerEventsByEventId(eventId: number): Promise<PlayerEvent[]> {
  const result = await getDatabase().execute({
    sql: 'SELECT * FROM player_events WHERE event_id = ? ORDER BY timestamp ASC',
    args: [eventId],
  })
  return result.rows.map(r => mapPlayerEvent(r as any))
}

export async function deletePlayerEventsByEventId(eventId: number): Promise<number> {
  const result = await getDatabase().execute({
    sql: 'DELETE FROM player_events WHERE event_id = ?',
    args: [eventId],
  })
  return result.rowsAffected
}

// ──────────────────────────────────────────────
// Users
// ──────────────────────────────────────────────

export interface UpsertUserInput {
  user_id?: string
  display_name: string
  first_seen?: string
}

export async function upsertUser(data: UpsertUserInput): Promise<void> {
  const db = getDatabase()

  if (data.user_id) {
    const existing = await db.execute({
      sql: 'SELECT id FROM users WHERE user_id = ?',
      args: [data.user_id],
    })
    if (existing.rows.length > 0) {
      await db.execute({
        sql: 'UPDATE users SET display_name = ? WHERE user_id = ?',
        args: [data.display_name, data.user_id],
      })
    } else {
      await db.execute({
        sql: 'INSERT INTO users (user_id, display_name, first_seen) VALUES (?, ?, ?)',
        args: [data.user_id, data.display_name, data.first_seen ?? null],
      })
    }
  } else {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO users (user_id, display_name, first_seen) VALUES (NULL, ?, ?)',
      args: [data.display_name, data.first_seen ?? null],
    })
  }
}

// 旧実装は1人ずつ SELECT+UPDATE/INSERT を await（クラウドDBへN回往復＝タイムアウトの主因）。
// user_id は UNIQUE 制約があるので ON CONFLICT で一括 upsert。user_id 無しは従来どおり INSERT OR IGNORE。
export async function upsertUsersBatch(users: UpsertUserInput[]): Promise<void> {
  if (users.length === 0) return
  const db = getDatabase()
  const withId = users.filter(u => u.user_id)
  const withoutId = users.filter(u => !u.user_id)

  for (let i = 0; i < withId.length; i += DB_CHUNK) {
    const stmts = withId.slice(i, i + DB_CHUNK).map(u => ({
      sql: `INSERT INTO users (user_id, display_name, first_seen) VALUES (?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name`,
      args: [u.user_id!, u.display_name, u.first_seen ?? null],
    }))
    if (stmts.length > 0) await db.batch(stmts, 'write')
  }

  for (let i = 0; i < withoutId.length; i += DB_CHUNK) {
    const stmts = withoutId.slice(i, i + DB_CHUNK).map(u => ({
      sql: 'INSERT OR IGNORE INTO users (user_id, display_name, first_seen) VALUES (NULL, ?, ?)',
      args: [u.display_name, u.first_seen ?? null],
    }))
    if (stmts.length > 0) await db.batch(stmts, 'write')
  }
}

export async function getUsers(): Promise<User[]> {
  const result = await getDatabase().execute(
    'SELECT * FROM users ORDER BY display_name ASC'
  )
  return result.rows.map(r => mapUser(r as any))
}

export async function getUserByDisplayName(displayName: string): Promise<User | null> {
  const result = await getDatabase().execute({
    sql: 'SELECT * FROM users WHERE display_name = ? LIMIT 1',
    args: [displayName],
  })
  const row = result.rows[0]
  return row ? mapUser(row as any) : null
}

export async function updateUser(
  displayName: string,
  updates: { notes?: string; tags?: string[]; is_staff?: boolean; is_excluded?: boolean; performer_role?: 'regular' | 'visitor' | null },
): Promise<User | null> {
  const db = getDatabase()
  const existing = await db.execute({
    sql: 'SELECT * FROM users WHERE display_name = ? LIMIT 1',
    args: [displayName],
  })
  if (existing.rows.length === 0) return null
  const row = existing.rows[0] as any

  const notes = updates.notes !== undefined ? updates.notes : row.notes
  const tags = updates.tags !== undefined ? tagsToJson(updates.tags) : row.tags
  const is_staff = updates.is_staff !== undefined ? (updates.is_staff ? 1 : 0) : row.is_staff
  const is_excluded = updates.is_excluded !== undefined ? (updates.is_excluded ? 1 : 0) : (row.is_excluded ?? 0)
  const performer_role = 'performer_role' in updates ? (updates.performer_role ?? null) : (row.performer_role ?? null)

  await db.execute({
    sql: 'UPDATE users SET notes = ?, tags = ?, is_staff = ?, is_excluded = ?, performer_role = ? WHERE display_name = ?',
    args: [notes, tags, is_staff, is_excluded, performer_role, displayName],
  })

  return getUserByDisplayName(displayName)
}

// ──────────────────────────────────────────────
// Display Name History
// ──────────────────────────────────────────────

export async function recordDisplayNameHistory(
  userId: string | null,
  displayName: string,
  seenAt: string,
): Promise<void> {
  const db = getDatabase()

  const existing = userId
    ? await db.execute({
        sql: 'SELECT id FROM display_name_history WHERE user_id = ? AND display_name = ? LIMIT 1',
        args: [userId, displayName],
      })
    : await db.execute({
        sql: 'SELECT id FROM display_name_history WHERE user_id IS NULL AND display_name = ? LIMIT 1',
        args: [displayName],
      })

  if (existing.rows.length === 0) {
    await db.execute({
      sql: 'INSERT INTO display_name_history (user_id, display_name, seen_at) VALUES (?, ?, ?)',
      args: [userId, displayName, seenAt],
    })
  }
}

// 旧コードはルートで Promise.all(map(recordDisplayNameHistory)) ＝ 1人につき SELECT+INSERT を
// 同時並行で発火（2N クエリのバースト）。重複判定を SQL 側 (WHERE NOT EXISTS) に寄せ、分割バッチ化する。
export interface DisplayNameHistoryInput {
  user_id: string | null
  display_name: string
  seen_at: string
}

export async function recordDisplayNameHistoryBatch(entries: DisplayNameHistoryInput[]): Promise<void> {
  if (entries.length === 0) return
  const db = getDatabase()
  for (let i = 0; i < entries.length; i += DB_CHUNK) {
    const stmts = entries.slice(i, i + DB_CHUNK).map(e =>
      e.user_id
        ? {
            sql: `INSERT INTO display_name_history (user_id, display_name, seen_at)
                  SELECT ?, ?, ? WHERE NOT EXISTS (
                    SELECT 1 FROM display_name_history WHERE user_id = ? AND display_name = ?)`,
            args: [e.user_id, e.display_name, e.seen_at, e.user_id, e.display_name],
          }
        : {
            sql: `INSERT INTO display_name_history (user_id, display_name, seen_at)
                  SELECT NULL, ?, ? WHERE NOT EXISTS (
                    SELECT 1 FROM display_name_history WHERE user_id IS NULL AND display_name = ?)`,
            args: [e.display_name, e.seen_at, e.display_name],
          }
    )
    await db.batch(stmts, 'write')
  }
}

// ──────────────────────────────────────────────
// Imported Logs
// ──────────────────────────────────────────────

export async function isLogImported(fileHash: string): Promise<boolean> {
  const result = await getDatabase().execute({
    sql: 'SELECT id FROM imported_logs WHERE file_hash = ?',
    args: [fileHash],
  })
  return result.rows.length > 0
}

export async function recordImportedLog(fileName: string, fileHash: string, eventCount: number): Promise<void> {
  await getDatabase().execute({
    sql: 'INSERT OR IGNORE INTO imported_logs (file_name, file_hash, event_count) VALUES (?, ?, ?)',
    args: [fileName, fileHash, eventCount],
  })
}

export async function getImportedLogs(): Promise<ImportedLog[]> {
  const result = await getDatabase().execute(
    'SELECT * FROM imported_logs ORDER BY imported_at DESC'
  )
  return result.rows as any[]
}

export async function deleteImportedLog(id: number): Promise<{ deleted: boolean; playerEventsDeleted: number; eventsDeleted: number }> {
  const db = getDatabase()

  const logRecord = await db.execute({
    sql: 'SELECT * FROM imported_logs WHERE id = ?',
    args: [id],
  })
  if (logRecord.rows.length === 0) {
    return { deleted: false, playerEventsDeleted: 0, eventsDeleted: 0 }
  }

  const fileName = (logRecord.rows[0] as any).file_name

  const affectedResult = await db.execute({
    sql: 'SELECT DISTINCT event_id FROM player_events WHERE log_file = ?',
    args: [fileName],
  })
  const affectedEventIds = affectedResult.rows.map((r: any) => r.event_id as number)

  const deleteResult = await db.execute({
    sql: 'DELETE FROM player_events WHERE log_file = ?',
    args: [fileName],
  })
  const playerEventsDeleted = deleteResult.rowsAffected

  let eventsDeleted = 0
  for (const eventId of affectedEventIds) {
    const remaining = await db.execute({
      sql: 'SELECT COUNT(*) as cnt FROM player_events WHERE event_id = ?',
      args: [eventId],
    })
    const cnt = (remaining.rows[0] as any)?.cnt ?? 0
    if (cnt === 0) {
      await db.execute({ sql: 'DELETE FROM events WHERE id = ?', args: [eventId] })
      eventsDeleted++
    }
  }

  await db.execute({ sql: 'DELETE FROM imported_logs WHERE id = ?', args: [id] })

  return { deleted: true, playerEventsDeleted, eventsDeleted }
}
