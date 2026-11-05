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
