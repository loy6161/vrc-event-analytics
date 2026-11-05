/**
 * 書き込み系 API（GET/HEAD/OPTIONS 以外）のトークン認証。
 *
 * 環境変数 VRC_EA_WRITE_TOKEN が「未設定」のあいだは今までどおり素通しする
 * （呼び出し側にトークンを配り終えるまで、夜間ジョブや画面が止まらないようにするため）。
 * 設定すると、書き込みリクエストには次のどちらかが要る:
 *   Authorization: Bearer <token>
 *   X-Write-Token: <token>
 */
import { createHash, timingSafeEqual } from 'crypto'
import type { Request, Response, NextFunction } from 'express'

export const WRITE_TOKEN_ENV = 'VRC_EA_WRITE_TOKEN'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

let warned = false

function digest(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest()
}

export function presentedToken(req: Request): string | null {
  const auth = req.get('authorization')
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim())
    if (m) return m[1].trim()
  }
  const x = req.get('x-write-token')
  return x ? x.trim() : null
}

export function requireWriteToken(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) return next()

  const expected = process.env[WRITE_TOKEN_ENV]?.trim()
  if (!expected) {
    if (!warned) {
      warned = true
      console.warn(`⚠ ${WRITE_TOKEN_ENV} が未設定のため、書き込み API は認証なしで受け付けています`)
    }
    return next()
  }

  const got = presentedToken(req)
  // 長さの違いで比較時間が変わらないよう、ハッシュ同士を比べる
  if (got && timingSafeEqual(digest(got), digest(expected))) return next()

  res.status(401).json({
    success: false,
    error: '書き込みには認証が必要です',
    timestamp: new Date().toISOString(),
  })
}
