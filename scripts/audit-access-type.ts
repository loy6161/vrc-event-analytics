/**
 * 回ごとの「代表インスタンス」が正しいかの点検（読み取りのみ・既定）— 2026-10-10 新設。
 *
 * 1日分のログが複数ファイルに分かれ、開場前の準備用インスタンス(Group)のファイルが先に入ると、
 * 本番(Group+)ではなく準備用のインスタンスで回が作られていた（8/14 ΛNDERVERSE）。
 * ローカルに残っているログから、その日いちばん人数の多いセッションを求めて、保存値と比べる。
 *
 * 使い方:
 *   node --import tsx scripts/audit-access-type.ts            # 食い違いを表示するだけ
 *   node --import tsx scripts/audit-access-type.ts --apply    # 食い違いを PUT /api/events/:id で直す
 *   オプション: --dir=<ログ置き場>（既定は VRChat 標準フォルダと vrc_log_archive の両方）
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { parseLogFile, segmentIntoSessions, logicalDate, type WorldSession } from '../server/services/log-parser.js'

const API = (process.env.VRC_ANALYTICS_URL || 'https://vrc-event-analytics.onrender.com').replace(/\/$/, '')
const CUTOFF_HOUR = 6
const apply = process.argv.includes('--apply')
const dirArg = process.argv.find(a => a.startsWith('--dir='))?.slice(6)
const DIRS = dirArg ? [dirArg] : [
  path.join(process.env.USERPROFILE || os.homedir(), 'AppData', 'LocalLow', 'VRChat', 'VRChat'),
  path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'vrc_log_archive'),
]

function startTimeOf(name: string): number | null {
  const m = name.match(/output_log_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/)
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`).getTime() : null
}
const uniq = (s: WorldSession) => new Set(s.playerEvents.map(e => (e as any).userId || e.displayName)).size

async function main() {
  const res: any = await (await fetch(`${API}/api/events`)).json()
  const events: any[] = (res?.data ?? res ?? []).filter((e: any) => e?.date)

  // ファイル名で重複を除いて、全ログの [開始, 最終更新] を持つ（同じファイルが両方の置き場にある）
  const files = new Map<string, { full: string; start: number; end: number }>()
  for (const dir of DIRS) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (!/^output_log_.*\.txt$/i.test(name) || files.has(name)) continue
      const full = path.join(dir, name)
      const st = fs.statSync(full)
      files.set(name, { full, start: startTimeOf(name) ?? st.mtimeMs, end: st.mtimeMs })
    }
  }

  const parsedCache = new Map<string, WorldSession[]>()
  let checked = 0, noLog = 0, mismatch = 0, fixed = 0
  for (const ev of events) {
    const day = String(ev.date).slice(0, 10)
    const from = new Date(`${day}T0${CUTOFF_HOUR}:00:00`).getTime(), to = from + 86400_000
    const hits = [...files.entries()].filter(([, f]) => f.start < to && f.end >= from)
    if (!hits.length) { noLog++; continue }
    const sessions: WorldSession[] = []
    for (const [name, f] of hits) {
      if (!parsedCache.has(name)) parsedCache.set(name, segmentIntoSessions(parseLogFile(f.full).events))
      sessions.push(...parsedCache.get(name)!.filter(s => logicalDate(s.startTime, CUTOFF_HOUR) === day && s.worldName))
    }
    if (!sessions.length) { noLog++; continue }
    checked++
    // 保存済みのワールドと同じワールドの中で、いちばん人数の多いセッション＝本番のインスタンス
    const sameWorld = sessions.filter(s => s.worldId && s.worldId === ev.world_id)
    const best = (sameWorld.length ? sameWorld : sessions).sort((a, b) => uniq(b) - uniq(a))[0]
    if (!best || best.accessType === ev.access_type) continue   // 種別が同じなら実害なし（インスタンス番号違いは見送る）
    mismatch++
    console.log(`${day} #${ev.id} ${ev.name}`)
    console.log(`   保存: ${ev.access_type}  →  本番: ${best.accessType}（${best.worldName}・${uniq(best)}人）`)
    if (apply) {
      const r = await fetch(`${API}/api/events/${ev.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_type: best.accessType, instance_id: best.instanceId, world_id: best.worldId, world_name: best.worldName, region: best.region }),
      })
      console.log(`   → 修正 HTTP ${r.status}`)
      if (r.ok) fixed++
    }
  }
  console.log(JSON.stringify({ events: events.length, checked, noLog, mismatch, fixed, apply }))
}

main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1 })
