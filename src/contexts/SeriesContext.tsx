import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'

/**
 * シリーズ（clubVERSE / theALL / VERSARY...）のグローバル絞り込み。
 * ヘッダーのセレクタで選ぶと全ページ（ダッシュボード/レポート/インサイト/
 * ランキング/ユーザー/出演者/イベント一覧）がそのシリーズだけで再計算される。
 * '' = 全イベント。選択は localStorage に保存され次回も維持される。
 */

interface SeriesContextValue {
  series: string
  setSeries: (s: string) => void
  seriesList: string[]
  refreshSeriesList: () => void
}

const SeriesContext = createContext<SeriesContextValue>({
  series: '',
  setSeries: () => {},
  seriesList: [],
  refreshSeriesList: () => {},
})

const STORAGE_KEY = 'vrcea:globalSeries'

export function SeriesProvider({ children }: { children: ReactNode }) {
  const [series, setSeriesState] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) ?? '' } catch { return '' }
  })
  const [seriesList, setSeriesList] = useState<string[]>([])

  const setSeries = useCallback((s: string) => {
    setSeriesState(s)
    try { localStorage.setItem(STORAGE_KEY, s) } catch { /* ignore */ }
  }, [])

  const refreshSeriesList = useCallback(() => {
    fetch('/api/events/series/list')
      .then(r => r.json())
      .then(json => {
        if (json.success && Array.isArray(json.data)) {
          setSeriesList(json.data)
          // 保存していたシリーズが削除されていたら「全イベント」に戻す
          setSeriesState(prev => {
            if (prev && !json.data.includes(prev)) {
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

  return (
    <SeriesContext.Provider value={{ series, setSeries, seriesList, refreshSeriesList }}>
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
