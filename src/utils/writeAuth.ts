/**
 * 書き込み用トークン（サーバーの VRC_EA_WRITE_TOKEN と同じ値）をブラウザに保存し、
 * 同じオリジンの /api への書き込みリクエスト（GET/HEAD 以外）に自動で付ける。
 * 未保存なら何もしない＝サーバー側が未設定の間は今までどおり動く。
 */
export const WRITE_TOKEN_KEY = 'vrc-ea-write-token'

export function getWriteToken(): string {
  try { return localStorage.getItem(WRITE_TOKEN_KEY) ?? '' } catch { return '' }
}

export function setWriteToken(token: string): void {
  try {
    if (token.trim()) localStorage.setItem(WRITE_TOKEN_KEY, token.trim())
    else localStorage.removeItem(WRITE_TOKEN_KEY)
  } catch { /* 保存できない環境では付けないだけ */ }
}

function isSameOriginApi(url: string): boolean {
  try {
    const u = new URL(url, window.location.href)
    return u.origin === window.location.origin && u.pathname.startsWith('/api/')
  } catch { return false }
}

export function installWriteAuthFetch(): void {
  const orig = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const token = getWriteToken()
    if (!token || method === 'GET' || method === 'HEAD' || !isSameOriginApi(url)) return orig(input, init)
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
    return orig(input, { ...init, headers })
  }
}
