/**
 * VRChatログの自動取り込み（台帳に登録済みの開催回だけ）— 2026-09-06 新設。
 *
 * 経緯: 先行する auto-import-clubverse.ts は clubVERSE のワールドIDと「金曜夜」を直書きしていたため、
 *   ラヴェニール5周年(2026-07-07)のような他ブランドのVR開催が取り込まれず、来場データが空のまま残っていた。
 *   ログを何でも取り込むと私用プレイまで「イベント」として作られるので、
 *   **台帳(event_occurrences)にVR開催として登録済みの日** だけを対象にする（ユーザー方針・2026-09-06）。
 *
 * 流れ:
 *   1. Supabase から対象日を取得（occ_type が vr_live/hybrid の回。既定は vrc_event_id 未設定の回だけ）
 *   2. ローカルのログから、その日に重なるファイルだけを候補にする（ファイル名の開始時刻と mtime で判定＝読まない）
 *   3. 候補を解析し、対象日のセッションだけ残す（参加者が少ないセッションは私用とみなして除外）
 *   4. /api/logs/import-parsed へ投げる（player_events は UNIQUE 制約で冪等）
 *   5. 取り込めた回の vrc_event_id を台帳に書き戻し、/api/ledger/sync でブランド紐付けを更新
 *
 * 使い方:
 *   node --import tsx scripts/auto-import-events.ts [--days=120] [--dry-run] [--rescan]
 *                                                   [--dir=<ログ置き場>] [--all-days] [--since=YYYY-MM-DD]
 *   --all-days : 既に vrc_event_id が入っている回も対象にする（取り直し）
 *   --rescan   : ローカルの走査状態を無視して全ファイルを見直す
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { parseLogFile, segmentIntoSessions, logicalDate, type WorldSession } from '../server/services/log-parser.js'

const DEFAULT_API_BASE = 'https://vrc-event-analytics.onrender.com'
const STABLE_AGE_MS = 10 * 60 * 1000        // 書き込み中のログを掴まない（最終更新から10分は待つ）
const MIN_UNIQUE_PLAYERS = 5                // 1セッションの最低ユニーク数。これ未満は私用プレイとみなす
const CUTOFF_HOUR = 6                       // 深夜の区切り（翌朝6時までは前日の開催扱い）
const SUPABASE_PROJECT = 'aegjgukkpkyhixqxpsoy'
const DEFAULT_X_ENV = 'L:\\企画用\\App_Dev\\apps\\loyall\\X_Analytics\\.env'
const VR_OCC_TYPES = ['vr_live', 'hybrid']

type ScanState = Record<string, { size: number; mtimeMs: number; result: string }>
interface TargetDay { day: string; sid: string; brand: string; occIds: number[] }

function arg(name: string) {
  const prefix = `--${name}=`
  return process.argv.find(v => v.startsWith(prefix))?.slice(prefix.length)
}
const dryRun = process.argv.includes('--dry-run')
const rescan = process.argv.includes('--rescan')
const allDays = process.argv.includes('--all-days')
const days = Math.max(1, Number(arg('days') ?? 120))
const sinceArg = arg('since')
const apiBase = (process.env.VRC_ANALYTICS_URL || DEFAULT_API_BASE).replace(/\/$/, '')
const logDir = arg('dir') || process.env.VRC_LOG_DIR || path.join(
  process.env.USERPROFILE || os.homedir(), 'AppData', 'LocalLow', 'VRChat', 'VRChat',
)
const stateDir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'ALLVERSE')
const statePath = path.join(stateDir, 'vrc-auto-import.json')

function loadState(): ScanState {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')) } catch { return {} }
}
function saveState(state: ScanState) {
  fs.mkdirSync(stateDir, { recursive: true })
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8')
}

function supabaseToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN
  const envPath = process.env.X_ANALYTICS_ENV || DEFAULT_X_ENV
  if (!fs.existsSync(envPath)) throw new Error(`SUPABASE_ACCESS_TOKEN not found: ${envPath}`)
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find(v => v.startsWith('SUPABASE_ACCESS_TOKEN='))
  const token = line?.slice('SUPABASE_ACCESS_TOKEN='.length).trim().replace(/^['"]|['"]$/g, '')
  if (!token) throw new Error(`SUPABASE_ACCESS_TOKEN is empty: ${envPath}`)
  return token
}

async function sql(query: string) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${SUPABASE_PROJECT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${supabaseToken()}`, 'Content-Type': 'application/json', 'User-Agent': 'node' },
    body: JSON.stringify({ query }),
  })
  const body = await r.text()
  if (!r.ok) throw new Error(`Supabase query failed (${r.status}): ${body.slice(0, 300)}`)
  return JSON.parse(body)
}

/** 台帳に登録済みのVR開催日を取る（ここに無い日のログは取り込まない） */
async function fetchTargetDays(since: string): Promise<Map<string, TargetDay>> {
  const types = VR_OCC_TYPES.map(t => `'${t}'`).join(',')
  const rows = await sql(`select o.id as occ_id, o.date::text as day, o.shared_event_id as sid,
       coalesce(e.brand, e.name, '') as brand, o.vrc_event_id
  from event_occurrences o join events e on e.id = o.shared_event_id
 where o.occ_type in (${types}) and o.date >= '${since}'
 order by o.date`)
  // 同じ日に複数の回がある（clubVERSE のリレーパートなど）。まとめて1つの来場データに紐付ける。
  const map = new Map<string, TargetDay>()
  for (const r of rows ?? []) {
    if (!allDays && r.vrc_event_id != null) continue      // 既に来場データがある回は既定で対象外
    const cur = map.get(r.day)
    if (cur) cur.occIds.push(r.occ_id)
    else map.set(r.day, { day: r.day, sid: r.sid, brand: r.brand, occIds: [r.occ_id] })
  }
  return map
}

/** 論理日 d が覆う実時間の範囲 [d 06:00, d+1 06:00)（ローカル時刻＝ログの時刻系） */
function dayRange(day: string): [number, number] {
  const start = new Date(`${day}T${String(CUTOFF_HOUR).padStart(2, '0')}:00:00`).getTime()
  return [start, start + 24 * 3600 * 1000]
}

/** ファイル名 output_log_YYYY-MM-DD_HH-MM-SS.txt から開始時刻を取る */
function startTimeOf(name: string): number | null {
  const m = name.match(/output_log_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`).getTime()
}

function uniquePlayers(sessions: WorldSession[]) {
  return new Set(sessions.flatMap(s => s.playerEvents.map(e => (e as any).userId || e.displayName))).size
}

async function postImport(fileName: string, fileHash: string, sessions: WorldSession[], brand: string) {
  const r = await fetch(`${apiBase}/api/logs/import-parsed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, fileHash, sessions, cutoffHour: CUTOFF_HOUR, brand, force: true }),
  })
  const text = await r.text()
  let body: any
  try { body = JSON.parse(text) } catch { body = { error: text.slice(0, 300) } }
  if (!r.ok || !body?.success) throw new Error(body?.error || `HTTP ${r.status}`)
  return body.data
}

async function linkOccurrence(t: TargetDay, vrcEventId: number) {
  const ids = t.occIds.map(id => Math.trunc(id)).join(',')
  await sql(`update event_occurrences set vrc_event_id = ${Math.trunc(vrcEventId)} where id in (${ids})`)
}

async function main() {
  if (!fs.existsSync(logDir)) throw new Error(`VRChat log directory not found: ${logDir}`)

  const since = sinceArg && /^\d{4}-\d{2}-\d{2}$/.test(sinceArg)
    ? sinceArg
    : new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10)
  const targets = await fetchTargetDays(since)
  console.log(`[targets] ${since}以降の対象日 ${targets.size}件${allDays ? '（取り直しモード）' : '（来場データが無い回だけ）'}`)
  if (targets.size === 0) { console.log(JSON.stringify({ scanned: 0, candidates: 0, imported: 0 })); return }

  const ranges = [...targets.values()].map(t => ({ t, range: dayRange(t.day) }))
  const state = loadState()
  const now = Date.now()

  const files = fs.readdirSync(logDir)
    .filter(n => /^output_log_.*\.txt$/i.test(n))
    .map(name => {
      const full = path.join(logDir, name)
      const stat = fs.statSync(full)
      return { name, full, stat, start: startTimeOf(name) }
    })
    .filter(f => now - f.stat.mtimeMs >= STABLE_AGE_MS)
    // ファイルの生存区間 [開始, 最終更新] が対象日の区間に重なるものだけ（＝中身を読まずに9割落とす）
    .map(f => ({ ...f, hits: ranges.filter(({ range }) => (f.start ?? f.stat.mtimeMs) < range[1] && f.stat.mtimeMs >= range[0]).map(x => x.t) }))
    .filter(f => f.hits.length > 0)
    .sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)

  let candidates = 0, imported = 0, skipped = 0, linked = 0
  for (const file of files) {
    const prev = state[file.name]
    if (!rescan && prev?.size === file.stat.size && prev?.mtimeMs === file.stat.mtimeMs) { skipped++; continue }

    const parsed = parseLogFile(file.full)
    const byDay = new Map<string, WorldSession[]>()
    for (const sn of segmentIntoSessions(parsed.events)) {
      const day = logicalDate(sn.startTime, CUTOFF_HOUR)
      if (!targets.has(day)) continue
      if (uniquePlayers([sn]) < MIN_UNIQUE_PLAYERS) continue   // 私用の少人数セッションは混ぜない
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day)!.push(sn)
    }
    if (byDay.size === 0) {
      state[file.name] = { size: file.stat.size, mtimeMs: file.stat.mtimeMs, result: 'no-event-session' }
      continue
    }

    candidates++
    const hitDays = [...byDay.keys()].sort()
    const sessions = hitDays.flatMap(d => byDay.get(d)!)
    // 1ファイルが別ブランドの2日をまたぐ場合はブランドを指定しない（サーバー側の推定に任せる）
    const brands = [...new Set(hitDays.map(d => targets.get(d)!.brand).filter(Boolean))]
    const brand = brands.length === 1 ? brands[0] : ''

    if (dryRun) {
      console.log(`[dry-run] ${file.name}: ${hitDays.join(', ')} / ${sessions.length}セッション / ${uniquePlayers(sessions)}人 / brand=${brand || '(自動)'}`)
      continue
    }

    const result = await postImport(file.name, parsed.fileHash, sessions, brand)
    imported++
    for (const day of hitDays) {
      const t = targets.get(day)!
      const created = result.createdEvents?.find((c: any) => c.date === day)
      if (created?.id) { await linkOccurrence(t, created.id); linked += t.occIds.length }
      console.log(`  ${day} ${t.sid}: vrc_event=${created?.id ?? '?'} 回${t.occIds.length}件 取込${result.playerEventsInserted ?? 0}件`)
    }
    state[file.name] = { size: file.stat.size, mtimeMs: file.stat.mtimeMs, result: `imported:${hitDays.join('/')}` }
  }

  if (!dryRun && imported > 0) {
    // VRC側イベントを台帳スラッグへ再リンク（ブランド紐付けの更新）
    await fetch(`${apiBase}/api/ledger/sync`, { method: 'POST' }).catch(() => null)
  }
  if (!dryRun) saveState(state)
  console.log(JSON.stringify({ targetDays: targets.size, scanned: files.length, skipped, candidates, imported, linked, dryRun }))
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
