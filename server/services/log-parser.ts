import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface ParsedPlayerEvent {
  type: 'join' | 'leave'
  displayName: string
  userId?: string       // usr_xxx (Oct 2024+ logs only)
  timestamp: string     // ISO 8601
}

export interface ParsedWorldEvent {
  type: 'entering_room'
  worldName: string
  timestamp: string
}

export interface ParsedInstanceEvent {
  type: 'joining_instance'
  worldId: string       // wrld_xxx
  instanceId: string    // full instance string (wrld_xxx:nnn~params)
  instanceNumber: string
  region?: string       // us, eu, jp
  accessType?: string   // public, hidden, friends, friends+, invite, invite+, group
  timestamp: string
}

export type ParsedLogEvent = ParsedPlayerEvent | ParsedWorldEvent | ParsedInstanceEvent

export interface LogFileParseResult {
  fileName: string
  fileHash: string
  events: ParsedLogEvent[]
  playerEvents: ParsedPlayerEvent[]
  worldEvents: ParsedWorldEvent[]
  instanceEvents: ParsedInstanceEvent[]
  summary: {
    totalLines: number
    parsedEvents: number
    joinCount: number
    leaveCount: number
    uniquePlayers: number
    worldChanges: number
    timeRange: { start: string; end: string } | null
  }
}

// ──────────────────────────────────────────────
// Regex patterns
// ──────────────────────────────────────────────

// VRChat log timestamp: "2025.01.15 21:30:45"
// Always exactly 19 chars at the start of each log line
const TIMESTAMP_RE = /^(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2})/

// Player join/leave events
// Newer VRChat: "[Behaviour] OnPlayerJoined DisplayName (usr_UUID)"
// Older VRChat: "[NetworkManager] OnPlayerJoined DisplayName (usr_UUID)"
// Even older:   "[NetworkManager] OnPlayerJoined DisplayName"
// User ID format: usr_ followed by UUID (8-4-4-4-12 hex)
const USER_ID_PATTERN = 'usr_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'

const PLAYER_JOINED_RE = new RegExp(
  `\\[(?:NetworkManager|Behaviour)\\] OnPlayerJoined (.+?)(?:\\s\\((${USER_ID_PATTERN})\\))?$`
)

const PLAYER_LEFT_RE = new RegExp(
  `\\[(?:NetworkManager|Behaviour)\\] OnPlayerLeft (.+?)(?:\\s\\((${USER_ID_PATTERN})\\))?$`
)

// World/instance events
const ENTERING_ROOM_RE = /\[Behaviour\] Entering Room: (.+)$/
const JOINING_INSTANCE_RE = /\[Behaviour\] Joining (wrld_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):(.+)$/

// Also handle [RoomManager] variant (some VRChat versions)
const JOINING_ROOM_MANAGER_RE = /\[RoomManager\] Joining (wrld_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):(.+)$/

// Instance parameter patterns
const REGION_RE = /~region\((\w+)\)/
const ACCESS_HIDDEN_RE = /~hidden\(/
const ACCESS_FRIENDS_RE = /~friends\(/
const ACCESS_CAN_REQUEST_INVITE_RE = /~canRequestInvite/
const ACCESS_GROUP_RE = /~group\(/

// ──────────────────────────────────────────────
// Timestamp conversion
// ──────────────────────────────────────────────

/**
 * Convert VRChat log timestamp to ISO 8601.
 * Input:  "2025.01.15 21:30:45"
 * Output: "2025-01-15T21:30:45"
 *
 * Note: VRChat logs use LOCAL time (no timezone info in logs).
 * We store as-is without timezone suffix to preserve locality.
 */
function parseTimestamp(raw: string): string {
  // "2025.01.15 21:30:45" → "2025-01-15T21:30:45"
  return raw.replace(/\./g, '-').replace(' ', 'T')
}

// ──────────────────────────────────────────────
// Instance string parser
// ──────────────────────────────────────────────

/**
 * Parse VRChat instance parameter string.
 * Example: "12345~region(us)~nonce(xxx)~hidden(usr_xxx)"
 *
 * Access type determination:
 *  - No access params → public
 *  - ~hidden(usr_)    → invite (hidden = invite in VRC terms)
 *  - ~friends(usr_)   → friends
 *  - ~friends(usr_) + ~canRequestInvite → friends+
 *  - ~hidden(usr_) + ~canRequestInvite  → invite+
 *  - ~group(grp_)     → group
 */
function parseInstanceParams(paramStr: string): {
  instanceNumber: string
  region?: string
  accessType: string
} {
  // Instance number is everything before the first ~ (or the whole string)
  const tildeIdx = paramStr.indexOf('~')
  const instanceNumber = tildeIdx === -1 ? paramStr : paramStr.substring(0, tildeIdx)

  // Region
  const regionMatch = paramStr.match(REGION_RE)
  const region = regionMatch?.[1]

  // Access type
  const hasHidden = ACCESS_HIDDEN_RE.test(paramStr)
  const hasFriends = ACCESS_FRIENDS_RE.test(paramStr)
  const hasCanRequestInvite = ACCESS_CAN_REQUEST_INVITE_RE.test(paramStr)
  const hasGroup = ACCESS_GROUP_RE.test(paramStr)

  let accessType = 'public'
  if (hasGroup) {
    accessType = 'group'
  } else if (hasFriends && hasCanRequestInvite) {
    accessType = 'friends+'
  } else if (hasFriends) {
    accessType = 'friends'
  } else if (hasHidden && hasCanRequestInvite) {
    accessType = 'invite+'
  } else if (hasHidden) {
    accessType = 'invite'
  }

  return { instanceNumber, region, accessType }
}

// ──────────────────────────────────────────────
// Line parser
// ──────────────────────────────────────────────

/**
 * Parse a single VRChat log line into a structured event.
 * Returns null for lines that don't match any known event pattern.
 */
export function parseLine(line: string): ParsedLogEvent | null {
  // Extract timestamp
  const tsMatch = line.match(TIMESTAMP_RE)
  if (!tsMatch) return null

  const timestamp = parseTimestamp(tsMatch[1])

  // --- Player Join ---
  const joinMatch = line.match(PLAYER_JOINED_RE)
  if (joinMatch) {
    return {
      type: 'join',
      displayName: joinMatch[1].trim(),
      userId: joinMatch[2] ?? undefined,
      timestamp,
    }
  }

  // --- Player Leave ---
  const leaveMatch = line.match(PLAYER_LEFT_RE)
  if (leaveMatch) {
    return {
      type: 'leave',
      displayName: leaveMatch[1].trim(),
      userId: leaveMatch[2] ?? undefined,
      timestamp,
    }
  }

  // --- Entering Room ---
  const roomMatch = line.match(ENTERING_ROOM_RE)
  if (roomMatch) {
    return {
      type: 'entering_room',
      worldName: roomMatch[1].trim(),
      timestamp,
    }
  }

  // --- Joining Instance ([Behaviour] or [RoomManager]) ---
  const instanceMatch = line.match(JOINING_INSTANCE_RE) || line.match(JOINING_ROOM_MANAGER_RE)
  if (instanceMatch) {
    const worldId = instanceMatch[1]
    const paramStr = instanceMatch[2]
    const { instanceNumber, region, accessType } = parseInstanceParams(paramStr)

    return {
      type: 'joining_instance',
      worldId,
      instanceId: `${worldId}:${paramStr}`,
      instanceNumber,
      region,
      accessType,
      timestamp,
    }
  }

  return null
}

// ──────────────────────────────────────────────
// File parser
// ──────────────────────────────────────────────

/**
 * Compute SHA-256 hash of file content for duplicate detection.
 */
function hashFileContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex')
}

/**
 * Parse log content directly from a string.
 * Used for browser-based file uploads.
 * Handles UTF-8 with optional BOM.
 */
export function parseLogContent(content: string, fileName: string): LogFileParseResult {
  // Strip UTF-8 BOM if present
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1)
  }

  const fileHash = hashFileContent(content)
  const lines = content.split(/\r?\n/)

  const events: ParsedLogEvent[] = []
  const playerEvents: ParsedPlayerEvent[] = []
  const worldEvents: ParsedWorldEvent[] = []
  const instanceEvents: ParsedInstanceEvent[] = []
  const uniquePlayers = new Set<string>()

  for (const line of lines) {
    const event = parseLine(line)
    if (!event) continue

    events.push(event)

    switch (event.type) {
      case 'join':
      case 'leave':
        playerEvents.push(event)
        uniquePlayers.add(event.displayName)
        break
      case 'entering_room':
        worldEvents.push(event)
        break
      case 'joining_instance':
        instanceEvents.push(event)
        break
    }
  }

  // Compute time range from all parsed events
  let timeRange: { start: string; end: string } | null = null
  if (events.length > 0) {
    const timestamps = events.map(e => e.timestamp).sort()
    timeRange = {
      start: timestamps[0],
      end: timestamps[timestamps.length - 1],
    }
  }

  return {
    fileName,
    fileHash,
    events,
    playerEvents,
    worldEvents,
    instanceEvents,
    summary: {
      totalLines: lines.length,
      parsedEvents: events.length,
      joinCount: playerEvents.filter(e => e.type === 'join').length,
      leaveCount: playerEvents.filter(e => e.type === 'leave').length,
      uniquePlayers: uniquePlayers.size,
      worldChanges: worldEvents.length,
      timeRange,
    },
  }
}

/**
 * Read and parse a VRChat output_log file from disk.
 * Handles UTF-8 with optional BOM.
 */
export function parseLogFile(filePath: string): LogFileParseResult {
  let content = fs.readFileSync(filePath, 'utf-8')
  const fileName = path.basename(filePath)
  return parseLogContent(content, fileName)
}

// ──────────────────────────────────────────────
// Session segmentation
// ──────────────────────────────────────────────

/**
 * A "session" is a contiguous visit to a single world instance.
 * When a new "joining_instance" event is detected, a new session begins.
 * This groups player events by the world session they belong to.
 */
export interface WorldSession {
  worldName?: string
  worldId?: string
  instanceId?: string
  region?: string
  accessType?: string
  startTime: string
  endTime: string
  playerEvents: ParsedPlayerEvent[]
}

/**
 * Segment parsed events into world sessions.
 * Each session starts with a joining_instance event and contains
 * all player events until the next joining_instance event.
 */
export function segmentIntoSessions(events: ParsedLogEvent[]): WorldSession[] {
  const sessions: WorldSession[] = []
  let currentSession: WorldSession | null = null
  let pendingWorldName: string | null = null

  // Collect player events that appear before any joining_instance event.
  // These "orphaned" events will be placed into a default session so they
  // are not silently dropped.
  const orphanedPlayerEvents: ParsedPlayerEvent[] = []
  let hasSeenInstance = false

  for (const event of events) {
    if (event.type === 'entering_room') {
      // "Entering Room" fires just before "Joining" — stash the name
      if (!hasSeenInstance) {
        // Before any instance event, use it as fallback world name for orphans
        pendingWorldName = event.worldName
      } else {
        pendingWorldName = event.worldName
      }
      continue
    }

    if (event.type === 'joining_instance') {
      hasSeenInstance = true

      // 同じインスタンスへの再接続（リジョイン）はセッションを分割しない
      if (currentSession && currentSession.instanceId === event.instanceId) {
        pendingWorldName = null
        continue
      }

      // 別インスタンスへの移動 → 前のセッションを確定して新セッション開始
      if (currentSession && currentSession.playerEvents.length > 0) {
        sessions.push(currentSession)
      }

      // Start new session
      currentSession = {
        worldName: pendingWorldName ?? undefined,
        worldId: event.worldId,
        instanceId: event.instanceId,
        region: event.region,
        accessType: event.accessType,
        startTime: event.timestamp,
        endTime: event.timestamp,
        playerEvents: [],
      }
      pendingWorldName = null
      continue
    }

    // Player join/leave
    if (event.type === 'join' || event.type === 'leave') {
      if (currentSession) {
        currentSession.playerEvents.push(event)
        currentSession.endTime = event.timestamp
      } else {
        // No instance event yet — collect as orphaned
        orphanedPlayerEvents.push(event)
      }
    }
  }

  // Push final session
  if (currentSession && currentSession.playerEvents.length > 0) {
    sessions.push(currentSession)
  }

  // If there are orphaned player events (no joining_instance found before them),
  // create a fallback session so they are not lost.
  if (orphanedPlayerEvents.length > 0) {
    const timestamps = orphanedPlayerEvents.map(e => e.timestamp).sort()
    const fallbackSession: WorldSession = {
      worldName: pendingWorldName ?? undefined,
      startTime: timestamps[0],
      endTime: timestamps[timestamps.length - 1],
      playerEvents: orphanedPlayerEvents,
    }
    // Prepend orphan session at the beginning (chronologically first)
    sessions.unshift(fallbackSession)
  }

  return sessions
}

// ──────────────────────────────────────────────
// Player stay duration calculation
// ──────────────────────────────────────────────

export interface PlayerStay {
  displayName: string
  userId?: string
  joinTime: string
  leaveTime: string | null   // null = still present at end of session
  durationMinutes: number | null
}

/**
 * Pair join/leave events per player within a session.
 *
 * Algorithm:
 *  - Walk events chronologically
 *  - On join: push onto player's open-stay stack
 *  - On leave: pop from stack, compute duration
 *  - End of session: close all open stays with session end time
 *
 * Handles re-entry: a player who leaves and re-joins gets multiple stays.
 */
export function calculatePlayerStays(
  playerEvents: ParsedPlayerEvent[],
  sessionEndTime: string,
): PlayerStay[] {
  const openStays = new Map<string, ParsedPlayerEvent[]>() // displayName → stack of join events
  const stays: PlayerStay[] = []

  for (const event of playerEvents) {
    const key = event.displayName

    if (event.type === 'join') {
      if (!openStays.has(key)) {
        openStays.set(key, [])
      }
      openStays.get(key)!.push(event)
    }

    if (event.type === 'leave') {
      const stack = openStays.get(key)
      if (stack && stack.length > 0) {
        const joinEvent = stack.pop()!
        stays.push({
          displayName: event.displayName,
          userId: event.userId ?? joinEvent.userId,
          joinTime: joinEvent.timestamp,
          leaveTime: event.timestamp,
          durationMinutes: diffMinutes(joinEvent.timestamp, event.timestamp),
        })
      }
      // Leave without a matching join — ignore (player was already in world before log started)
    }
  }

  // Close all open stays at session end
  for (const [, stack] of openStays) {
    for (const joinEvent of stack) {
      stays.push({
        displayName: joinEvent.displayName,
        userId: joinEvent.userId,
        joinTime: joinEvent.timestamp,
        leaveTime: null,
        durationMinutes: diffMinutes(joinEvent.timestamp, sessionEndTime),
      })
    }
  }

  return stays
}

/**
 * Compute difference in minutes between two ISO timestamps.
 */
function diffMinutes(start: string, end: string): number {
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  return Math.round((e - s) / 60000)
}

// ──────────────────────────────────────────────
// Utility: find VRChat log directory
// ──────────────────────────────────────────────

/**
 * Returns the default VRChat log directory path for the current user.
 * Windows: %UserProfile%\AppData\LocalLow\VRChat\VRChat
 */
export function getDefaultLogDirectory(): string {
  const userProfile = process.env.USERPROFILE || process.env.HOME || ''
  return path.join(userProfile, 'AppData', 'LocalLow', 'VRChat', 'VRChat')
}

/**
 * List all VRChat output_log files in the given directory,
 * sorted by modification time (newest first).
 */
export function listLogFiles(directory: string): string[] {
  if (!fs.existsSync(directory)) return []

  return fs.readdirSync(directory)
    .filter(f => /^output_log_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/.test(f))
    .map(f => ({
      name: f,
      fullPath: path.join(directory, f),
      mtime: fs.statSync(path.join(directory, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(f => f.fullPath)
}
