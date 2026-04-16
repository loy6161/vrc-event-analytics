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
}
