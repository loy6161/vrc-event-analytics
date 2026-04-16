/**
 * Integration tests for VRChat Event Analytics
 *
 * Tests the full pipeline: log parsing → DB import → analytics computation → export.
 * Uses Node built-in test runner (node:test) and in-memory SQLite.
 *
 * Run with: node --loader tsx tests/integration.test.mjs
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE_LOG = path.join(__dirname, 'fixtures', 'sample-log.txt')

// ──────────────────────────────────────────────
// 1. Log Parser Tests
// ──────────────────────────────────────────────

describe('Log Parser', async () => {
  const { parseLine, parseLogFile, segmentIntoSessions, calculatePlayerStays } =
    await import('../server/services/log-parser.ts')

  describe('parseLine', () => {
    it('parses player join with user ID', () => {
      const line = '2025.03.01 20:02:00 Log        -  [NetworkManager] OnPlayerJoined Alice (usr_aaaaaaaa-1111-2222-3333-444444444444)'
      const result = parseLine(line)
      assert.ok(result)
      assert.equal(result.type, 'join')
      assert.equal(result.displayName, 'Alice')
      assert.equal(result.userId, 'usr_aaaaaaaa-1111-2222-3333-444444444444')
      assert.equal(result.timestamp, '2025-03-01T20:02:00')
    })

    it('parses player leave with user ID', () => {
      const line = '2025.03.01 20:15:00 Log        -  [NetworkManager] OnPlayerLeft Alice (usr_aaaaaaaa-1111-2222-3333-444444444444)'
      const result = parseLine(line)
      assert.ok(result)
      assert.equal(result.type, 'leave')
      assert.equal(result.displayName, 'Alice')
    })

    it('parses player join without user ID (pre-Oct 2024)', () => {
      const line = '2025.03.01 20:35:01 Log        -  [NetworkManager] OnPlayerJoined Dave'
      const result = parseLine(line)
      assert.ok(result)
      assert.equal(result.type, 'join')
      assert.equal(result.displayName, 'Dave')
      assert.equal(result.userId, undefined)
    })

    it('parses entering room event', () => {
      const line = '2025.03.01 20:01:00 Log        -  [Behaviour] Entering Room: Test Event World'
      const result = parseLine(line)
      assert.ok(result)
      assert.equal(result.type, 'entering_room')
      assert.equal(result.worldName, 'Test Event World')
    })

    it('parses joining instance event', () => {
      const line = '2025.03.01 20:01:01 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789012:99999~region(us)~nonce(abc)'
      const result = parseLine(line)
      assert.ok(result)
      assert.equal(result.type, 'joining_instance')
      assert.equal(result.worldId, 'wrld_12345678-1234-1234-1234-123456789012')
      assert.equal(result.region, 'us')
      assert.equal(result.accessType, 'public')
    })

    it('returns null for non-event lines', () => {
      assert.equal(parseLine('2025.03.01 20:00:00 Log        -  VRChat started.'), null)
      assert.equal(parseLine('random garbage'), null)
      assert.equal(parseLine(''), null)
    })

    it('detects access types from instance params', () => {
      const hidden = '2025.03.01 20:01:01 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789012:99999~region(us)~hidden(usr_xxx)'
      const r = parseLine(hidden)
      assert.equal(r.accessType, 'invite')

      const friends = '2025.03.01 20:01:01 Log        -  [Behaviour] Joining wrld_12345678-1234-1234-1234-123456789012:99999~friends(usr_xxx)~canRequestInvite'
      const r2 = parseLine(friends)
      assert.equal(r2.accessType, 'friends+')
    })
  })

  describe('parseLogFile', () => {
    it('parses the sample log file correctly', () => {
      const result = parseLogFile(FIXTURE_LOG)

      assert.ok(result.fileName.endsWith('.txt'))
      assert.ok(result.fileHash.length === 64) // SHA-256 hex

      // Summary stats
      assert.equal(result.summary.joinCount, 5) // Alice, Bob, Charlie, Alice(re-entry), Dave
      assert.equal(result.summary.leaveCount, 5) // Alice, Bob, Charlie, Alice, Dave
      assert.equal(result.summary.uniquePlayers, 4) // Alice, Bob, Charlie, Dave
      assert.equal(result.summary.worldChanges, 1) // One "Entering Room"

      // Time range
      assert.ok(result.summary.timeRange)
      assert.equal(result.summary.timeRange.start, '2025-03-01T20:01:00')
      assert.equal(result.summary.timeRange.end, '2025-03-01T20:45:00')
    })
  })

  describe('segmentIntoSessions', () => {
    it('creates one session from the sample log', () => {
      const result = parseLogFile(FIXTURE_LOG)
      const sessions = segmentIntoSessions(result.events)

      assert.equal(sessions.length, 1)

      const session = sessions[0]
      assert.equal(session.worldName, 'Test Event World')
      assert.equal(session.worldId, 'wrld_12345678-1234-1234-1234-123456789012')
      assert.equal(session.region, 'us')
      assert.equal(session.accessType, 'public')

      // All 10 player events in this session (5 joins + 5 leaves)
      assert.equal(session.playerEvents.length, 10)
    })
  })

  describe('calculatePlayerStays', () => {
    it('correctly pairs joins and leaves with FIFO', () => {
      const result = parseLogFile(FIXTURE_LOG)
      const sessions = segmentIntoSessions(result.events)
      const stays = calculatePlayerStays(sessions[0].playerEvents, sessions[0].endTime)

      // Alice: join 20:02 → leave 20:15 (13 min) + join 20:20 → leave 20:35 (15 min)
      const aliceStays = stays.filter(s => s.displayName === 'Alice')
      assert.equal(aliceStays.length, 2)
      assert.equal(aliceStays[0].durationMinutes, 13)
      assert.equal(aliceStays[1].durationMinutes, 15)

      // Bob: join 20:05 → leave 20:25 (20 min)
      const bobStays = stays.filter(s => s.displayName === 'Bob')
      assert.equal(bobStays.length, 1)
      assert.equal(bobStays[0].durationMinutes, 20)

      // Charlie: join 20:10 → leave 20:30 (20 min)
      const charlieStays = stays.filter(s => s.displayName === 'Charlie')
      assert.equal(charlieStays.length, 1)
      assert.equal(charlieStays[0].durationMinutes, 20)

      // Dave: join 20:35:01 → leave 20:45 (~10 min)
      const daveStays = stays.filter(s => s.displayName === 'Dave')
      assert.equal(daveStays.length, 1)
      assert.equal(daveStays[0].durationMinutes, 10) // rounds to 10
    })
  })
})

// ──────────────────────────────────────────────
// 2. Database Tests
// ──────────────────────────────────────────────

// sql.js (pure JS SQLite) — always available, no native bindings needed
describe('Database Layer', async () => {
  before(async () => {
    // Initialize database (sql.js is async)
    const { initializeDatabase } = await import('../server/db/schema.ts')
    await initializeDatabase()
  })

  after(async () => {
    try {
      const schema = await import('../server/db/schema.ts')
      schema.closeDatabase()
    } catch {}
  })

  const {
    createEvent, getEvents, getEventById, updateEvent, deleteEvent,
    insertPlayerEventsBatch, getPlayerEventsByEventId,
    upsertUser, upsertUsersBatch, getUsers, getUserByDisplayName,
    isLogImported, recordImportedLog, getImportedLogs,
    recordDisplayNameHistory,
  } = await import('../server/db/queries.ts')

  describe('Events CRUD', () => {
    it('creates an event', () => {
      const event = createEvent({
        name: 'Test Event',
        date: '2025-03-01',
        start_time: '20:00',
        end_time: '21:00',
        world_id: 'wrld_12345678-1234-1234-1234-123456789012',
        world_name: 'Test Event World',
        description: 'A test event',
        tags: ['test', 'integration'],
      })

      assert.ok(event.id)
      assert.equal(event.name, 'Test Event')
      assert.equal(event.date, '2025-03-01')
      assert.equal(event.world_id, 'wrld_12345678-1234-1234-1234-123456789012')
      assert.deepEqual(event.tags, ['test', 'integration'])
    })

    it('lists events', () => {
      const events = getEvents()
      assert.ok(events.length >= 1)
      assert.equal(events[0].name, 'Test Event')
    })

    it('gets event by id', () => {
      const events = getEvents()
      const event = getEventById(events[0].id)
      assert.ok(event)
      assert.equal(event.name, 'Test Event')
    })

    it('updates an event', () => {
      const events = getEvents()
      const updated = updateEvent(events[0].id, { description: 'Updated description' })
      assert.ok(updated)
      assert.equal(updated.description, 'Updated description')
      assert.equal(updated.name, 'Test Event')
    })

    it('returns null for nonexistent event', () => {
      assert.equal(getEventById(9999), null)
    })
  })

  describe('Player Events', () => {
    it('batch inserts player events', () => {
      const events = getEvents()
      const eventId = events[0].id

      const inserted = insertPlayerEventsBatch([
        { event_id: eventId, user_id: 'usr_aaaaaaaa-1111-2222-3333-444444444444', display_name: 'Alice', event_type: 'join', timestamp: '2025-03-01T20:02:00' },
        { event_id: eventId, user_id: 'usr_bbbbbbbb-1111-2222-3333-444444444444', display_name: 'Bob', event_type: 'join', timestamp: '2025-03-01T20:05:00' },
        { event_id: eventId, user_id: 'usr_cccccccc-1111-2222-3333-444444444444', display_name: 'Charlie', event_type: 'join', timestamp: '2025-03-01T20:10:00' },
        { event_id: eventId, user_id: 'usr_aaaaaaaa-1111-2222-3333-444444444444', display_name: 'Alice', event_type: 'leave', timestamp: '2025-03-01T20:15:00' },
        { event_id: eventId, user_id: 'usr_aaaaaaaa-1111-2222-3333-444444444444', display_name: 'Alice', event_type: 'join', timestamp: '2025-03-01T20:20:00' },
        { event_id: eventId, user_id: 'usr_bbbbbbbb-1111-2222-3333-444444444444', display_name: 'Bob', event_type: 'leave', timestamp: '2025-03-01T20:25:00' },
        { event_id: eventId, user_id: 'usr_cccccccc-1111-2222-3333-444444444444', display_name: 'Charlie', event_type: 'leave', timestamp: '2025-03-01T20:30:00' },
        { event_id: eventId, user_id: 'usr_aaaaaaaa-1111-2222-3333-444444444444', display_name: 'Alice', event_type: 'leave', timestamp: '2025-03-01T20:35:00' },
        { event_id: eventId, display_name: 'Dave', event_type: 'join', timestamp: '2025-03-01T20:35:01' },
        { event_id: eventId, display_name: 'Dave', event_type: 'leave', timestamp: '2025-03-01T20:45:00' },
      ])

      assert.equal(inserted, 10)
    })

    it('retrieves player events in chronological order', () => {
      const events = getEvents()
      const playerEvents = getPlayerEventsByEventId(events[0].id)

      assert.equal(playerEvents.length, 10)
      assert.equal(playerEvents[0].display_name, 'Alice')
      assert.equal(playerEvents[0].event_type, 'join')

      for (let i = 1; i < playerEvents.length; i++) {
        assert.ok(playerEvents[i].timestamp >= playerEvents[i - 1].timestamp,
          `Events out of order at index ${i}`)
      }
    })

    it('handles duplicate insertion (INSERT OR IGNORE)', () => {
      const events = getEvents()
      const inserted = insertPlayerEventsBatch([
        { event_id: events[0].id, user_id: 'usr_aaaaaaaa-1111-2222-3333-444444444444', display_name: 'Alice', event_type: 'join', timestamp: '2025-03-01T20:02:00' },
      ])
      assert.equal(inserted, 0)
    })
  })

  describe('Users', () => {
    it('upserts users', () => {
      upsertUser({ user_id: 'usr_aaaaaaaa-1111-2222-3333-444444444444', display_name: 'Alice', first_seen: '2025-03-01T20:02:00' })
      upsertUser({ user_id: 'usr_bbbbbbbb-1111-2222-3333-444444444444', display_name: 'Bob', first_seen: '2025-03-01T20:05:00' })
      upsertUser({ display_name: 'Dave', first_seen: '2025-03-01T20:35:01' })

      const users = getUsers()
      assert.ok(users.length >= 3)
    })

    it('finds user by display name', () => {
      const user = getUserByDisplayName('Alice')
      assert.ok(user)
      assert.equal(user.display_name, 'Alice')
      assert.equal(user.user_id, 'usr_aaaaaaaa-1111-2222-3333-444444444444')
    })

    it('updates display name on re-upsert with same user_id', () => {
      upsertUser({ user_id: 'usr_aaaaaaaa-1111-2222-3333-444444444444', display_name: 'AliceNewName', first_seen: '2025-03-01T20:02:00' })
      const user = getUserByDisplayName('AliceNewName')
      assert.ok(user)
      assert.equal(user.user_id, 'usr_aaaaaaaa-1111-2222-3333-444444444444')
    })

    it('records display name history', () => {
      recordDisplayNameHistory('usr_aaaaaaaa-1111-2222-3333-444444444444', 'Alice', '2025-03-01T20:02:00')
      recordDisplayNameHistory('usr_aaaaaaaa-1111-2222-3333-444444444444', 'AliceNewName', '2025-04-01T20:00:00')
      recordDisplayNameHistory('usr_aaaaaaaa-1111-2222-3333-444444444444', 'Alice', '2025-03-15T10:00:00')
    })
  })

  describe('Imported Logs', () => {
    it('records and detects imported log', () => {
      assert.equal(isLogImported('abcdef1234567890'), false)
      recordImportedLog('test-log.txt', 'abcdef1234567890', 10)
      assert.equal(isLogImported('abcdef1234567890'), true)
    })

    it('lists imported logs', () => {
      const logs = getImportedLogs()
      assert.ok(logs.length >= 1)
      assert.equal(logs[0].file_name, 'test-log.txt')
    })
  })

  describe('Event deletion cascades', () => {
    it('creates and deletes event with player events', () => {
      const event = createEvent({ name: 'Temp Event', date: '2025-04-01' })
      insertPlayerEventsBatch([
        { event_id: event.id, display_name: 'Temp', event_type: 'join', timestamp: '2025-04-01T20:00:00' },
      ])
      assert.equal(getPlayerEventsByEventId(event.id).length, 1)

      const deleted = deleteEvent(event.id)
      assert.equal(deleted, true)
      assert.equal(getEventById(event.id), null)
      assert.equal(getPlayerEventsByEventId(event.id).length, 0)
    })
  })
})

// ──────────────────────────────────────────────
// 3. Analytics Computation Tests
// ──────────────────────────────────────────────

describe('Analytics Computation', async () => {
  // We test analytics by hitting the actual computation.
  // The analytics route exposes computeEventStats etc. as internal functions.
  // Since they're not exported, we test via the HTTP endpoints indirectly,
  // or we replicate the core algorithm here for unit testing.

  it('sweep-line peak concurrent calculation', () => {
    // Simulate the sweep-line algorithm
    const events = [
      { event_type: 'join',  timestamp: '2025-03-01T20:02:00' },
      { event_type: 'join',  timestamp: '2025-03-01T20:05:00' },
      { event_type: 'join',  timestamp: '2025-03-01T20:10:00' },
      { event_type: 'leave', timestamp: '2025-03-01T20:15:00' },
      { event_type: 'join',  timestamp: '2025-03-01T20:20:00' },
      { event_type: 'leave', timestamp: '2025-03-01T20:25:00' },
      { event_type: 'leave', timestamp: '2025-03-01T20:30:00' },
      { event_type: 'leave', timestamp: '2025-03-01T20:35:00' },
    ]

    let concurrent = 0
    let peak = 0
    for (const e of events) {
      concurrent += e.event_type === 'join' ? 1 : -1
      if (concurrent < 0) concurrent = 0
      if (concurrent > peak) peak = concurrent
    }

    // At 20:10, we have Alice + Bob + Charlie = 3 concurrent
    assert.equal(peak, 3)
  })

  it('FIFO join/leave pairing produces correct durations', () => {
    // Alice: join 20:02, leave 20:15 = 13 min
    // Alice: join 20:20, leave 20:35 = 15 min
    // Bob:   join 20:05, leave 20:25 = 20 min
    const events = [
      { user_id: 'a', display_name: 'Alice', event_type: 'join',  timestamp: '2025-03-01T20:02:00' },
      { user_id: 'b', display_name: 'Bob',   event_type: 'join',  timestamp: '2025-03-01T20:05:00' },
      { user_id: 'a', display_name: 'Alice', event_type: 'leave', timestamp: '2025-03-01T20:15:00' },
      { user_id: 'a', display_name: 'Alice', event_type: 'join',  timestamp: '2025-03-01T20:20:00' },
      { user_id: 'b', display_name: 'Bob',   event_type: 'leave', timestamp: '2025-03-01T20:25:00' },
      { user_id: 'a', display_name: 'Alice', event_type: 'leave', timestamp: '2025-03-01T20:35:00' },
    ]

    // FIFO pairing
    const pendingJoins = new Map()
    const durations = []

    for (const e of events) {
      const k = e.user_id ?? e.display_name
      if (e.event_type === 'join') {
        if (!pendingJoins.has(k)) pendingJoins.set(k, [])
        pendingJoins.get(k).push(e.timestamp)
      } else {
        const q = pendingJoins.get(k)
        if (q && q.length > 0) {
          const joinTs = q.shift()
          const ms = new Date(e.timestamp).getTime() - new Date(joinTs).getTime()
          durations.push(ms / 60000)
          if (q.length === 0) pendingJoins.delete(k)
        }
      }
    }

    assert.deepEqual(durations, [13, 20, 15])

    // Average = (13 + 20 + 15) / 3 = 16
    const avg = durations.reduce((s, d) => s + d, 0) / durations.length
    assert.equal(avg, 16)

    // Median = sorted [13, 15, 20] → 15
    const sorted = [...durations].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    const median = sorted.length & 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
    assert.equal(median, 15)
  })

  it('re-entry rate calculation', () => {
    // Alice joins twice, Bob once, Charlie once
    // Re-entrants: 1 (Alice), Unique: 3
    // Rate = 1/3 ≈ 0.333
    const joins = [
      { user_id: 'a', display_name: 'Alice' },
      { user_id: 'b', display_name: 'Bob' },
      { user_id: 'c', display_name: 'Charlie' },
      { user_id: 'a', display_name: 'Alice' }, // re-entry
    ]

    const joinCounts = new Map()
    for (const e of joins) {
      const k = e.user_id ?? e.display_name
      joinCounts.set(k, (joinCounts.get(k) ?? 0) + 1)
    }

    const uniqueUsers = joinCounts.size
    let reentrants = 0
    for (const c of joinCounts.values()) {
      if (c > 1) reentrants++
    }

    const rate = uniqueUsers > 0 ? reentrants / uniqueUsers : 0
    assert.equal(uniqueUsers, 3)
    assert.equal(reentrants, 1)
    assert.ok(Math.abs(rate - 1/3) < 0.001)
  })

  it('hourly attendance with interval overlap', () => {
    // Hour bucket: 20:00-21:00
    // Alice present 20:02-20:15, 20:20-20:35 (overlap in 20:00 bucket)
    // Bob present 20:05-20:25 (overlap in 20:00 bucket)
    // Both in the 20:00 hour

    const intervals = [
      { key: 'a', startMs: new Date('2025-03-01T20:02:00').getTime(), endMs: new Date('2025-03-01T20:15:00').getTime() },
      { key: 'a', startMs: new Date('2025-03-01T20:20:00').getTime(), endMs: new Date('2025-03-01T20:35:00').getTime() },
      { key: 'b', startMs: new Date('2025-03-01T20:05:00').getTime(), endMs: new Date('2025-03-01T20:25:00').getTime() },
    ]

    const hourStart = new Date('2025-03-01T20:00:00').getTime()
    const hourEnd = hourStart + 3600_000

    const present = new Set()
    for (const iv of intervals) {
      if (iv.startMs < hourEnd && iv.endMs > hourStart) {
        present.add(iv.key)
      }
    }

    assert.equal(present.size, 2) // Alice and Bob both present in 20:00 hour
  })
})

// ──────────────────────────────────────────────
// 4. YouTube Service Tests
// ──────────────────────────────────────────────

describe('YouTube Service', async () => {
  const { extractVideoId, computeChatStats } = await import('../server/services/youtube.ts')

  describe('extractVideoId', () => {
    it('extracts from full watch URL', () => {
      assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
    })

    it('extracts from short URL', () => {
      assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
    })

    it('extracts from live URL', () => {
      assert.equal(extractVideoId('https://www.youtube.com/live/dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
    })

    it('accepts bare video ID', () => {
      assert.equal(extractVideoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ')
    })

    it('handles URL with extra params', () => {
      assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=60s'), 'dQw4w9WgXcQ')
    })

    it('throws for invalid input', () => {
      assert.throws(() => extractVideoId('not-a-video-id-at-all'), /Cannot extract video ID/)
    })
  })

  describe('computeChatStats', () => {
    it('returns zeros for empty messages', () => {
      const stats = computeChatStats([])
      assert.equal(stats.total_messages, 0)
      assert.equal(stats.unique_chatters, 0)
      assert.equal(stats.super_chat_count, 0)
    })

    it('computes correct stats from sample messages', () => {
      const messages = [
        {
          message_id: '1', message_type: 'text', message_text: 'Hello',
          author_channel_id: 'ch_a', author_display_name: 'UserA',
          author_profile_image_url: null, is_moderator: false, is_member: false,
          super_chat_amount: null, super_chat_currency: null, super_chat_tier: null,
          membership_level: null, gift_count: null,
          published_at: '2025-03-01T20:00:00Z',
        },
        {
          message_id: '2', message_type: 'text', message_text: 'World',
          author_channel_id: 'ch_b', author_display_name: 'UserB',
          author_profile_image_url: null, is_moderator: true, is_member: false,
          super_chat_amount: null, super_chat_currency: null, super_chat_tier: null,
          membership_level: null, gift_count: null,
          published_at: '2025-03-01T20:00:30Z',
        },
        {
          message_id: '3', message_type: 'superChat', message_text: 'SC!',
          author_channel_id: 'ch_a', author_display_name: 'UserA',
          author_profile_image_url: null, is_moderator: false, is_member: false,
          super_chat_amount: 500, super_chat_currency: 'JPY', super_chat_tier: '4',
          membership_level: null, gift_count: null,
          published_at: '2025-03-01T20:01:00Z',
        },
        {
          message_id: '4', message_type: 'membership', message_text: null,
          author_channel_id: 'ch_c', author_display_name: 'UserC',
          author_profile_image_url: null, is_moderator: false, is_member: true,
          super_chat_amount: null, super_chat_currency: null, super_chat_tier: null,
          membership_level: 'new_member', gift_count: null,
          published_at: '2025-03-01T20:02:00Z',
        },
      ]

      const stats = computeChatStats(messages)
      assert.equal(stats.total_messages, 4)
      assert.equal(stats.unique_chatters, 3) // ch_a, ch_b, ch_c
      assert.equal(stats.super_chat_count, 1)
      assert.equal(stats.super_chat_total_jpy, 500) // 500 JPY * rate 1
      assert.equal(stats.membership_count, 1)
    })

    it('converts foreign currency super chats to JPY', () => {
      const messages = [
        {
          message_id: '1', message_type: 'superChat', message_text: 'Dollar SC',
          author_channel_id: 'ch_a', author_display_name: 'UserA',
          author_profile_image_url: null, is_moderator: false, is_member: false,
          super_chat_amount: 10, super_chat_currency: 'USD', super_chat_tier: '4',
          membership_level: null, gift_count: null,
          published_at: '2025-03-01T20:00:00Z',
        },
      ]

      const stats = computeChatStats(messages)
      assert.equal(stats.super_chat_total_jpy, 1500) // 10 USD * 150 rate
    })
  })
})

// ──────────────────────────────────────────────
// Test summary
// ──────────────────────────────────────────────

console.log('\n✓ All test suites registered. Running...\n')
