import { useState, useEffect } from 'react'
import { dataCache } from '../utils/dataCache.js'
import '../styles/LogImporter.css'

interface ImportedLog {
  id: number
  file_name: string
  file_hash: string
  imported_at: string
  event_count: number
}

interface CreatedEvent {
  id: number
  name: string
  date: string
  worldName?: string
  merged?: boolean
}

interface ImportResult {
  fileName: string
  success: boolean
  message: string
  eventCount?: number
  alreadyImported?: boolean
  createdEvents?: CreatedEvent[]
  sessionsFound?: number
  usersUpserted?: number
}

export function LogImporter() {
  const [importHistory, setImportHistory] = useState<ImportedLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDragging, setIsDragging] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importProgress, setImportProgress] = useState<string | null>(null)
  const [importResults, setImportResults] = useState<ImportResult[]>([])
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  // 深夜の区切り時刻: 翌朝この時刻までは前日のイベントとしてまとめる（既定6時）
  const [cutoffHour, setCutoffHour] = useState(6)
  // メインのワールド名（部分一致・任意）。代表ワールド/イベント名に優先採用。
  // 前回値を localStorage から復元（毎回入力しなくて済む）
  const [mainWorld, setMainWorld] = useState(() => {
    try { return localStorage.getItem('vrcea:lastMainWorld') ?? '' } catch { return '' }
  })
  // 過去イベントのワールド名サジェスト候補（datalist 用）
  const [worldSuggestions, setWorldSuggestions] = useState<string[]>([])

  useEffect(() => {
    loadImportHistory()
    loadWorldSuggestions()
  }, [])

  // 過去イベントのワールド名を新しい順・重複なしで集めてサジェスト候補にする
  const loadWorldSuggestions = async () => {
    try {
      const res = await fetch('/api/events')
      const json = await res.json()
      if (json.success && Array.isArray(json.data)) {
        const seen = new Set<string>()
        const names: string[] = []
        for (const ev of json.data) {
          const w = (ev.world_name ?? '').trim()
          if (w && !seen.has(w)) { seen.add(w); names.push(w) }
        }
        setWorldSuggestions(names)
      }
    } catch {
      // サジェストは任意機能。失敗しても無視
    }
  }

  const loadImportHistory = async () => {
    try {
      const res = await fetch('/api/logs')
      const json = await res.json()
      if (json.success) {
        setImportHistory(json.data)
      } else {
        setError(json.error ?? 'Failed to load import history')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load import history')
    } finally {
      setIsLoading(false)
    }
  }

  const importSingleFile = async (file: File, force = false): Promise<ImportResult> => {
    // File オブジェクトを直接送信 — file.text() + JSON.stringify の二重メモリ確保を回避
    const params = new URLSearchParams({ fileName: file.name, cutoffHour: String(cutoffHour) })
    if (mainWorld.trim()) params.set('mainWorld', mainWorld.trim())
    if (force) params.set('force', 'true')
    const res = await fetch(`/api/logs/parse?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: file,
    })

    // レスポンスが JSON でないケース（Railwayのプロキシエラーなど）にも対応
    let json: any
    const rawText = await res.text()
    try {
      json = JSON.parse(rawText)
    } catch {
      return {
        fileName: file.name, success: false,
        message: `HTTP ${res.status}: ${rawText.slice(0, 200)}`,
      }
    }

    if (!json.success) {
      // Railway のプロキシエラーは {status:"error", code:502, message:"..."} 形式
      const msg = json.error ?? json.message ?? `HTTP ${res.status}: サーバーエラー`
      return { fileName: file.name, success: false, message: msg }
    }

    const data = json.data
    if (data.alreadyImported) {
      return {
        fileName: file.name,
        success: true,
        alreadyImported: true,
        message: '既にインポート済み',
        eventCount: data.playerEventsInserted || 0,
      }
    }

    const created: CreatedEvent[] = data.createdEvents || []
    const eventCount = data.playerEventsInserted || 0
    const users = data.usersUpserted || 0
    const sessions = data.sessionsFound || 0
    const newCount = created.filter(e => !e.merged).length
    const mergedCount = created.filter(e => e.merged).length
    const evtMsg = [
      newCount > 0 ? `${newCount}件のイベントを作成` : '',
      mergedCount > 0 ? `${mergedCount}件を既存イベントに結合` : '',
    ].filter(Boolean).join('・')
    const msg = evtMsg
      ? `${evtMsg}、${eventCount}件のJoin/Leaveを記録、${users}名を登録`
      : `${eventCount}件のJoin/Leaveを記録、${users}名を登録`

    return {
      fileName: file.name,
      success: true,
      alreadyImported: false,
      message: msg,
      eventCount,
      createdEvents: created,
      sessionsFound: sessions,
      usersUpserted: users,
    }
  }

  const handleFilesImport = async (files: File[], force = false) => {
    if (files.length === 0) return
    setIsImporting(true)
    setImportResults([])
    setError(null)

    const results: ImportResult[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      setImportProgress(
        files.length === 1
          ? `${file.name} を処理中...`
          : `(${i + 1}/${files.length}) ${file.name} を処理中...`
      )
      try {
        const result = await importSingleFile(file, force)
        results.push(result)
        // 途中経過を更新
        setImportResults([...results])
      } catch (err) {
        results.push({
          fileName: file.name,
          success: false,
          message: err instanceof Error ? err.message : 'Import failed',
        })
        setImportResults([...results])
      }
    }

    // 取込でイベント/ユーザー/集計が変わるので、一覧・分析ページのキャッシュを全破棄
    dataCache.clear()
    await loadImportHistory()
    loadWorldSuggestions()
    setIsImporting(false)
    setImportProgress(null)
  }

  const handleForceReimport = async (_fileName: string) => {
    // ファイル選択ダイアログを開いて再インポート
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.txt'
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files
      if (files && files.length > 0) {
        await handleFilesImport([files[0]], true)
      }
    }
    input.click()
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return
    if (!confirm(`選択した${selectedIds.size}件のインポート記録を削除しますか？\n関連するプレイヤーイベントも削除されます。`)) return

    setIsBulkDeleting(true)
    const ids = Array.from(selectedIds)
    let totalPlayerEvents = 0
    let totalEvents = 0
    for (const id of ids) {
      try {
        const res = await fetch(`/api/logs/${id}`, { method: 'DELETE' })
        const json = await res.json()
        if (json.success) {
          totalPlayerEvents += json.data.playerEventsDeleted
          totalEvents += json.data.eventsDeleted
        }
      } catch {
        // 失敗分はスキップして続行
      }
    }
    setSelectedIds(new Set())
    dataCache.clear()
    await loadImportHistory()
    setIsBulkDeleting(false)
    setImportResults([{
      fileName: `${ids.length}件`,
      success: true,
      message: `一括削除完了: プレイヤーイベント${totalPlayerEvents}件、自動作成イベント${totalEvents}件を削除`,
    }])
  }

  const handleDeleteLog = async (log: ImportedLog) => {
    if (!confirm(`"${log.file_name}" のインポート記録を削除しますか？\n関連するプレイヤーイベントも削除されます。`)) return

    setDeletingId(log.id)
    try {
      const res = await fetch(`/api/logs/${log.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.success) {
        dataCache.clear()
        await loadImportHistory()
        setImportResults([{
          fileName: log.file_name,
          success: true,
          message: `削除完了: ${json.data.playerEventsDeleted}件のイベント、${json.data.eventsDeleted}件の自動作成イベントを削除`,
        }])
      } else {
        setError(json.error ?? 'Failed to delete log')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete log')
    } finally {
      setDeletingId(null)
    }
  }

  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true) }
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false) }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.txt'))
    if (files.length > 0) handleFilesImport(files)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.currentTarget.files ?? [])
    if (files.length > 0) handleFilesImport(files)
    e.currentTarget.value = ''
  }

  if (isLoading) {
    return <div className="log-importer-loading">インポート履歴を読み込み中…</div>
  }

  const successCount = importResults.filter(r => r.success && !r.alreadyImported).length
  const skippedCount = importResults.filter(r => r.alreadyImported).length
  const failCount = importResults.filter(r => !r.success).length

  return (
    <div className="log-importer-container">
      <div className="importer-header">
        <h2>📋 ログ取込</h2>
        <p>VRChatの出力ログファイルをインポートして、プレイヤーの出入場イベントを抽出。複数ファイルを一括でドロップできます。</p>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        padding: '10px 14px', marginBottom: 12, borderRadius: 8,
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        fontSize: 13,
      }}>
        <span>🌙 深夜の区切り：翌朝</span>
        <select
          value={cutoffHour}
          onChange={e => setCutoffHour(Number(e.target.value))}
          disabled={isImporting}
          style={{ padding: '4px 8px', borderRadius: 6 }}
        >
          {[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(h => (
            <option key={h} value={h}>{h}時</option>
          ))}
        </select>
        <span>までは同じ日のイベントにまとめる</span>
        <span style={{ opacity: 0.6, width: '100%' }}>
          例：21時開始のライブ→打ち上げで翌2時まで遊んでも、1つのイベントにまとまります（日をまたいでも・ファイルが分かれてもOK）
        </span>

        <span style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.07)', margin: '4px 0' }} />

        <span>🏠 メインのワールド名（部分一致・任意）</span>
        <input
          value={mainWorld}
          onChange={e => {
            setMainWorld(e.target.value)
            try { localStorage.setItem('vrcea:lastMainWorld', e.target.value) } catch { /* 無視 */ }
          }}
          disabled={isImporting}
          placeholder="例：ALLVERSE"
          list="world-suggestions"
          style={{ padding: '4px 8px', borderRadius: 6, minWidth: 160 }}
        />
        {mainWorld && (
          <button
            type="button"
            onClick={() => {
              setMainWorld('')
              try { localStorage.removeItem('vrcea:lastMainWorld') } catch { /* 無視 */ }
            }}
            disabled={isImporting}
            title="クリア"
            style={{ padding: '4px 8px', borderRadius: 6, cursor: 'pointer', background: 'transparent', border: '1px solid rgba(255,255,255,0.15)', color: 'inherit' }}
          >
            ✕
          </button>
        )}
        <datalist id="world-suggestions">
          {worldSuggestions.map(w => <option key={w} value={w} />)}
        </datalist>
        <span style={{ opacity: 0.6, width: '100%' }}>
          指定すると、そのワールドをイベントの代表名に。空なら参加者が一番多いワールドを自動で代表にします（自宅ワールド回避）。
          欄をクリック/↓キーで過去のワールド名から選べます。前回の入力は記憶されます。
        </span>
      </div>

      {error && (
        <div className="importer-error">
          <div className="error-message">{error}</div>
          <button className="error-dismiss" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* Drop Zone */}
      <div
        className={`importer-dropzone ${isDragging ? 'dragging' : ''} ${isImporting ? 'disabled' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <div className="dropzone-content">
          <div className="dropzone-icon">📁</div>
          <h3>output_logファイルをドラッグ&ドロップ</h3>
          <p>複数ファイルを一括でドロップできます</p>
          <label htmlFor="file-input" className="btn btn-sm btn-primary">
            📂 ファイルを選択
          </label>
          <input
            id="file-input"
            type="file"
            accept=".txt"
            multiple
            onChange={handleFileSelect}
            disabled={isImporting}
            style={{ display: 'none' }}
          />
        </div>
      </div>

      {/* Progress */}
      {importProgress && (
        <div className="importer-progress">
          <div className="progress-spinner">⏳</div>
          <div className="progress-text">{importProgress}</div>
        </div>
      )}

      {/* Results */}
      {importResults.length > 0 && (
        <div className="import-results-section">
          {importResults.length > 1 && (
            <div className="import-results-summary">
              {successCount > 0 && <span className="summary-ok">✓ {successCount}件成功</span>}
              {skippedCount > 0 && <span className="summary-skip">⟳ {skippedCount}件スキップ</span>}
              {failCount > 0 && <span className="summary-fail">✕ {failCount}件失敗</span>}
            </div>
          )}
          {importResults.map((result, i) => (
            <div key={i} className={`importer-result ${result.success ? (result.alreadyImported ? 'skipped' : 'success') : 'error'}`}>
              <div className="result-icon">
                {result.alreadyImported ? '⟳' : result.success ? '✓' : '✕'}
              </div>
              <div className="result-content">
                <div className="result-filename">{result.fileName}</div>
                <div className="result-message">{result.message}</div>
                {result.alreadyImported && (
                  <button
                    className="btn btn-sm btn-secondary"
                    style={{ marginTop: '6px', width: 'fit-content' }}
                    onClick={() => handleForceReimport(result.fileName)}
                    disabled={isImporting}
                  >
                    🔄 再インポート
                  </button>
                )}
                {result.createdEvents && result.createdEvents.length > 0 && (
                  <div className="result-created-events">
                    <strong>作成されたイベント:</strong>
                    <ul>
                      {result.createdEvents.map(evt => (
                        <li key={evt.id}>
                          <a href="#/events" className="created-event-link">{evt.name}</a>
                          <span className="created-event-date"> ({evt.date})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Import History */}
      <div className="importer-history">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>📚 インポート履歴</h3>
          {selectedIds.size > 0 && (
            <button
              className="btn btn-sm"
              style={{ background: '#c0392b', color: '#fff', border: 'none', padding: '4px 12px', borderRadius: 6, cursor: 'pointer' }}
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
            >
              {isBulkDeleting ? '削除中...' : `選択した${selectedIds.size}件を削除`}
            </button>
          )}
        </div>
        {importHistory.length === 0 ? (
          <div className="history-empty">
            <p>まだログがインポートされていません</p>
          </div>
        ) : (
          <div className="history-table">
            <div className="history-header">
              <div className="col-check">
                <input
                  type="checkbox"
                  checked={importHistory.length > 0 && selectedIds.size === importHistory.length}
                  ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < importHistory.length }}
                  onChange={e => {
                    if (e.target.checked) setSelectedIds(new Set(importHistory.map(l => l.id)))
                    else setSelectedIds(new Set())
                  }}
                  title="全選択 / 全解除"
                />
              </div>
              <div className="col-name">ファイル名</div>
              <div className="col-date">インポート日時</div>
              <div className="col-count">イベント数</div>
              <div className="col-actions">操作</div>
            </div>
            {importHistory.map(log => (
              <div key={log.id} className={`history-row${selectedIds.has(log.id) ? ' selected' : ''}`}>
                <div className="col-check">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(log.id)}
                    onChange={e => {
                      const next = new Set(selectedIds)
                      if (e.target.checked) next.add(log.id)
                      else next.delete(log.id)
                      setSelectedIds(next)
                    }}
                  />
                </div>
                <div className="col-name">{log.file_name}</div>
                <div className="col-date">
                  {new Date(log.imported_at).toLocaleDateString('ja-JP')}{' '}
                  {new Date(log.imported_at).toLocaleTimeString('ja-JP')}
                </div>
                <div className="col-count">
                  <span className="count-badge">{log.event_count}</span>
                </div>
                <div className="col-actions">
                  <button
                    className="btn-delete-log"
                    onClick={() => handleDeleteLog(log)}
                    disabled={deletingId === log.id || isBulkDeleting}
                    title="このインポート記録と関連するイベントを削除"
                  >
                    {deletingId === log.id ? '...' : '✕'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
