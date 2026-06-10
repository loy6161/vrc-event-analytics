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

const ALL_TYPES: BadgeType[] = ['regular', 'visitor', 'performer', 'manager', 'staff', 'watch']

interface BadgeEditorProps {
  displayName: string
  badges: UserBadge[]
  tags: string[]
  allTags: string[]
  onClose: () => void
  /** バッジ/タグが変わるたびに呼ばれる（モーダルは開いたまま・一覧へ即反映） */
  onChange: (patch: { badges?: UserBadge[]; tags?: string[] }) => void
}

/** ユーザー編集モーダル：バッジ（複数選択でまとめて付与）＋タグの付け外し */
export function BadgeEditorModal({ displayName, badges, tags, allTags, onClose, onChange }: BadgeEditorProps) {
  const { seriesList } = useSeries()
  const [busy, setBusy] = useState(false)
  const [selectedTypes, setSelectedTypes] = useState<Set<BadgeType>>(new Set())
  const [series, setSeries] = useState('')
  const [note, setNote] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const invalidateCaches = () => {
    dataCache.deletePrefix('users')
    dataCache.deletePrefix('performers:')
    dataCache.delete('citizenship-alerts')
  }

  const toggleType = (t: BadgeType) => {
    setSelectedTypes(prev => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })
  }

  // 選択中の種別をまとめて付与（シリーズはスコープ対象の種別にのみ適用）
  const addSelected = async () => {
    if (selectedTypes.size === 0) return
    setBusy(true)
    setError(null)
    try {
      let latest: UserBadge[] | null = null
      for (const t of selectedTypes) {
        const res = await fetch(`/api/users/${encodeURIComponent(displayName)}/badges`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            badge_type: t,
            series: BADGE_META[t].scoped ? series : '',
            note: note.trim() || undefined,
          }),
        })
        const json = await res.json()
        if (!json.success) { setError(json.error ?? '保存に失敗しました'); return }
        latest = json.data
      }
      if (latest) {
        invalidateCaches()
        onChange({ badges: latest })
        setSelectedTypes(new Set())
        setNote('')
      }
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const removeBadge = async (b: UserBadge) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(displayName)}/badges`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badge_type: b.badge_type, series: b.series }),
      })
      const json = await res.json()
      if (json.success) { invalidateCaches(); onChange({ badges: json.data }) }
      else setError(json.error ?? '削除に失敗しました')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // ── タグ ──────────────────────────────────────────────
  const saveTags = async (newTags: string[]) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(displayName)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newTags }),
      })
      const json = await res.json()
      if (json.success) { invalidateCaches(); onChange({ tags: newTags }) }
      else setError(json.error ?? 'タグの保存に失敗しました')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const addTag = () => {
    const t = tagInput.trim()
    if (!t) return
    setTagInput('')
    saveTags(Array.from(new Set([...tags, t])))
  }
  const removeTag = (t: string) => saveTags(tags.filter(x => x !== t))

  const sectionTitle = { fontSize: 11, fontWeight: 700 as const, opacity: 0.55, textTransform: 'uppercase' as const, letterSpacing: 0.5, margin: '0 0 6px' }

  return (
    <div className="merge-dialog-overlay" onClick={onClose}>
      <div className="merge-dialog" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3>🏷 ユーザー編集 — {displayName}</h3>

        {/* 現在のバッジ */}
        <p style={sectionTitle}>バッジ</p>
        {badges.length === 0 ? (
          <p style={{ opacity: 0.6, fontSize: 13, margin: '0 0 10px' }}>バッジはまだありません</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
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

        {/* バッジ追加（複数選択） */}
        <div style={{ border: '1px solid rgba(128,128,128,0.2)', borderRadius: 8, padding: 10, marginBottom: 14 }}>
          <p style={sectionTitle}>バッジを付与（複数選択OK）</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {ALL_TYPES.map(t => {
              const m = BADGE_META[t]
              const on = selectedTypes.has(t)
              return (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  disabled={busy}
                  style={{
                    padding: '5px 10px', borderRadius: 14, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                    background: on ? m.bg : 'transparent',
                    color: on ? m.color : 'inherit',
                    border: on ? `1.5px solid ${m.color}` : '1px solid rgba(128,128,128,0.35)',
                    opacity: on ? 1 : 0.75,
                  }}
                >
                  {on ? '✓ ' : ''}{m.icon} {m.label}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={series} onChange={e => setSeries(e.target.value)} disabled={busy} style={{ padding: '5px 8px', borderRadius: 6 }} title="出演者系・関係者バッジの対象シリーズ（要注意には影響しない）">
              <option value="">全イベント共通</option>
              {seriesList.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <input
              value={note}
              onChange={e => setNote(e.target.value)}
              disabled={busy}
              placeholder="メモ（要注意の事由・誰のマネ等。任意）"
              style={{ padding: '5px 8px', borderRadius: 6, flex: 1, minWidth: 160 }}
            />
            <button className="btn btn-primary" onClick={addSelected} disabled={busy || selectedTypes.size === 0}>
              {busy ? '保存中...' : `＋ ${selectedTypes.size > 0 ? `${selectedTypes.size}件` : ''}付与`}
            </button>
          </div>
        </div>

        {/* タグ */}
        <div style={{ border: '1px solid rgba(128,128,128,0.2)', borderRadius: 8, padding: 10 }}>
          <p style={sectionTitle}>タグ</p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {tags.length === 0 && <span style={{ opacity: 0.6, fontSize: 13 }}>タグはまだありません</span>}
            {tags.map(t => (
              <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 9px', borderRadius: 10, fontSize: 12, background: 'rgba(99,102,241,0.13)', fontWeight: 600 }}>
                {t}
                <button onClick={() => removeTag(t)} disabled={busy} title="タグを外す" style={{ border: 'none', background: 'transparent', cursor: 'pointer', opacity: 0.55, padding: 0 }}>✕</button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addTag() }}
              disabled={busy}
              placeholder="タグを追加（例: 準市民）"
              list="badge-modal-tag-suggestions"
              style={{ padding: '5px 8px', borderRadius: 6, flex: 1 }}
            />
            <datalist id="badge-modal-tag-suggestions">
              {allTags.filter(t => !tags.includes(t)).map(t => <option key={t} value={t} />)}
            </datalist>
            <button className="btn btn-secondary" onClick={addTag} disabled={busy || !tagInput.trim()}>🏷 追加</button>
          </div>
        </div>

        {error && <div style={{ color: '#e74c3c', fontSize: 12, marginTop: 8 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button className="btn" onClick={onClose} disabled={busy}>閉じる</button>
        </div>
      </div>
    </div>
  )
}
