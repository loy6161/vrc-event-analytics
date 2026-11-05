/**
 * 配信中チャットのページ送りが終わることの回帰テスト。
 * YouTube API は呼ばない（クライアントの list を偽物に差し替える）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

const { initYouTubeClient, fetchAllChatMessages } = await import('../server/services/youtube.ts')

const msg = (i) => ({
  id: `m${i}`,
  snippet: { type: 'textMessageEvent', displayMessage: `hi ${i}`, publishedAt: '2026-01-01T00:00:00Z', textMessageDetails: { messageText: `hi ${i}` } },
  authorDetails: { channelId: `UC${i}`, displayName: `u${i}` },
})

// 呼ばれすぎたら例外にする（直す前の版が無限ループで固まらず、失敗として終わるように）
function fakeClient(pageFn) {
  const yt = initYouTubeClient('dummy-key-for-test')
  let calls = 0
  yt.liveChatMessages.list = async () => {
    calls++
    if (calls > 1000) throw new Error('too many pages requested')
    return { data: pageFn(calls) }
  }
  return () => calls
}

describe('チャット取得のページ送り', () => {
  it('配信中（新着が尽きても nextPageToken が返り続ける）でも止まる', async () => {
    const calls = fakeClient(n => ({ nextPageToken: `t${n}`, items: n <= 2 ? [msg(n)] : [] }))
    const out = await fetchAllChatMessages('chat')
    assert.equal(out.length, 2)
    assert.equal(calls(), 3)
  })

  it('メッセージが際限なく続いてもページ数の上限で止まる', async () => {
    const calls = fakeClient(n => ({ nextPageToken: `t${n}`, items: [msg(n)] }))
    const out = await fetchAllChatMessages('chat')
    assert.equal(calls(), 500)
    assert.equal(out.length, calls())
  })

  it('アーカイブ（nextPageToken が尽きる）は全ページ読む', async () => {
    const calls = fakeClient(n => ({ nextPageToken: n < 4 ? `t${n}` : undefined, items: [msg(n)] }))
    const out = await fetchAllChatMessages('chat')
    assert.equal(out.length, 4)
    assert.equal(calls(), 4)
  })
})
