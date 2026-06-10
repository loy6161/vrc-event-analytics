/**
 * Simple in-memory cache for API responses.
 * Resets on page reload (browser refresh / new tab), persists during SPA navigation.
 */
const store = new Map<string, unknown>()

export const dataCache = {
  get<T>(key: string): T | null {
    return store.has(key) ? (store.get(key) as T) : null
  },
  set(key: string, data: unknown): void {
    store.set(key, data)
  },
  delete(key: string): void {
    store.delete(key)
  },
  deletePrefix(prefix: string): void {
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key)
    }
  },
  // データを変更する操作（ログ取込・削除など）の後に全キャッシュを破棄する。
  // これを呼ばないと一覧/分析ページが古い内容を表示し続ける（取込してもイベントが出ない原因）。
  clear(): void {
    store.clear()
  },
}
