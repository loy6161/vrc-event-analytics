import { useState, useEffect, useRef, useCallback } from 'react'
import '../styles/WatcherStatus.css'

const API = '/api'

interface WatcherStatusData {
  running: boolean
  directory: string | null
  startedAt: string | null
  filesWatched: number
  totalImports: number
  lastImportAt: string | null
}

interface WatcherEvent {
  type: string
  timestamp: string
  data?: Record<string, unknown>
}

interface ImportNotification {
  id: number
  fileName: string
  eventsInserted: number
  matchedEventName: string | null
  timestamp: string
}

export function WatcherStatus() {
  const [status, setStatus] = useState<WatcherStatusData | null>(null)
  const [notifications, setNotifications] = useState<ImportNotification[]>([])
  const [showPanel, setShowPanel] = useState(false)
  const [toggling, setToggling] = useState(false)
  const sseRef = useRef<EventSource | null>(null)
  const notifIdRef = useRef(0)

  const addNotification = useCallback((notif: Omit<ImportNotification, 'id'>) => {
    const id = ++notifIdRef.current
    setNotifications(prev => [{ ...notif, id }, ...prev].slice(0, 10))
    // Auto-dismiss after 8s
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id))
    }, 8000)
  }, [])

  // Connect SSE stream
  useEffect(() => {
    const connect = () => {
      const es = new EventSource(`${API}/watcher/events`)

      es.onmessage = (e) => {
        try {
          const event: WatcherEvent = JSON.parse(e.data)

          if (event.data?.status) {
            setStatus(event.data.status as WatcherStatusData)
          }

          if (event.type === 'watcher:started' || event.type === 'watcher:stopped') {
            // Re-fetch status on start/stop
            fetch(`${API}/watcher/status`)
              .then(r => r.json())
              .then(d => { if (d.success) setStatus(d.data) })
              .catch(() => {})
          }

          if (event.type === 'watcher:file_imported' && event.data) {
            addNotification({
              fileName: String(event.data.fileName || ''),
              eventsInserted: Number(event.data.eventsInserted || 0),
              matchedEventName: event.data.matchedEventName ? String(event.data.matchedEventName) : null,
              timestamp: event.timestamp,
            })
            // Also refresh status
            fetch(`${API}/watcher/status`)
              .then(r => r.json())
              .then(d => { if (d.success) setStatus(d.data) })
              .catch(() => {})
          }
        } catch { /* ignore parse errors */ }
      }

      es.onerror = () => {
        es.close()
        // Reconnect after 5s
        setTimeout(connect, 5000)
      }

      sseRef.current = es
    }

    connect()

    // Also fetch initial status
    fetch(`${API}/watcher/status`)
      .then(r => r.json())
      .then(d => { if (d.success) setStatus(d.data) })
      .catch(() => {})

    return () => {
      sseRef.current?.close()
    }
  }, [addNotification])

  const toggleWatcher = async () => {
    if (!status || toggling) return
    setToggling(true)
    try {
      // Get directory from settings
      let directory: string | undefined
      try {
        const settings = JSON.parse(localStorage.getItem('vrc-analytics-settings') || '{}')
        if (settings.logDirectory) directory = settings.logDirectory
      } catch { /* ignore */ }

      const endpoint = status.running ? 'stop' : 'start'
      const body = endpoint === 'start' && directory
        ? JSON.stringify({ directory })
        : undefined

      await fetch(`${API}/watcher/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      const res = await fetch(`${API}/watcher/status`)
      const d = await res.json()
      if (d.success) setStatus(d.data)
    } catch { /* ignore */ } finally {
      setToggling(false)
    }
  }

  if (!status) return null

  return (
    <div className="watcher-widget">
      {/* Notifications */}
      <div className="watcher-notifications">
        {notifications.map(n => (
          <div key={n.id} className="watcher-notif">
            <span className="watcher-notif-icon">📥</span>
            <div className="watcher-notif-body">
              <strong>{n.eventsInserted}件のイベント</strong> が {n.fileName} からインポートされました
              {n.matchedEventName && (
                <span className="watcher-notif-event"> → {n.matchedEventName}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Status badge */}
      <div className="watcher-badge" onClick={() => setShowPanel(p => !p)}>
        <span className={`watcher-dot ${status.running ? 'active' : 'idle'}`} />
        <span className="watcher-label">
          {status.running ? '監視中' : '停止'}
        </span>
        {status.totalImports > 0 && (
          <span className="watcher-count">{status.totalImports}</span>
        )}
      </div>

      {/* Dropdown panel */}
      {showPanel && (
        <div className="watcher-panel">
          <div className="watcher-panel-header">
            <span className="watcher-panel-title">自動監視</span>
            <button
              className={`watcher-toggle ${status.running ? 'stop' : 'start'}`}
              onClick={toggleWatcher}
              disabled={toggling}
            >
              {toggling ? '...' : status.running ? '停止' : '開始'}
            </button>
          </div>

          {status.running && (
            <div className="watcher-panel-info">
              <div className="watcher-info-row">
                <span>ディレクトリ</span>
                <span className="watcher-info-val" title={status.directory ?? ''}>
                  {status.directory
                    ? status.directory.split(/[/\\]/).slice(-2).join('/')
                    : '-'}
                </span>
              </div>
              <div className="watcher-info-row">
                <span>インポート数</span>
                <span className="watcher-info-val">{status.totalImports}</span>
              </div>
              {status.lastImportAt && (
                <div className="watcher-info-row">
                  <span>最終インポート</span>
                  <span className="watcher-info-val">
                    {new Date(status.lastImportAt).toLocaleTimeString()}
                  </span>
                </div>
              )}
            </div>
          )}

          {!status.running && (
            <div className="watcher-panel-hint">
              新しいVRChatログファイルが表示されると自動的にインポートされます。
              まず設定でログディレクトリを設定してください。
            </div>
          )}
        </div>
      )}

      {/* Backdrop */}
      {showPanel && (
        <div className="watcher-backdrop" onClick={() => setShowPanel(false)} />
      )}
    </div>
  )
}
