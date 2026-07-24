import fs from 'fs'
import os from 'os'
import path from 'path'
import { parseLogFile, segmentIntoSessions, logicalDate, type WorldSession } from '../server/services/log-parser.js'

const CLUBVERSE_WORLD_ID = 'wrld_ee479ef0-efd0-48a5-b6f2-0cb7e4793bd3'
const DEFAULT_API_BASE = 'https://vrc-event-analytics.onrender.com'
const STABLE_AGE_MS = 10 * 60 * 1000
const MIN_UNIQUE_PLAYERS = 5

type ScanState = Record<string, { size: number; mtimeMs: number; result: string }>

const SUPABASE_PROJECT = 'aegjgukkpkyhixqxpsoy'
const DEFAULT_X_ENV = 'L:\\企画用\\App_Dev\\apps\\loyall\\X_Analytics\\.env'

function arg(name: string) {
  const prefix = `--${name}=`
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)
}

const dryRun = process.argv.includes('--dry-run')
const rescan = process.argv.includes('--rescan')
const days = Math.max(1, Number(arg('days') ?? 120))
const apiBase = (process.env.VRC_ANALYTICS_URL || DEFAULT_API_BASE).replace(/\/$/, '')
const logDir = process.env.VRC_LOG_DIR || path.join(
  process.env.USERPROFILE || os.homedir(),
  'AppData', 'LocalLow', 'VRChat', 'VRChat',
)
const stateDir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ALLVERSE')
const statePath = path.join(stateDir, 'clubverse-auto-import.json')

function loadState(): ScanState {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')) }
  catch { return {} }
}

function saveState(state: ScanState) {
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8')
}

function supabaseToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  const envPath = process.env.X_ANALYTICS_ENV || DEFAULT_X_ENV
  if (!fs.existsSync(envPath)) throw new Error(`SUPABASE_ACCESS_TOKEN not found: ${envPath}`)
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find(value => value.startsWith('SUPABASE_ACCESS_TOKEN='))
  const token = line?.slice('SUPABASE_ACCESS_TOKEN='.length).trim().replace(/^['"]|['"]$/g, '')
  if (!token) throw new Error(`SUPABASE_ACCESS_TOKEN is empty: ${envPath}`)
  return token
}

async function runSupabaseSql(query: string) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${supabaseToken()}`,
      'Content-Type': 'application/json',
      'User-Agent': 'node',
    },
    body: JSON.stringify({ query }),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`Supabase ledger update failed (${response.status}): ${body}`)
  return JSON.parse(body)
}

async function ensureOccurrence(day: string) {
  const safeDay = day.replace(/[^0-9-]/g, '')
  const sql = `
do $$
declare next_volume integer;
begin
  if not exists (
    select 1 from event_occurrences
    where shared_event_id = 'clubverse' and date = '${safeDay}' and occ_type = 'vr_live'
  ) then
    select coalesce(max((substring(note from 'Vol\\.([0-9]+)'))::integer), 0) + 1
      into next_volume
      from event_occurrences
      where shared_event_id = 'clubverse' and note ~ '^Vol\\.[0-9]+$';
    insert into event_occurrences (shared_event_id, date, occ_type, source, note)
    values ('clubverse', '${safeDay}', 'vr_live', 'vrc-auto', 'Vol.' || next_volume);
  end if;
end $$;
select id, date::text, note, vrc_event_id from event_occurrences
where shared_event_id = 'clubverse' and date = '${safeDay}' and occ_type = 'vr_live'
order by id limit 1;`
  const rows = await runSupabaseSql(sql)
  return rows?.[0]
}

async function linkOccurrence(day: string, vrcEventId?: number) {
  if (!vrcEventId) return
  const safeDay = day.replace(/[^0-9-]/g, '')
  await runSupabaseSql(`update event_occurrences set vrc_event_id = ${Math.trunc(vrcEventId)} where shared_event_id = 'clubverse' and date = '${safeDay}' and occ_type = 'vr_live';`)
}

function uniquePlayers(sessions: WorldSession[]) {
  return new Set(sessions.flatMap(session => session.playerEvents.map(event => event.userId || event.displayName))).size
}

function isFridaySession(session: WorldSession) {
  const day = logicalDate(session.startTime, 6)
  const localHour = Number(session.startTime.slice(11, 13))
  return new Date(`${day}T12:00:00+09:00`).getUTCDay() === 5 && localHour >= 18
}

function selectClubverseSessions(sessions: WorldSession[]) {
  return sessions.filter(session =>
    session.worldId === CLUBVERSE_WORLD_ID &&
    session.accessType?.startsWith('group') &&
    isFridaySession(session),
  )
}

async function postImport(fileName: string, fileHash: string, sessions: WorldSession[]) {
  const response = await fetch(`${apiBase}/api/logs/import-parsed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName,
      fileHash,
      sessions,
      cutoffHour: 6,
      mainWorld: 'club VERSE',
      brand: 'clubVERSE',
    }),
  })
  const text = await response.text()
  let body: any
  try { body = JSON.parse(text) } catch { body = { error: text } }
  if (!response.ok || !body?.success) {
    throw new Error(body?.error || `HTTP ${response.status}`)
  }
  return body.data
}

async function main() {
  if (!fs.existsSync(logDir)) throw new Error(`VRChat log directory not found: ${logDir}`)

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const state = loadState()
  const files = fs.readdirSync(logDir)
    .filter(name => /^output_log_.*\.txt$/i.test(name))
    .map(name => ({ name, fullPath: path.join(logDir, name), stat: fs.statSync(path.join(logDir, name)) }))
    .filter(file => file.stat.mtimeMs >= cutoff && Date.now() - file.stat.mtimeMs >= STABLE_AGE_MS)
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)

  let imported = 0
  let candidates = 0
  let skipped = 0

  for (const file of files) {
    const previous = state[file.name]
    if (!rescan && previous?.size === file.stat.size && previous?.mtimeMs === file.stat.mtimeMs) {
      skipped++
      continue
    }

    // Most VRChat logs are unrelated. A cheap byte search avoids fully parsing large files.
    const raw = fs.readFileSync(file.fullPath, 'utf8')
    if (!raw.includes(CLUBVERSE_WORLD_ID)) {
      state[file.name] = { size: file.stat.size, mtimeMs: file.stat.mtimeMs, result: 'no-clubverse-world' }
      continue
    }

    const parsed = parseLogFile(file.fullPath)
    const sessions = selectClubverseSessions(segmentIntoSessions(parsed.events))
    const players = uniquePlayers(sessions)
    if (sessions.length === 0 || players < MIN_UNIQUE_PLAYERS) {
      state[file.name] = { size: file.stat.size, mtimeMs: file.stat.mtimeMs, result: `no-public-event:${sessions.length}:${players}` }
      continue
    }

    candidates++
    const dates = [...new Set(sessions.map(session => logicalDate(session.startTime, 6)))]
    if (dryRun) {
      console.log(`[dry-run] ${file.name}: ${dates.join(', ')} / ${sessions.length} sessions / ${players} players`)
      continue
    }

    for (const day of dates) await ensureOccurrence(day)
    await fetch(`${apiBase}/api/ledger/events?force=1`)
    const result = await postImport(file.name, parsed.fileHash, sessions)
    await fetch(`${apiBase}/api/ledger/sync`, { method: 'POST' })
    const summaryResponse = await fetch(`${apiBase}/api/ledger/events/clubverse/vrc-summary`)
    const summaryBody: any = await summaryResponse.json()
    for (const day of dates) {
      const event = result.createdEvents?.find((item: any) => item.date === day)
      const linked = summaryBody?.data?.sessions?.find((item: any) => item.date === day)
      await linkOccurrence(day, event?.id ?? linked?.id)
    }
    const label = result.alreadyImported ? 'already-imported' : `imported:${result.playerEventsInserted ?? 0}`
    state[file.name] = { size: file.stat.size, mtimeMs: file.stat.mtimeMs, result: label }
    console.log(`${file.name}: ${label}`)
    if (!result.alreadyImported) imported++
  }

  if (!dryRun) saveState(state)
  console.log(JSON.stringify({ scanned: files.length, skipped, candidates, imported, dryRun }))
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
