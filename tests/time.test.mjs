/** 同接グラフの時刻読み取り（DB の UTC 文字列を現地時刻と取り違えない） */
import { it } from 'node:test'
import assert from 'node:assert/strict'

const { parseDbUtc } = await import('../src/utils/time.ts')

it('タイムゾーン表記の無い DB の時刻は UTC として読む', () => {
  assert.equal(parseDbUtc('2026-06-12 11:00:00').toISOString(), '2026-06-12T11:00:00.000Z')
  assert.equal(parseDbUtc('2026-06-12T11:00').toISOString(), '2026-06-12T11:00:00.000Z')
})

it('タイムゾーン付きはそのまま', () => {
  assert.equal(parseDbUtc('2026-06-12T20:00:00+09:00').toISOString(), '2026-06-12T11:00:00.000Z')
  assert.equal(parseDbUtc('2026-06-12T11:00:00.000Z').toISOString(), '2026-06-12T11:00:00.000Z')
})
