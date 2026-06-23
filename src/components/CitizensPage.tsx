import { useState, useEffect } from 'react'
import { Citizen, CitizenshipType, CITIZENSHIP_META } from '../types/index.js'
import { dataCache } from '../utils/dataCache.js'
import '../styles/CitizensPage.css'

const TYPE_ORDER: CitizenshipType[] = ['honorary', 'general', 'associate']

interface CitizensSummary {
  honorary: number
  general: number
  associate: number
  total: number
}

function fmtDate(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('ja-JP', {
      year: 'numeric', month: 'numeric', day: 'numeric',
    })
  } catch {
    return iso
  }
}

function fmtHours(minutes: number): string {
  if (minutes <= 0) return '0h'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h === 0) return `${m}分`
  if (m === 0) return `${h}h`
  return `${h}h${m}分`
}

// 取得後の来場実績を1セルで表示（全市民共通の小さなサマリ）
function AttendanceCell({ citizen }: { citizen: Citizen }) {
  const cnt = citizen.attendance_count ?? 0
  const stay = citizen.total_stay_minutes ?? 0
  if (cnt === 0) {
    return <span className="att-empty" title="取得日以降の来場記録なし">—</span>
  }
  const lastStr = citizen.last_attendance_date
    ? new Date(citizen.last_attendance_date).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
    : null
  return (
    <div className="att-cell" title={citizen.last_attendance_date ? `最終来場: ${fmtDate(citizen.last_attendance_date)}` : undefined}>
      <span className="att-main">{cnt}回 / {fmtHours(stay)}</span>
      {lastStr && <span className="att-sub">最終 {lastStr}</span>}
    </div>
  )
}

// 準市民の失効ステータスを描画
function ExpiryBadge({ citizen }: { citizen: Citizen }) {
  if (citizen.citizenship_type !== 'associate') return null
  const status = citizen.expiry_status
  if (!status) return null

  if (status === 'expired_inactive') {
    const days = citizen.days_since_last_attendance ?? 0
    return (
      <div className="expiry-badge expiry-badge--expired" title="最終来場から3ヶ月以上経過">
        ⛔ 失効（最終来場から{days}日）
      </div>
    )
  }
  if (status === 'expired_no_attendance') {
    const days = citizen.days_since_grant ?? 0
    return (
      <div className="expiry-badge expiry-badge--expired" title="取得後3ヶ月以内に来場なし">
        ⛔ 失効（取得から{days}日 来場なし）
      </div>
    )
  }
  if (status === 'warning') {
    const remain = citizen.expiry_days_remaining ?? 0
    const noAttendance = (citizen.attendance_count ?? 0) === 0
    return (
      <div className="expiry-badge expiry-badge--warning" title="失効まで残り少ない（30日以下）">
        ⚠️ 失効まで残り{remain}日{noAttendance ? '（要初来場）' : ''}
      </div>
    )
  }
  // active
  const remain = citizen.expiry_days_remaining ?? 0
  const noAttendance = (citizen.attendance_count ?? 0) === 0
  return (
    <div className="expiry-badge expiry-badge--active" title="アクティブ（来場継続中）">
      ✓ 有効{noAttendance ? `（取得から${citizen.days_since_grant}日 / 失効まで${remain}日）` : ''}
    </div>
  )
}

// 準市民の昇格進捗を描画する（条件: 3回参加 & 6時間滞在）
function PromotionProgress({ citizen }: { citizen: Citizen }) {
  if (citizen.citizenship_type !== 'associate') return null
  // 失効済みなら昇格進捗は出さない
  if (citizen.expiry_status === 'expired_inactive' || citizen.expiry_status === 'expired_no_attendance') {
    return null
  }
  const attended = citizen.attendance_count ?? 0
  const stayMin = citizen.total_stay_minutes ?? 0
  const minAttend = citizen.promotion_threshold?.min_attendance ?? 3
  const minStay = citizen.promotion_threshold?.min_stay_minutes ?? 360
  const meets = citizen.meets_promotion ?? false

  if (meets) {
    return (
      <div className="promotion-status promotion-status--achieved" title="一般市民への昇格条件を満たしています">
        <span className="promotion-icon">✨</span>
        <span className="promotion-label">昇格条件達成</span>
      </div>
    )
  }

  const needAttend = Math.max(0, minAttend - attended)
  const needStay = Math.max(0, minStay - stayMin)
  const attendPct = Math.min(100, (attended / minAttend) * 100)
  const stayPct = Math.min(100, (stayMin / minStay) * 100)

  return (
    <div className="promotion-status promotion-status--progress">
      <div className="promotion-bars">
        <div className="promotion-bar-row">
          <span className="promotion-bar-label">参加</span>
          <div className="promotion-bar">
            <div className="promotion-bar-fill" style={{ width: `${attendPct}%` }} />
          </div>
          <span className="promotion-bar-text">{attended} / {minAttend}回</span>
        </div>
        <div className="promotion-bar-row">
          <span className="promotion-bar-label">滞在</span>
          <div className="promotion-bar">
            <div className="promotion-bar-fill" style={{ width: `${stayPct}%` }} />
          </div>
          <span className="promotion-bar-text">{fmtHours(stayMin)} / {fmtHours(minStay)}</span>
        </div>
      </div>
      {(needAttend > 0 || needStay > 0) && (
        <div className="promotion-remain">
          残り: {needAttend > 0 && `あと${needAttend}回`}
          {needAttend > 0 && needStay > 0 && ' ・ '}
          {needStay > 0 && `あと${fmtHours(needStay)}`}
        </div>
      )}
    </div>
  )
}

export function CitizensPage() {
  const [citizens, setCitizens] = useState<Citizen[]>([])
  const [summary, setSummary] = useState<CitizensSummary>({ honorary: 0, general: 0, associate: 0, total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeFilter, setActiveFilter] = useState<CitizenshipType | 'all'>('all')

  const brand = 'clubVERSE'  // 現時点は clubVERSE のみ

  const refresh = (force = false) => {
    const cacheKey = `citizens:${brand}`
    if (!force) {
      const cached = dataCache.get<Citizen[]>(cacheKey)
      if (cached) {
        setCitizens(cached)
        const counts = countByType(cached)
        setSummary(counts)
        setLoading(false)
        return
      }
    }
    setLoading(true)
    setError(null)
    Promise.all([
      fetch(`/api/citizens?brand=${encodeURIComponent(brand)}`).then(r => r.json()),
      fetch(`/api/citizens/summary?brand=${encodeURIComponent(brand)}`).then(r => r.json()),
    ])
      .then(([listRes, sumRes]) => {
        if (listRes.success) {
          dataCache.set(cacheKey, listRes.data)
          setCitizens(listRes.data)
        } else {
          setError(listRes.error ?? 'Failed to load citizens')
        }
        if (sumRes.success) setSummary(sumRes.data)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { refresh() }, [])

  const grouped: Record<CitizenshipType, Citizen[]> = {
    honorary: [],
    general: [],
    associate: [],
  }

  const filtered = citizens.filter(c => {
    if (activeFilter !== 'all' && c.citizenship_type !== activeFilter) return false
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      return (
        c.vrchat_display_name.toLowerCase().includes(q) ||
        c.verse_id.toLowerCase().includes(q) ||
        (c.discord_id?.toLowerCase().includes(q) ?? false)
      )
    }
    return true
  })

  for (const c of filtered) grouped[c.citizenship_type].push(c)

  if (loading) {
    return (
      <div className="citizens-page">
        <div className="citizens-loading">読み込み中…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="citizens-page">
        <div className="citizens-error">{error}</div>
      </div>
    )
  }

  return (
    <div className="citizens-page">
      <div className="citizens-header">
        <div>
          <h1>🎖️ clubVERSE 市民リスト</h1>
          <p className="citizens-desc">
            VRChatグループロール「市民」を付与されたメンバー（合計 {summary.total} 名）。
            市民ナンバー（VERSE_ID）は申請順の通し番号で、A=名誉 / B=一般 / C=準市民。
            来場実績は <strong>市民権取得日以降</strong> の clubVERSE イベントを集計。
          </p>
        </div>
        <button className="btn-refresh" onClick={() => { dataCache.delete(`citizens:${brand}`); refresh(true) }}>
          ↻ 更新
        </button>
      </div>

      <div className="citizens-summary">
        <button
          className={`citizen-stat${activeFilter === 'all' ? ' active' : ''}`}
          onClick={() => setActiveFilter('all')}
        >
          <div className="citizen-stat-label">合計</div>
          <div className="citizen-stat-value">{summary.total}</div>
        </button>
        {TYPE_ORDER.map(type => {
          const meta = CITIZENSHIP_META[type]
          return (
            <button
              key={type}
              className={`citizen-stat${activeFilter === type ? ' active' : ''}`}
              style={{ '--accent-color': meta.color, '--accent-bg': meta.bg } as React.CSSProperties}
              onClick={() => setActiveFilter(type)}
            >
              <div className="citizen-stat-label">
                <span className="citizen-stat-emoji">{meta.emoji}</span>
                {meta.label}
              </div>
              <div className="citizen-stat-value">{summary[type]}</div>
            </button>
          )
        })}
      </div>

      <div className="citizens-toolbar">
        <input
          type="text"
          placeholder="市民ID・VRC名・Discord名で検索…"
          className="citizens-search"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      {TYPE_ORDER.filter(type => activeFilter === 'all' || activeFilter === type).map(type => {
        const list = grouped[type]
        const meta = CITIZENSHIP_META[type]
        const isAssociate = type === 'associate'
        if (list.length === 0 && activeFilter !== 'all') {
          return (
            <div key={type} className="citizens-section">
              <h2 className="citizens-section-title">
                <span className="citizens-section-emoji">{meta.emoji}</span>
                {meta.label} <span className="citizens-section-count">0名</span>
              </h2>
              <div className="citizens-empty">該当する市民がいません</div>
            </div>
          )
        }
        if (list.length === 0) return null

        // 準市民のうち昇格条件達成者・失効者を集計
        const achievedCount = isAssociate ? list.filter(c => c.meets_promotion).length : 0
        const expiredCount = isAssociate
          ? list.filter(c => c.expiry_status === 'expired_inactive' || c.expiry_status === 'expired_no_attendance').length
          : 0
        const warningCount = isAssociate ? list.filter(c => c.expiry_status === 'warning').length : 0

        return (
          <div key={type} className="citizens-section">
            <h2 className="citizens-section-title">
              <span className="citizens-section-emoji">{meta.emoji}</span>
              {meta.label}
              <span className="citizens-section-count">{list.length}名</span>
              {isAssociate && (
                <span className="citizens-section-meta">
                  {achievedCount > 0 && (
                    <span className="citizens-section-achievement" title="一般市民への昇格条件達成者">
                      ✨ {achievedCount}名 昇格条件達成
                    </span>
                  )}
                  {warningCount > 0 && (
                    <span className="citizens-section-warning" title="失効まで30日以下">
                      ⚠️ {warningCount}名 失効リスク
                    </span>
                  )}
                  {expiredCount > 0 && (
                    <span className="citizens-section-expired" title="市民権失効状態">
                      ⛔ {expiredCount}名 失効
                    </span>
                  )}
                </span>
              )}
            </h2>
            {isAssociate && (
              <p className="citizens-section-note">
                <strong>昇格条件</strong>: 取得日以降のclubVERSEイベントに 3回以上参加 かつ 合計6時間以上滞在 で一般市民へ昇格。
                <br />
                <strong>失効条件</strong>: 最終来場から3ヶ月（90日）来場なし、または 取得後3ヶ月以内に一度も来場なし で自動失効。
              </p>
            )}
            <div className={`citizens-table${isAssociate ? ' citizens-table--associate' : ''}`}>
              <div className="citizens-row citizens-row-head">
                <div className="ct-verse">市民ID</div>
                <div className="ct-vrc">VRChat名</div>
                <div className="ct-discord">Discord</div>
                <div className="ct-date">付与日</div>
                <div className="ct-attendance">来場（取得後）</div>
                {isAssociate && <div className="ct-progress">昇格進捗 / 有効性</div>}
              </div>
              {list.map(c => {
                const expired = c.expiry_status === 'expired_inactive' || c.expiry_status === 'expired_no_attendance'
                const warning = c.expiry_status === 'warning'
                const rowClass = c.meets_promotion
                  ? 'citizens-row--achieved'
                  : expired
                  ? 'citizens-row--expired'
                  : warning
                  ? 'citizens-row--warning'
                  : ''
                return (
                  <div key={c.id} className={`citizens-row ${rowClass}`}>
                    <div
                      className="ct-verse"
                      style={{ '--type-color': meta.color, '--type-bg': meta.bg } as React.CSSProperties}
                    >
                      <span className="ct-verse-badge">{c.verse_id}</span>
                    </div>
                    <div className="ct-vrc">
                      <a
                        href={`#/users/detail/${encodeURIComponent(c.vrchat_display_name)}`}
                        className="ct-vrc-link"
                        title="ユーザー詳細を開く"
                      >
                        {c.vrchat_display_name}
                      </a>
                    </div>
                    <div className="ct-discord">
                      <span className="ct-discord-text" title={c.discord_id}>
                        {c.discord_id ?? '—'}
                      </span>
                    </div>
                    <div className="ct-date">{fmtDate(c.granted_date)}</div>
                    <div className="ct-attendance">
                      <AttendanceCell citizen={c} />
                    </div>
                    {isAssociate && (
                      <div className="ct-progress">
                        <ExpiryBadge citizen={c} />
                        <PromotionProgress citizen={c} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {filtered.length === 0 && (
        <div className="citizens-empty">
          {searchTerm ? `「${searchTerm}」に一致する市民が見つかりません` : '市民データがありません'}
        </div>
      )}
    </div>
  )
}

function countByType(list: Citizen[]): CitizensSummary {
  const counts: CitizensSummary = { honorary: 0, general: 0, associate: 0, total: 0 }
  for (const c of list) {
    counts[c.citizenship_type]++
    counts.total++
  }
  return counts
}
