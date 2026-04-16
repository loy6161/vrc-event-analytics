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
}

export async function createEvent(data: CreateEventInput): Promise<Event> {
  const result = await getDatabase().execute({
    sql: `INSERT INTO events (name, date, start_time, end_time, world_id, instance_id, world_name, region, access_type, description, tags)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            region = ?, access_type = ?, description = ?, tags = ?
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
      id,
    ],
  })
  return getEventById(id)
}

export async function deleteEvent(id: number): Promise<boolean> {
  const result = await getDatabase().execute({
    sql: 'DELETE FROM events WHERE id = ?',
    args: [id],
  })
  return result.rowsAffected > 0
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

export async function insertPlayerEventsBatch(events: InsertPlayerEventInput[]): Promise<number> {
  if (events.length === 0) return 0
  const db = getDatabase()
  const stmts = events.map(e => ({
    sql: `INSERT OR IGNORE INTO player_events (event_id, user_id, display_name, event_type, timestamp, log_file)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [e.event_id, e.user_id ?? null, e.display_name, e.event_type, e.timestamp, e.log_file ?? null],
  }))
  const results = await db.batch(stmts, 'write')
  return results.reduce((sum, r) => sum + r.rowsAffected, 0)
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

export async function upsertUsersBatch(users: UpsertUserInput[]): Promise<void> {
  for (const u of users) {
    await upsertUser(u)
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
