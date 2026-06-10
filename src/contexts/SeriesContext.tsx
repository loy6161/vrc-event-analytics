import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import type { SeriesMeta } from '../types/index.js'

/**
 * シリーズ（clubVERSE / theALL / VERSARY...）のグローバル絞り込み。
 * サイドバー上部のスイッチャーで選ぶと全ページ（ダッシュボード/レポート/インサイト/
 * ランキング/ユーザー/出演者/イベント一覧）がそのシリーズだけで再計算される。
 * '' = 全イベント。選択は localStorage に保存され次回も維持される。
 *
 * seriesMeta は色・市民権対象などのメタ込み一覧。seriesList はその名前だけ（後方互換）。
 */

interface SeriesContextValue {
  series: string
  setSeries: (s: string) => void
  seriesMeta: SeriesMeta[]
  seriesList: string[]
  colorOf: (name: string, fallback?: string) => string
  refreshSeriesList: () => void
}

const SeriesContext = createContext<SeriesContextValue>({
  series: '',
  setSeries: () => {},
  seriesMeta: [],
  seriesList: [],
  colorOf: (_n, f) => f ?? '#6366f1',
  refreshSeriesList: () => {},
})

const STORAGE_KEY = 'vrcea:globalSeries'

// マスタに色が未設定のシリーズへ自動で割り当てる既定パレット（index 順）
const PALETTE = ['#6366f1', '#ec4899', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6']

export function SeriesProvider({ children }: { children: ReactNode }) {
  const [series, setSeriesState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) ?? '' } catch { return '' }
  })
  const [seriesMeta, setSeriesMeta] = useState<SeriesMeta[]>([])

  const setSeries = useCallback((s: string) => {
    setSeriesState(s)
    try { localStorage.setItem(STORAGE_KEY, s) } catch { /* ignore */ }
  }, [])

  const refreshSeriesList = useCallback(() => {
    fetch('/api/series')
      .then(r => r.json())
      .then(json => {
        if (json.success && Array.isArray(json.data)) {
          setSeriesMeta(json.data)
          // 保存していたシリーズが削除されていたら「全イベント」に戻す
          const names = (json.data as SeriesMeta[]).map(s => s.name)
          setSeriesState(prev => {
            if (prev && !names.includes(prev)) {
              try { localStorage.setItem(STORAGE_KEY, '') } catch { /* ignore */ }
              return ''
            }
            return prev
          })
        }
      })
      .catch(() => { /* シリーズ機能はオフラインでも致命的でない */ })
  }, [])

  useEffect(() => { refreshSeriesList() }, [refreshSeriesList])

  const colorOf = useCallback((name: string, fallback?: string) => {
    const idx = seriesMeta.findIndex(s => s.name === name)
    if (idx >= 0) return seriesMeta[idx].color || PALETTE[idx % PALETTE.length]
    return fallback ?? '#6366f1'
  }, [seriesMeta])

  const seriesList = seriesMeta.map(s => s.name)

  return (
    <SeriesContext.Provider value={{ series, setSeries, seriesMeta, seriesList, colorOf, refreshSeriesList }}>
      {children}
    </SeriesContext.Provider>
  )
}

export function useSeries() {
  return useContext(SeriesContext)
}

/** fetch 用: series が選択されていれば URLSearchParams に追加 */
export function appendSeries(params: URLSearchParams, series: string) {
  if (series) params.set('series', series)
  return params
}
