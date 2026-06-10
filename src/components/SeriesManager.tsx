import { useState } from 'react'
import { useSeries } from '../contexts/SeriesContext'
import { dataCache } from '../utils/dataCache.js'

// 既定パレット（SeriesContext と揃える）。色未設定時のプリセット候補に使う。
const PALETTE = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6']

export function SeriesManager() {
  const { seriesMeta, colorOf, refreshSeriesList, series: globalSeries, setSeries } = useSeries()
  const [busy, setBusy] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const patch = async (name: string, body: any) => {
    setBusy(name)
    try {
      await fetch(`/api/series/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      dataCache.clear()
      refreshSeriesList()
    } finally { setBusy(null) }
  }

  const doRename = async (oldName: string) => {
    const newName = renameValue.trim()
    if (!newName || newName === oldName) { setRenaming(null); return }
    setBusy(oldName)
    try {
      await fetch(`/api/series/${encodeURIComponent(oldName)}/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newName }),
      })
      dataCache.clear()
      if (globalSeries === oldName) setSeries(newName)
      refreshSeriesList()
    } finally { setBusy(null); setRenaming(null) }
  }

  const doDelete = async (name: string) => {
    if (!confirm(`シリーズ「${name}」を削除しますか？\n該当イベントは「未分類」に戻ります（イベント自体やログは消えません）。`)) return
    setBusy(name)
    try {
      await fetch(`/api/series/${encodeURIComponent(name)}`, { method: 'DELETE' })
      dataCache.clear()
      if (globalSeries === name) setSeries('')
      refreshSeriesList()
    } finally { setBusy(null) }
  }

  if (seriesMeta.length === 0) {
    return (
      <p style={{ opacity: 0.6, fontSize: 13 }}>
        まだシリーズがありません。ログ取込やイベント編集でシリーズ名を付けると、ここに表示されます。
      </p>
    )
  }

  return (
    <div className="series-manager">
      {seriesMeta.map(s => {
        const isBusy = busy === s.name
        const color = colorOf(s.name)
        return (
          <div key={s.name} className="series-mgr-row" style={{ opacity: isBusy ? 0.5 : 1 }}>
            <div className="series-mgr-main">
              {/* 色 */}
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366f1'}
                onChange={e => patch(s.name, { color: e.target.value })}
                title="チャート・バッジの色"
                className="series-mgr-color"
                list={`palette-${s.id}`}
              />
              <datalist id={`palette-${s.id}`}>
                {PALETTE.map(p => <option key={p} value={p} />)}
              </datalist>

              {/* 名前 / 改名 */}
              {renaming === s.name ? (
                <input
                  className="series-mgr-rename"
                  value={renameValue}
                  autoFocus
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') doRename(s.name); if (e.key === 'Escape') setRenaming(null) }}
                  onBlur={() => doRename(s.name)}
                />
              ) : (
                <button
                  className="series-mgr-name"
                  title="クリックで改名（全イベントへ自動反映）"
                  onClick={() => { setRenaming(s.name); setRenameValue(s.name) }}
                >
                  {s.name}
                </button>
              )}

              <span className="series-mgr-count">{s.event_count}回</span>
            </div>

            <div className="series-mgr-actions">
              <label className="series-mgr-citizen" title="このシリーズの参加を市民権の昇格・失効の判定に数える">
                <input
                  type="checkbox"
                  checked={s.citizenship_target}
                  onChange={e => patch(s.name, { citizenship_target: e.target.checked })}
                />
                市民権の判定対象
              </label>
              <button className="series-mgr-del" onClick={() => doDelete(s.name)} title="シリーズを削除（イベントは未分類に戻る）">
                🗑
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
