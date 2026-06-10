/**
 * Migrate local SQLite data to Turso (libsql cloud).
 * Usage: node --import tsx scripts/migrate-to-turso.ts
 */
import 'dotenv/config'
import { createClient } from '@libsql/client'
import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, '../data/analytics.db')

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
})

function query<T = Record<string, unknown>>(sql: string): T[] {
  const out = execSync(`sqlite3 -json "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`, { encoding: 'utf8' }).trim()
  if (!out) return []
  return JSON.parse(out) as T[]
}

async function migrate() {
  console.log(`\n📦 Migrating from: ${DB_PATH}\n`)

  // ── events ──────────────────────────────────────────────────────
  const events = query('SELECT * FROM events ORDER BY id')
  console.log(`events: ${events.length} rows`)
  if (events.length > 0) {
    for (const e of events as any[]) {
      await client.execute({
        sql: `INSERT OR IGNORE INTO events (id, name, date, start_time, end_time, world_id, instance_id, world_name, region, access_type, description, tags)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [e.id, e.name, e.date, e.start_time ?? null, e.end_time ?? null,
               e.world_id ?? null, e.instance_id ?? null, e.world_name ?? null,
               e.region ?? null, e.access_type ?? null, e.description ?? null, e.tags ?? null],
      })
    }
    console.log(`  ✓ inserted ${events.length} events`)
  }

  // ── player_events ────────────────────────────────────────────────
  const playerEvents = query('SELECT * FROM player_events ORDER BY id')
  console.log(`player_events: ${playerEvents.length} rows`)
  if (playerEvents.length > 0) {
    const BATCH = 100
    for (let i = 0; i < playerEvents.length; i += BATCH) {
      const chunk = (playerEvents as any[]).slice(i, i + BATCH)
      await client.batch(chunk.map(pe => ({
        sql: `INSERT OR IGNORE INTO player_events (id, event_id, user_id, display_name, event_type, timestamp, log_file)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [pe.id, pe.event_id ?? null, pe.user_id ?? null, pe.display_name,
               pe.event_type, pe.timestamp, pe.log_file ?? null],
      })), 'write')
    }
    console.log(`  ✓ inserted ${playerEvents.length} player_events`)
  }

  // ── users ────────────────────────────────────────────────────────
  const users = query('SELECT * FROM users ORDER BY id')
  console.log(`users: ${users.length} rows`)
  if (users.length > 0) {
    for (const u of users as any[]) {
      await client.execute({
        sql: `INSERT OR IGNORE INTO users (id, user_id, display_name, first_seen, is_staff, is_excluded, notes, tags, performer_role)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [u.id, u.user_id ?? null, u.display_name, u.first_seen ?? null,
               u.is_staff ?? 0, u.is_excluded ?? 0, u.notes ?? null,
               u.tags ?? null, u.performer_role ?? null],
      })
    }
    console.log(`  ✓ inserted ${users.length} users`)
  }

  // ── imported_logs ────────────────────────────────────────────────
  const logs = query('SELECT * FROM imported_logs ORDER BY id')
  console.log(`imported_logs: ${logs.length} rows`)
  if (logs.length > 0) {
    for (const l of logs as any[]) {
      await client.execute({
        sql: `INSERT OR IGNORE INTO imported_logs (id, file_name, file_hash, imported_at, event_count)
              VALUES (?, ?, ?, ?, ?)`,
        args: [l.id, l.file_name, l.file_hash, l.imported_at ?? null, l.player_events_count ?? l.event_count ?? 0],
      })
    }
    console.log(`  ✓ inserted ${logs.length} imported_logs`)
  }

  // ── display_name_history ─────────────────────────────────────────
  const history = query('SELECT * FROM display_name_history ORDER BY id')
  console.log(`display_name_history: ${history.length} rows`)
  if (history.length > 0) {
    for (const h of history as any[]) {
      await client.execute({
        sql: `INSERT OR IGNORE INTO display_name_history (id, user_id, display_name, seen_at)
              VALUES (?, ?, ?, ?)`,
        args: [h.id, h.user_id ?? null, h.display_name, h.observed_at ?? h.seen_at ?? null],
      })
    }
    console.log(`  ✓ inserted ${history.length} display_name_history`)
  }

  console.log('\n✅ Migration complete!\n')
  client.close()
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err)
  process.exit(1)
})
