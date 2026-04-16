import { Router, Request, Response } from 'express'
import * as XLSX from 'xlsx'
import {
  getEventById,
  getPlayerEventsByEventId,
  getUsers,
} from '../db/queries.js'
import {
  getStreams,
  getChatStats,
  getChatUsersByStreamId,
} from '../db/youtube-queries.js'

const router = Router()

function setDownloadHeaders(res: Response, filename: string, mimeType: string) {
  res.setHeader('Content-Type', mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
}

router.get('/events/:id/xlsx', async (req: Request, res: Response): Promise<void> => {
  try {
    const eventId = parseInt(req.params.id, 10)
    if (isNaN(eventId)) { res.status(400).json({ error: 'Invalid event ID' }); return }

    const event = await getEventById(eventId)
    if (!event) { res.status(404).json({ error: 'Event not found' }); return }

    const playerEvents = await getPlayerEventsByEventId(eventId)
    const wb = XLSX.utils.book_new()

    const summaryData = [
      ['Event Summary'], [],
      ['Event Name', event.name],
      ['Date', event.date],
      ['Start Time', event.start_time || '-'],
      ['End Time', event.end_time || '-'],
      ['World', event.world_name || '-'],
      ['World ID', event.world_id || '-'],
      ['Instance', event.instance_id || '-'],
      ['Description', event.description || '-'],
      [], ['Statistics'],
      ['Total Joins', playerEvents.filter(e => e.event_type === 'join').length],
      ['Total Leaves', playerEvents.filter(e => e.event_type === 'leave').length],
      ['Unique Players', new Set(playerEvents.map(e => e.user_id || e.display_name)).size],
    ]
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
    summarySheet['!cols'] = [{ wch: 20 }, { wch: 40 }]
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary')

    if (playerEvents.length > 0) {
      const eventRows = playerEvents.map(pe => ({
        Timestamp: pe.timestamp,
        'Display Name': pe.display_name,
        'User ID': pe.user_id || '-',
        Type: pe.event_type,
        'Log File': pe.log_file || '-',
      }))
      const eventSheet = XLSX.utils.json_to_sheet(eventRows)
      eventSheet['!cols'] = [{ wch: 25 }, { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 30 }]
      XLSX.utils.book_append_sheet(wb, eventSheet, 'Player Events')
    }

    const uniquePlayers = new Map<string, { displayName: string; userId?: string; joinCount: number; firstSeen: string; lastSeen: string }>()
    for (const e of playerEvents) {
      const key = e.user_id || e.display_name
      const ex = uniquePlayers.get(key)
      if (ex) {
        ex.joinCount += e.event_type === 'join' ? 1 : 0
        if (e.timestamp < ex.firstSeen) ex.firstSeen = e.timestamp
        if (e.timestamp > ex.lastSeen) ex.lastSeen = e.timestamp
      } else {
        uniquePlayers.set(key, { displayName: e.display_name, userId: e.user_id, joinCount: e.event_type === 'join' ? 1 : 0, firstSeen: e.timestamp, lastSeen: e.timestamp })
      }
    }
    const playerSheet = XLSX.utils.json_to_sheet(Array.from(uniquePlayers.values()).map(p => ({
      'Display Name': p.displayName, 'User ID': p.userId || '-', Visits: p.joinCount, 'First Seen': p.firstSeen, 'Last Seen': p.lastSeen,
    })))
    playerSheet['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 10 }, { wch: 25 }, { wch: 25 }]
    XLSX.utils.book_append_sheet(wb, playerSheet, 'Unique Players')

    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
    setDownloadHeaders(res, `event-${eventId}-${event.date}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.end(buffer)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

router.get('/events/:id/csv/player-events', async (req: Request, res: Response): Promise<void> => {
  try {
    const eventId = parseInt(req.params.id, 10)
    if (isNaN(eventId)) { res.status(400).json({ error: 'Invalid event ID' }); return }

    const event = await getEventById(eventId)
    if (!event) { res.status(404).json({ error: 'Event not found' }); return }

    const playerEvents = await getPlayerEventsByEventId(eventId)
    const headers = ['Timestamp', 'Display Name', 'User ID', 'Event Type', 'Log File']
    const rows = playerEvents.map(pe => [pe.timestamp, pe.display_name, pe.user_id || '', pe.event_type, pe.log_file || ''])
    const csv = [headers.map(h => `"${h}"`).join(','), ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n')

    setDownloadHeaders(res, `event-${eventId}-player-events.csv`, 'text/csv')
    res.end(csv)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

router.get('/users/csv', async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await getUsers()
    const headers = ['Display Name', 'User ID', 'First Seen', 'Staff', 'Notes', 'Tags']
    const rows = users.map(u => [u.display_name, u.user_id || '', u.first_seen || '', u.is_staff ? 'Yes' : 'No', u.notes || '', (u.tags || []).join(';')])
    const csv = [headers.map(h => `"${h}"`).join(','), ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n')

    setDownloadHeaders(res, `users-${new Date().toISOString().split('T')[0]}.csv`, 'text/csv')
    res.end(csv)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

router.get('/youtube/streams/:id/csv/chat-users', async (req: Request, res: Response): Promise<void> => {
  try {
    const streamId = parseInt(req.params.id, 10)
    if (isNaN(streamId)) { res.status(400).json({ error: 'Invalid stream ID' }); return }

    const streams = await getStreams()
    const stream = streams.find(s => s.id === streamId)
    if (!stream) { res.status(404).json({ error: 'Stream not found' }); return }

    const chatUsers = await getChatUsersByStreamId(streamId)
    const headers = ['Display Name', 'Channel ID', 'Messages', 'Is Moderator', 'Is Member', 'First Message', 'Last Message']
    const rows = chatUsers.map(u => [u.display_name, u.channel_id, u.message_count, u.is_moderator ? 'Yes' : 'No', u.is_member ? 'Yes' : 'No', u.first_message_at || '', u.last_message_at || ''])
    const csv = [headers.map(h => `"${h}"`).join(','), ...rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))].join('\n')

    setDownloadHeaders(res, `youtube-stream-${streamId}-chat-users.csv`, 'text/csv')
    res.end(csv)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

router.get('/youtube/streams/:id/xlsx', async (req: Request, res: Response): Promise<void> => {
  try {
    const streamId = parseInt(req.params.id, 10)
    if (isNaN(streamId)) { res.status(400).json({ error: 'Invalid stream ID' }); return }

    const streams = await getStreams()
    const stream = streams.find(s => s.id === streamId)
    if (!stream) { res.status(404).json({ error: 'Stream not found' }); return }

    const chatStats = await getChatStats(streamId)
    const chatUsers = await getChatUsersByStreamId(streamId)
    const wb = XLSX.utils.book_new()

    const summaryData: any[][] = [
      ['YouTube Stream Summary'], [],
      ['Video ID', stream.video_id],
      ['Title', stream.title || '-'],
      ['Channel', stream.channel_title || '-'],
      ['Scheduled Start', stream.scheduled_start || '-'],
      ['Actual Start', stream.actual_start || '-'],
      ['Actual End', stream.actual_end || '-'],
      ['Peak Concurrent Viewers', stream.peak_concurrent_viewers || 0],
      ['Total Views', stream.total_view_count || 0],
      ['Likes', stream.like_count || 0],
      ['Comments', stream.comment_count || 0],
    ]
    if (chatStats) {
      summaryData.push([], ['Chat Statistics'],
        ['Total Messages', chatStats.total_messages], ['Unique Chatters', chatStats.unique_chatters],
        ['Super Chat Count', chatStats.super_chat_count], ['Super Chat Total (JPY)', chatStats.super_chat_total_jpy],
        ['Memberships', chatStats.membership_count], ['Member Gifts', chatStats.member_gift_total],
        ['Peak Chat Per Minute', chatStats.peak_chat_per_minute], ['Avg Chat Per Minute', chatStats.avg_chat_per_minute.toFixed(2)],
      )
    }
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
    summarySheet['!cols'] = [{ wch: 25 }, { wch: 40 }]
    XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary')

    if (chatUsers.length > 0) {
      const userSheet = XLSX.utils.json_to_sheet(chatUsers.map(u => ({
        'Display Name': u.display_name, 'Channel ID': u.channel_id, Messages: u.message_count,
        'Is Moderator': u.is_moderator ? 'Yes' : 'No', 'Is Member': u.is_member ? 'Yes' : 'No',
        'First Message': u.first_message_at || '-', 'Last Message': u.last_message_at || '-',
      })))
      userSheet['!cols'] = [{ wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 25 }, { wch: 25 }]
      XLSX.utils.book_append_sheet(wb, userSheet, 'Chat Users')
    }

    const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' })
    setDownloadHeaders(res, `youtube-stream-${streamId}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.end(buffer)
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

export default router
