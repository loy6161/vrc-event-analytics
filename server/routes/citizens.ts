import { Router, Request, Response } from 'express'
import { getDatabase } from '../db/schema.js'
import { ok, fail, toMessage } from '../utils/response.js'

const router = Router()

// 市民権タイプの並び順（名誉 → 一般 → 準）
const TYPE_ORDER: Record<string, number> = { honorary: 0, general: 1, associate: 2 }

// 準市民 → 一般市民への昇格条件（clubVERSE運用）：
// 「準市民取得日以降」の対象ブランドイベントに 3回以上参加 & 合計6時間以上滞在
const PROMOTION_MIN_ATTENDANCE = 3
const PROMOTION_MIN_STAY_MINUTES = 360  // 6時間

// 準市民の失効ルール（アクティブ要件）：
// ・最終来場から3ヶ月（90日）来場なし → 失効
// ・取得後3ヶ月（90日）以内に一度も来場なし → 失効
const EXPIRY_DAYS = 90
const EXPIRY_WARNING_DAYS = 30  // 失効まで残りこの日数以下で警告

interface CitizenRow {
  id: number
  verse_id: string
  vrchat_display_name: string
  user_id: string | null   // user_id キー統一リファクタで追加
  discord_id: string | null
  citizenship_type: 'honorary' | 'general' | 'associate'
  granted_date: string
  brand: string
  notes: string | null
  created_at: string
}

type ExpiryStatus = 'active' | 'warning' | 'expired_no_attendance' | 'expired_inactive'

interface EnrichedCitizen extends CitizenRow {
  // 全市民共通: 取得日以降の対象ブランドイベント参加実績
  attendance_count: number
  total_stay_minutes: number
  last_attendance_date: string | null
  // 準市民のみ: 昇格判定
  meets_promotion?: boolean
  promotion_threshold?: { min_attendance: number; min_stay_minutes: number }
  // 準市民のみ: 失効判定
  expiry_status?: ExpiryStatus
  expiry_days_remaining?: number   // 失効まで残り日数 (active/warning時)
  days_since_last_attendance?: number  // 最終来場から経過日数 (来場ありの時)
  days_since_grant?: number  // 取得日からの経過日数（来場なしの時に使う）
}

/**
 * 全市民共通の参加実績集計。
 * 判定対象は「取得日(granted_date)以降」の「対象ブランド(citizens.brand)」のイベントのみ。
 *
 * user_id キー統一リファクタ（2026-06-23）:
 *   userId が非 NULL の場合は player_events.user_id で突き合わせる。
 *   user_id があれば改名前の参加も合算されるため、join/leave の両クエリで必ず同じキーを使う。
 *   userId が NULL の場合は従来どおり display_name で突き合わせる（後方互換）。
 */
async function calcAttendance(
  displayName: string,
  userId: string | null,
  brand: string,
  grantedDate: string,
  db: ReturnType<typeof getDatabase>,
): Promise<{ attendance_count: number; total_stay_minutes: number; last_attendance_date: string | null }> {
  const evResult = await db.execute({
    sql: 'SELECT id FROM events WHERE brand = ? AND date >= ?',
    args: [brand, grantedDate],
  })
  const eventIds = (evResult.rows as unknown as Array<{ id: number }>).map(r => Number(r.id))
  if (eventIds.length === 0) {
    return { attendance_count: 0, total_stay_minutes: 0, last_attendance_date: null }
  }

  const placeholders = eventIds.map(() => '?').join(',')

  // userId がある場合は user_id キーで、無い場合は display_name で突き合わせる
  const joinWhereKey = userId ? 'user_id = ?' : 'display_name = ?'
  const joinKeyArg   = userId ?? displayName

  const joinsResult = await db.execute({
    sql: `SELECT timestamp, event_id FROM player_events
          WHERE ${joinWhereKey} AND event_type = 'join' AND event_id IN (${placeholders})
          ORDER BY timestamp ASC`,
    args: [joinKeyArg, ...eventIds],
  })
  const joins = joinsResult.rows as unknown as Array<{ timestamp: string; event_id: number }>
  if (joins.length === 0) {
    return { attendance_count: 0, total_stay_minutes: 0, last_attendance_date: null }
  }

  const attendance_count = new Set(joins.filter(j => j.event_id != null && j.event_id !== 0).map(j => j.event_id)).size
  const last_attendance_date = joins[joins.length - 1].timestamp

  // 各 join に対応する leave を探して滞在時間を加算（外れ値=12h超は除外）。
  // leave も join と同じキー（user_id or display_name）で引く（別人扱いにならないよう揃える）。
  let total_stay = 0
  for (const join of joins) {
    const leaveResult = await db.execute({
      sql: `SELECT timestamp FROM player_events
            WHERE ${joinWhereKey} AND event_id = ? AND event_type = 'leave' AND timestamp > ?
            ORDER BY timestamp ASC LIMIT 1`,
      args: [joinKeyArg, join.event_id, join.timestamp],
    })
    const leave = leaveResult.rows[0] as unknown as { timestamp: string } | undefined
    if (leave) {
      const dur = (new Date(leave.timestamp).getTime() - new Date(join.timestamp).getTime()) / 60000
      if (dur > 0 && dur <= 720) total_stay += dur
    }
  }

  return { attendance_count, total_stay_minutes: Math.round(total_stay), last_attendance_date }
}

/**
 * 準市民の失効ステータスを計算する。
 * - lastAttendanceDate が null: 取得から経過日数で判定（3ヶ月内に来場なしで失効）
 * - lastAttendanceDate あり:   最終来場からの経過日数で判定（3ヶ月離脱で失効）
 */
function calcExpiry(
  grantedDate: string,
  lastAttendanceDate: string | null,
): {
  status: ExpiryStatus
  days_remaining: number
  days_since_last_attendance?: number
  days_since_grant?: number
} {
  const now = new Date(); now.setHours(0, 0, 0, 0)

  if (!lastAttendanceDate) {
    // 取得後一度も来場していない
    const granted = new Date(grantedDate); granted.setHours(0, 0, 0, 0)
    const daysSinceGrant = Math.max(0, Math.floor((now.getTime() - granted.getTime()) / 86_400_000))
    const remaining = EXPIRY_DAYS - daysSinceGrant
    if (remaining <= 0) {
      return { status: 'expired_no_attendance', days_remaining: 0, days_since_grant: daysSinceGrant }
    }
    if (remaining <= EXPIRY_WARNING_DAYS) {
      return { status: 'warning', days_remaining: remaining, days_since_grant: daysSinceGrant }
    }
    return { status: 'active', days_remaining: remaining, days_since_grant: daysSinceGrant }
  }

  // 来場あり: 最終来場からの経過日数で判定
  const last = new Date(lastAttendanceDate); last.setHours(0, 0, 0, 0)
  const daysSinceLast = Math.max(0, Math.floor((now.getTime() - last.getTime()) / 86_400_000))
  const remaining = EXPIRY_DAYS - daysSinceLast
  if (remaining <= 0) {
    return { status: 'expired_inactive', days_remaining: 0, days_since_last_attendance: daysSinceLast }
  }
  if (remaining <= EXPIRY_WARNING_DAYS) {
    return { status: 'warning', days_remaining: remaining, days_since_last_attendance: daysSinceLast }
  }
  return { status: 'active', days_remaining: remaining, days_since_last_attendance: daysSinceLast }
}

// GET /api/citizens?brand=clubVERSE&type=honorary
router.get('/', async (req: Request, res: Response) => {
  try {
    const brand = typeof req.query.brand === 'string' ? req.query.brand : null
    const type = typeof req.query.type === 'string' ? req.query.type : null

    const conditions: string[] = []
    const args: (string | number)[] = []
    if (brand) { conditions.push('brand = ?'); args.push(brand) }
    if (type)  { conditions.push('citizenship_type = ?'); args.push(type) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const db = getDatabase()
    const result = await db.execute({
      sql: `SELECT id, verse_id, vrchat_display_name, user_id, discord_id, citizenship_type, granted_date, brand, notes, created_at
            FROM citizens ${where}
            ORDER BY verse_id ASC`,
      args,
    })

    const rows = result.rows as unknown as CitizenRow[]

    // 全市民の取得後参加実績を計算（並列）。準市民にだけ昇格・失効判定も追加。
    const enriched: EnrichedCitizen[] = await Promise.all(rows.map(async (c) => {
      // user_id があれば改名前の参加も合算される（user_id キー統一リファクタ）
      const attendance = await calcAttendance(c.vrchat_display_name, c.user_id ?? null, c.brand, c.granted_date, db)
      const base: EnrichedCitizen = {
        ...c,
        attendance_count: attendance.attendance_count,
        total_stay_minutes: attendance.total_stay_minutes,
        last_attendance_date: attendance.last_attendance_date,
      }
      if (c.citizenship_type === 'associate') {
        base.meets_promotion =
          attendance.attendance_count >= PROMOTION_MIN_ATTENDANCE &&
          attendance.total_stay_minutes >= PROMOTION_MIN_STAY_MINUTES
        base.promotion_threshold = {
          min_attendance: PROMOTION_MIN_ATTENDANCE,
          min_stay_minutes: PROMOTION_MIN_STAY_MINUTES,
        }
        const expiry = calcExpiry(c.granted_date, attendance.last_attendance_date)
        base.expiry_status = expiry.status
        base.expiry_days_remaining = expiry.days_remaining
        if (expiry.days_since_last_attendance !== undefined) {
          base.days_since_last_attendance = expiry.days_since_last_attendance
        }
        if (expiry.days_since_grant !== undefined) {
          base.days_since_grant = expiry.days_since_grant
        }
      }
      return base
    }))

    const sorted = [...enriched].sort((a, b) => {
      const ta = TYPE_ORDER[a.citizenship_type] ?? 99
      const tb = TYPE_ORDER[b.citizenship_type] ?? 99
      if (ta !== tb) return ta - tb
      return a.verse_id.localeCompare(b.verse_id)
    })

    ok(res, sorted)
  } catch (err) {
    fail(res, toMessage(err))
  }
})

// GET /api/citizens/summary?brand=clubVERSE  — タイプ別件数
router.get('/summary', async (req: Request, res: Response) => {
  try {
    const brand = typeof req.query.brand === 'string' ? req.query.brand : null
    const db = getDatabase()
    const result = await db.execute({
      sql: brand
        ? `SELECT citizenship_type, COUNT(*) as count FROM citizens WHERE brand = ? GROUP BY citizenship_type`
        : `SELECT citizenship_type, COUNT(*) as count FROM citizens GROUP BY citizenship_type`,
      args: brand ? [brand] : [],
    })
    const counts: Record<string, number> = { honorary: 0, general: 0, associate: 0 }
    for (const row of result.rows as unknown as Array<{ citizenship_type: string; count: number }>) {
      counts[row.citizenship_type] = Number(row.count) || 0
    }
    const total = counts.honorary + counts.general + counts.associate
    ok(res, { ...counts, total })
  } catch (err) {
    fail(res, toMessage(err))
  }
})

export default router
