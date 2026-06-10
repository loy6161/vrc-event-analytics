import { useState } from 'react'
import { BADGE_META, type BadgeType, type UserBadge } from '../types/index.js'
import { useSeries } from '../contexts/SeriesContext'
import { dataCache } from '../utils/dataCache.js'

/** バッジのチップ表示（一覧・出演者ページ共通） */
export function BadgeChips({ badges, small = false }: { badges: UserBadge[]; small?: boolean }) {
  if (!badges || badges.length === 0) return null
  return (
    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {badges.map(b => {
        const meta = BADGE_META[b.badge_type]
        if (!meta) return null
        return (
          <span
            key={`${b.badge_type}:${b.series}`}
            title={`${meta.label}${b.series ? `（${b.series}）` : ''}${b.note ? ` — ${b.note}` : ''}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              padding: small ? '0 6px' : '1px 8px', borderRadius: 9,
              fontSize: small ? 10.5 : 11.5, fontWeight: 700,
              background: meta.bg, color: meta.color, whiteSpace: 'nowrap',
            }}
          >
            {meta.icon} {meta.label}{b.series ? `·${b.series}` : ''}
          </span>
        )
      })}
    </span>
  )
}

interface BadgeEditorProps {
  displayName: string
  badges: UserBadge[]
  onClose: () => void
  onSaved: (badges: UserBadge[]) => void
}

/** バッジ編集モーダル。追加（種別×シリーズ×メモ）と削除。 */
export function BadgeEditorModal({ displayName, badges, onClose, onSaved }: BadgeEditorProps) {
  const { seriesList } = useSeries()
  const [busy, setBusy] = useState(false)
  const [type, setType] = useState<BadgeType>('performer')
  const [series, setSeries] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const meta = BADGE_META[type]

  const call = async (method: 'PUT' | 'DELETE', body: any) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(displayName)}/badges`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (json.success) {
        dataCache.deletePrefix('users')
        dataCache.deletePrefix('performers:')
        dataCache.delete('citizenship-alerts')
        onSaved(json.data)
      } else {
        setError(json.error ?? '保存に失敗しました')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const addBadge = () => call('PUT', { badge_type: type, series: meta.scoped ? series : '', note: note.trim() || undefined })
  const removeBadge = (b: UserBadge) => call('DELETE', { badge_type: b.badge_type, series: b.series })

  return (
    <div className="merge-dialog-overlay" onClick={onClose}>
      <div className="merge-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <h3>🏷 バッジ編集 — {displayName}</h3>

        {/* 現在のバッジ */}
        {badges.length === 0 ? (
          <p style={{ opacity: 0.6, fontSize: 13 }}>バッジはまだありません</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {badges.map(b => {
              const m = BADGE_META[b.badge_type]
              return (
                <div key={`${b.badge_type}:${b.series}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <span style={{ padding: '2px 9px', borderRadius: 9, background: m.bg, color: m.color, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {m.icon} {m.label}{b.series ? `（${b.series}）` : '（全体）'}
                  </span>
                  {b.note && <span style={{ opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.note}</span>}
                  <button
                    onClick={() => removeBadge(b)}
                    disabled={busy}
                    title="このバッジを外す"
                    style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', opacity: 0.55, fontSize: 14 }}
                  >✕</button>
                </div>
              )
            })}
          </div>
        )}

        {/* 追加フォーム */}
        <div style={{ borderTop: '1px solid rgba(128,128,128,0.2)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={type} onChange={e => setType(e.target.value as BadgeType)} disabled={busy} style={{ padding: '5px 8px', borderRadius: 6 }}>
              <option value="regular">⭐ レギュラー（出演）</option>
              <option value="visitor">🎟 ビジター（出演）</option>
              <option value="performer">🎤 出演者（汎用）</option>
              <option value="manager">💼 マネージャー（出演者の関係者）</option>
              <option value="staff">🛠 イベントスタッフ</option>
              <option value="watch">⚠️ 要注意人物</option>
            </select>
            {meta.scoped && (
              <select value={series} onChange={e => setSeries(e.target.value)} disabled={busy} style={{ padding: '5px 8px', borderRadius: 6 }}>
                <option value="">全イベント共通</option>
                {seriesList.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            disabled={busy}
            placeholder={type === 'watch' ? '事由（例: 2026-01-17 に荒らし行為）' : type === 'manager' ? '誰の関係者か（例: ○○のマネージャー）' : 'メモ（任意）'}
            style={{ padding: '6px 8px', borderRadius: 6 }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose} disabled={busy}>閉じる</button>
            <button className="btn btn-primary" onClick={addBadge} disabled={busy}>
              {busy ? '保存中...' : '＋ 追加'}
            </button>
          </div>
          {error && <div style={{ color: '#e74c3c', fontSize: 12 }}>{error}</div>}
        </div>
      </div>
    </div>
  )
}
