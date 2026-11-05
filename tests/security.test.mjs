/**
 * 安全面の回帰テスト（node --test）。
 * DB は一時ディレクトリのローカル SQLite ファイルを使う（本番の Turso には繋がない）。
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vea-sec-'))
process.env.TURSO_DATABASE_URL = `file:${path.join(tmpDir, 'test.db')}`
delete process.env.TURSO_AUTH_TOKEN
delete process.env.VRC_EA_WRITE_TOKEN

let server
let base

before(async () => {
  const { buildApp } = await import('../server/app.ts')
  const app = await buildApp()
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve) })
  base = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  await new Promise(resolve => server.close(resolve))
  try { (await import('../server/db/schema.ts')).closeDatabase?.() } catch {}
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// 本文が不正なので、認証を通過すれば 400、止められれば 401 になる（DB は書き換わらない）
const badCreate = (headers = {}) =>
  fetch(`${base}/api/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' })

describe('書き込み API のトークン認証', () => {
  it('トークン未設定の間は今までどおり認証なしで通る', async () => {
    delete process.env.VRC_EA_WRITE_TOKEN
    assert.equal((await badCreate()).status, 400)
  })

  it('トークン設定後は、トークン無し・違うトークンを 401 で拒む', async () => {
    process.env.VRC_EA_WRITE_TOKEN = 'test-secret-1'
    try {
      assert.equal((await badCreate()).status, 401)
      assert.equal((await badCreate({ Authorization: 'Bearer wrong' })).status, 401)
      assert.equal((await badCreate({ 'X-Write-Token': 'test-secret-12' })).status, 401)
      const del = await fetch(`${base}/api/events/999999`, { method: 'DELETE' })
      assert.equal(del.status, 401)
    } finally { delete process.env.VRC_EA_WRITE_TOKEN }
  })

  it('正しいトークンなら通る（Bearer / X-Write-Token のどちらでも）', async () => {
    process.env.VRC_EA_WRITE_TOKEN = 'test-secret-1'
    try {
      assert.equal((await badCreate({ Authorization: 'Bearer test-secret-1' })).status, 400)
      assert.equal((await badCreate({ 'X-Write-Token': 'test-secret-1' })).status, 400)
    } finally { delete process.env.VRC_EA_WRITE_TOKEN }
  })

  it('読み取り（GET）と CORS の事前確認はトークン無しで通る', async () => {
    process.env.VRC_EA_WRITE_TOKEN = 'test-secret-1'
    try {
      assert.equal((await fetch(`${base}/api/events`)).status, 200)
      assert.equal((await fetch(`${base}/api/health`)).status, 200)
      const pre = await fetch(`${base}/api/events`, { method: 'OPTIONS' })
      assert.equal(pre.status, 200)
      assert.match(pre.headers.get('access-control-allow-headers') ?? '', /Authorization/)
    } finally { delete process.env.VRC_EA_WRITE_TOKEN }
  })
})

describe('公開サーバーではサーバー上のファイルを読ませない', () => {
  const withProd = async (fn) => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    delete process.env.ALLOW_SERVER_LOG_FILES
    try { await fn() } finally {
      if (prev === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prev
    }
  }

  it('ログフォルダ一覧は 403 で、中身を返さない', async () => withProd(async () => {
    const r = await fetch(`${base}/api/logs/files?dir=${encodeURIComponent(tmpDir)}`)
    assert.equal(r.status, 403)
    const body = await r.json()
    assert.equal(body.success, false)
    assert.ok(!JSON.stringify(body).includes(tmpDir))
  }))

  it('filePath 指定の解析は 403', async () => withProd(async () => {
    const r = await fetch(`${base}/api/logs/parse`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: path.join(tmpDir, 'test.db') }),
    })
    assert.equal(r.status, 403)
  }))

  it('ローカル実行（production 以外）では従来どおり使える', async () => {
    const r = await fetch(`${base}/api/logs/files?dir=${encodeURIComponent(tmpDir)}`)
    assert.equal(r.status, 200)
  })
})
