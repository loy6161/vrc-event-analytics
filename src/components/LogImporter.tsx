import { useState, useEffect } from 'react'
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

  useEffect(() => {
    loadImportHistory()
  }, [])

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
    const params = new URLSearchParams({ fileName: file.name })
    if (force) params.set('force', 'true')
    const res = await fetch(`/api/logs/parse?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: file,
    })
    const json = await res.json()

    if (!json.success) {
      return { fileName: file.name, success: false, message: json.error ?? 'Import failed' }
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

    const created = data.createdEvents || []
    const eventCount = data.playerEventsInserted || 0
    const users = data.usersUpserted || 0
    const sessions = data.sessionsFound || 0
    const msg = created.length > 0
      ? `${created.length}件のイベントを自動作成、${eventCount}件のJoin/Leaveを記録、${users}名を登録`
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

    await loadImportHistory()
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

  const handleDeleteLog = async (log: ImportedLog) => {
    if (!confirm(`"${log.file_name}" のインポート記録を削除しますか？\n関連するプレイヤーイベントも削除されます。`)) return

    setDeletingId(log.id)
    try {
      const res = await fetch(`/api/logs/${log.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (json.success) {
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
        <h3>📚 インポート履歴</h3>
        {importHistory.length === 0 ? (
          <div className="history-empty">
            <p>まだログがインポートされていません</p>
          </div>
        ) : (
          <div className="history-table">
            <div className="history-header">
              <div className="col-name">ファイル名</div>
              <div className="col-date">インポート日時</div>
              <div className="col-count">イベント数</div>
              <div className="col-actions">操作</div>
            </div>
            {importHistory.map(log => (
              <div key={log.id} className="history-row">
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
                    disabled={deletingId === log.id}
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
