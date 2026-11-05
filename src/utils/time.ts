/**
 * DB の recorded_at は SQLite の datetime('now') 等で作る "YYYY-MM-DD HH:MM:SS"（UTC・タイムゾーン表記なし）。
 * そのまま new Date() に渡すとブラウザは「現地時刻」とみなすため、日本では 9 時間ずれる。
 * タイムゾーン表記が無い形だけ UTC として読む（"Z" や "+09:00" 付きはそのまま）。
 */
export function parseDbUtc(value: string | null | undefined): Date {
  if (typeof value !== 'string') return new Date(NaN)
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(value.trim())
  return new Date(m ? `${m[1]}T${m[2]}Z` : value)
}
