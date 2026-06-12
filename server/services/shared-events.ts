// shared.events（共有イベント台帳）を Supabase から読み取り専用で取得する。
// 束をまたぐ唯一の許可された参照（書き込みは X-Analytics 経由のみ）。
// 契約: packages/contracts/shared.events.ts / 正本: X_Analytics/DESIGN.md §0

const SUPABASE_URL = process.env.SHARED_EVENTS_SUPABASE_URL
  || 'https://aegjgukkpkyhixqxpsoy.supabase.co'
const ANON_KEY = process.env.SHARED_EVENTS_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFlZ2pndWtrcGt5aGl4cXhwc295Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MTE4NzUsImV4cCI6MjA4OTk4Nzg3NX0.Gx851Rp6ZrulB45AFkLbHi08BAaAXWoFYJsmYPxsaQQ'

export interface SharedEvent {
  id: string          // スラッグ（例: theall-2026）
  series: string
  name: string
  year: number
  since: string       // YYYY-MM-DD
  until: string       // YYYY-MM-DD
  hashtags: string[]
  performers: string[]
  cadence?: string    // weekly | annual | oneoff
}

let cache: { at: number; data: SharedEvent[] } | null = null
const TTL_MS = 5 * 60_000

export async function fetchSharedEvents(force = false): Promise<SharedEvent[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data
  const res = await fetch(`${SUPABASE_URL}/rest/v1/events?select=*&order=since.desc`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  })
  if (!res.ok) throw new Error(`shared.events 読み取り失敗: HTTP ${res.status}`)
  const data = (await res.json()) as SharedEvent[]
  cache = { at: Date.now(), data }
  return data
}

const dayMs = (d: string) => new Date(d + 'T00:00:00Z').getTime()
const spanDays = (e: SharedEvent) => (dayMs(e.until) - dayMs(e.since)) / 86_400_000

/**
 * 日付（YYYY-MM-DD）から該当する台帳エディションを返す。
 * 期間に含まれるものの中で「最も期間が短い（＝具体的な）」エディションを優先。
 * これにより、広いweeklyのclubVERSEより、その日のtheALL/VERSARYが優先される。
 */
export function matchEditionForDate(events: SharedEvent[], date: string): SharedEvent | null {
  const t = dayMs(date)
  const hits = events.filter(e => dayMs(e.since) <= t && t <= dayMs(e.until))
  if (hits.length === 0) return null
  hits.sort((a, b) => spanDays(a) - spanDays(b))
  return hits[0]
}
