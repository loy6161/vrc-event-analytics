/**
 * Browser-side VRChat log parser.
 * Mirrors server/services/log-parser.ts without Node.js imports.
 * Large files are parsed here in the browser so only the extracted events
 * (a few hundred KB at most) are uploaded to the server.
 */

// ── Regex patterns (kept identical to server-side) ────────────────────────
const USER_ID_PATTERN = 'usr_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const TIMESTAMP_RE = /^(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2})/
const PLAYER_JOINED_RE = new RegExp(
  `\\[(?:NetworkManager|Behaviour)\\] OnPlayerJoined (.+?)(?:\\s\\((${USER_ID_PATTERN})\\))?$`
)
const PLAYER_LEFT_RE = new RegExp(
  `\\[(?:NetworkManager|Behaviour)\\] OnPlayerLeft (.+?)(?:\\s\\((${USER_ID_PATTERN})\\))?$`
)
const ENTERING_ROOM_RE = /\[Behaviour\] Entering Room: (.+)$/
const JOINING_INSTANCE_RE = /\[Behaviour\] Joining (wrld_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):(.+)$/
const JOINING_ROOM_MANAGER_RE = /\[RoomManager\] Joining (wrld_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}):(.+)$/
const REGION_RE = /~region\((\w+)\)/
const ACCESS_HIDDEN_RE = /~hidden\(/
const ACCESS_FRIENDS_RE = /~friends\(/
const ACCESS_CAN_REQUEST_INVITE_RE = /~canRequestInvite/
const ACCESS_GROUP_RE = /~group\(/
// アバター切替: "[Behaviour] Switching <表示名> to avatar <アバター名>"
const AVATAR_SWITCH_RE = /\[Behaviour\] Switching (.+?) to avatar (.+)$/
// アバターの作者: "[AssetBundleDownloadManager] [N] Unpacking Avatar (<アバター名> by <作者>)"
const AVATAR_AUTHOR_RE = /Unpacking Avatar \((.+) by (.+)\)$/

// ── Types ─────────────────────────────────────────────────────────────────

export interface ClientPlayerEvent {
  type: 'join' | 'leave'
  displayName: string
  userId?: string
  timestamp: string
}

export interface ClientWorldSession {
  worldName?: string
  worldId?: string
  instanceId?: string
  region?: string
  accessType?: string
  startTime: string
  endTime: string
  playerEvents: ClientPlayerEvent[]
}

export interface ClientAvatarSwitch {
  displayName: string
  avatarName: string
  author?: string
  timestamp: string
}

export interface ClientParseResult {
  fileName: string
  fileHash: string
  sessions: ClientWorldSession[]
  avatarSwitches: ClientAvatarSwitch[]
  summary: {
    totalLines: number
    joinCount: number
    leaveCount: number
    uniquePlayers: number
    worldChanges: number
    avatarSwitches: number
  }
}

type RawEvent =
  | ClientPlayerEvent
  | { type: 'entering_room'; worldName: string; timestamp: string }
  | { type: 'joining_instance'; worldId: string; instanceId: string; region?: string; accessType?: string; timestamp: string }

// ── Helpers ───────────────────────────────────────────────────────────────

async function sha256hex(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content)
  const buf = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function parseTimestamp(raw: string): string {
  return raw.replace(/\./g, '-').replace(' ', 'T')
}

function parseInstanceParams(paramStr: string) {
  const tildeIdx = paramStr.indexOf('~')
  const instanceNumber = tildeIdx === -1 ? paramStr : paramStr.substring(0, tildeIdx)
  const region = paramStr.match(REGION_RE)?.[1]
  const hasHidden = ACCESS_HIDDEN_RE.test(paramStr)
  const hasFriends = ACCESS_FRIENDS_RE.test(paramStr)
  const hasCanRequestInvite = ACCESS_CAN_REQUEST_INVITE_RE.test(paramStr)
  const hasGroup = ACCESS_GROUP_RE.test(paramStr)
  let accessType = 'public'
  if (hasGroup) {
    // ~groupAccessType(members|plus|public) で Group / Group+ / Group公開 を区別
    const ga = paramStr.match(/~groupAccessType\((\w+)\)/)?.[1]
    accessType = ga === 'plus' ? 'group+' : ga === 'public' ? 'group public' : 'group'
  }
  else if (hasFriends && hasCanRequestInvite) accessType = 'friends+'
  else if (hasFriends) accessType = 'friends'
  else if (hasHidden && hasCanRequestInvite) accessType = 'invite+'
  else if (hasHidden) accessType = 'invite'
  return { instanceNumber, region, accessType }
}

function parseLine(line: string): RawEvent | null {
  const tsMatch = line.match(TIMESTAMP_RE)
  if (!tsMatch) return null
  const timestamp = parseTimestamp(tsMatch[1])

  const joinMatch = line.match(PLAYER_JOINED_RE)
  if (joinMatch) return { type: 'join', displayName: joinMatch[1].trim(), userId: joinMatch[2] ?? undefined, timestamp }

  const leaveMatch = line.match(PLAYER_LEFT_RE)
  if (leaveMatch) return { type: 'leave', displayName: leaveMatch[1].trim(), userId: leaveMatch[2] ?? undefined, timestamp }

  const roomMatch = line.match(ENTERING_ROOM_RE)
  if (roomMatch) return { type: 'entering_room', worldName: roomMatch[1].trim(), timestamp }

  const instanceMatch = line.match(JOINING_INSTANCE_RE) ?? line.match(JOINING_ROOM_MANAGER_RE)
  if (instanceMatch) {
    const worldId = instanceMatch[1]
    const paramStr = instanceMatch[2]
    const { region, accessType } = parseInstanceParams(paramStr)
    return { type: 'joining_instance', worldId, instanceId: `${worldId}:${paramStr}`, region, accessType, timestamp }
  }

  return null
}

function segmentIntoSessions(events: RawEvent[]): ClientWorldSession[] {
  const sessions: ClientWorldSession[] = []
  let currentSession: ClientWorldSession | null = null
  let pendingWorldName: string | null = null
  const orphanedPlayerEvents: ClientPlayerEvent[] = []

  for (const event of events) {
    if (event.type === 'entering_room') {
      pendingWorldName = event.worldName
      continue
    }
    if (event.type === 'joining_instance') {
      if (currentSession && currentSession.instanceId === event.instanceId) {
        pendingWorldName = null
        continue
      }
      if (currentSession && currentSession.playerEvents.length > 0) sessions.push(currentSession)
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
    if (event.type === 'join' || event.type === 'leave') {
      if (currentSession) {
        currentSession.playerEvents.push(event as ClientPlayerEvent)
        currentSession.endTime = event.timestamp
      } else {
        orphanedPlayerEvents.push(event as ClientPlayerEvent)
      }
    }
  }

  if (currentSession && currentSession.playerEvents.length > 0) sessions.push(currentSession)
  if (orphanedPlayerEvents.length > 0) {
    const timestamps = orphanedPlayerEvents.map(e => e.timestamp).sort()
    sessions.unshift({
      worldName: pendingWorldName ?? undefined,
      startTime: timestamps[0],
      endTime: timestamps[timestamps.length - 1],
      playerEvents: orphanedPlayerEvents,
    })
  }
  return sessions
}

// ── Public API ────────────────────────────────────────────────────────────

export async function parseLogFileInBrowser(file: File): Promise<ClientParseResult> {
  let content = await file.text()
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)

  const fileHash = await sha256hex(content)

  const events: RawEvent[] = []
  const rawSwitches: { displayName: string; avatarName: string; timestamp: string }[] = []
  const authorByAvatar = new Map<string, string>() // avatar名 → 作者（Unpacking行から）
  let totalLines = 0
  let pos = 0
  while (pos <= content.length) {
    const nl = content.indexOf('\n', pos)
    const end = nl === -1 ? content.length : nl
    const lineEnd = end > pos && content[end - 1] === '\r' ? end - 1 : end
    const line = content.slice(pos, lineEnd)
    pos = end + 1
    totalLines++
    const ev = parseLine(line)
    if (ev) { events.push(ev); continue }

    // アバター切替（タイムスタンプ付き行のみ）
    const sw = line.match(AVATAR_SWITCH_RE)
    if (sw) {
      const ts = line.match(TIMESTAMP_RE)
      if (ts) rawSwitches.push({ displayName: sw[1].trim(), avatarName: sw[2].trim(), timestamp: parseTimestamp(ts[1]) })
      continue
    }
    // アバター作者（名前→作者の対応表を作る）
    const au = line.match(AVATAR_AUTHOR_RE)
    if (au) authorByAvatar.set(au[1].trim(), au[2].trim())
  }

  const sessions = segmentIntoSessions(events)
  const playerEvents = events.filter(e => e.type === 'join' || e.type === 'leave') as ClientPlayerEvent[]
  const uniquePlayers = new Set(playerEvents.map(e => e.displayName))

  // 切替に作者を後付け（同名アバターの作者を名前一致で補完）
  const avatarSwitches: ClientAvatarSwitch[] = rawSwitches.map(s => ({
    ...s,
    author: authorByAvatar.get(s.avatarName),
  }))

  return {
    fileName: file.name,
    fileHash,
    sessions,
    avatarSwitches,
    summary: {
      totalLines,
      joinCount: playerEvents.filter(e => e.type === 'join').length,
      leaveCount: playerEvents.filter(e => e.type === 'leave').length,
      uniquePlayers: uniquePlayers.size,
      worldChanges: events.filter(e => e.type === 'entering_room').length,
      avatarSwitches: avatarSwitches.length,
    },
  }
}
