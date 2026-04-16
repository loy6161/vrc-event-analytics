import { useState, useEffect } from 'react'
import '../styles/Settings.css'

interface SettingsData {
  vrchatLogDir: string
  youtubeApiKey: string
  autoMonitoring: boolean
  showApiKey: boolean
}

const DEFAULT_LOG_DIR = '%USERPROFILE%\\AppData\\LocalLow\\VRChat\\VRChat'

export function Settings() {
  const [settings, setSettings] = useState<SettingsData>({
    vrchatLogDir: DEFAULT_LOG_DIR,
    youtubeApiKey: '',
    autoMonitoring: false,
    showApiKey: false,
  })

  const [saved, setSaved] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')

  // Load settings from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('vrc-analytics-settings')
    if (stored) {
      try {
        const loaded = JSON.parse(stored)
        setSettings(prev => ({ ...prev, ...loaded }))
      } catch {
        // Ignore parse errors
      }
    }
  }, [])

  const handleInputChange = (field: keyof SettingsData, value: string | boolean) => {
    setSettings(prev => ({ ...prev, [field]: value }))
    setSaved(false)
  }

  const handleSave = () => {
    localStorage.setItem(
      'vrc-analytics-settings',
      JSON.stringify({
        vrchatLogDir: settings.vrchatLogDir,
        youtubeApiKey: settings.youtubeApiKey,
        autoMonitoring: settings.autoMonitoring,
      })
    )
    setSaveMessage('✓ Settings saved')
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const handleReset = () => {
    if (window.confirm('Reset all settings to defaults?')) {
      const defaults = {
        vrchatLogDir: DEFAULT_LOG_DIR,
        youtubeApiKey: '',
        autoMonitoring: false,
        showApiKey: false,
      }
      setSettings(defaults)
      localStorage.removeItem('vrc-analytics-settings')
      setSaveMessage('✓ Settings reset to defaults')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  const handleSuggestDefault = () => {
    handleInputChange('vrchatLogDir', DEFAULT_LOG_DIR)
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>設定</h1>
        <p>VRChat ログ監視と YouTube API 連携を設定</p>
      </div>

      <div className="settings-container">
        {/* VRChat Log Directory Section */}
        <section className="settings-section">
          <div className="section-header">
            <h2>📁 VRChat ログディレクトリ</h2>
            <p>VRChat ログファイルのパス（自動監視に使用）</p>
          </div>

          <div className="form-group">
            <label htmlFor="logDir">ログディレクトリパス</label>
            <input
              id="logDir"
              type="text"
              className="text-input"
              value={settings.vrchatLogDir}
              onChange={e => handleInputChange('vrchatLogDir', e.target.value)}
              placeholder={DEFAULT_LOG_DIR}
            />
            <p className="input-hint">
              <code>%USERPROFILE%</code> などの環境変数が使用できます
            </p>
            <button className="btn-secondary" onClick={handleSuggestDefault}>
              デフォルトパスを使用
            </button>
          </div>

          <div className="info-box">
            <span className="info-icon">ℹ️</span>
            <div>
              <p className="info-title">デフォルトログ場所</p>
              <code className="info-code">{DEFAULT_LOG_DIR}</code>
              <p className="info-desc">
                VRChat はこのディレクトリに自動的にログを作成します。監視を有効化する前にこのディレクトリが存在することを確認してください。
              </p>
            </div>
          </div>
        </section>

        {/* YouTube API Section */}
        <section className="settings-section">
          <div className="section-header">
            <h2>📺 YouTube Data API</h2>
            <p>配信分析とチャットデータ収集を有効化</p>
          </div>

          <div className="form-group">
            <label htmlFor="apiKey">APIキー</label>
            <div className="input-wrapper">
              <input
                id="apiKey"
                type={settings.showApiKey ? 'text' : 'password'}
                className="text-input"
                value={settings.youtubeApiKey}
                onChange={e => handleInputChange('youtubeApiKey', e.target.value)}
                placeholder="YouTube Data API v3 キー"
              />
              <button
                className="toggle-visibility"
                onClick={() => handleInputChange('showApiKey', !settings.showApiKey)}
                title={settings.showApiKey ? '非表示' : '表示'}
              >
                {settings.showApiKey ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
            <p className="input-hint">
              <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer">Google Cloud Console</a> からキーを取得
            </p>
          </div>

          <div className="info-box">
            <span className="info-icon">🔐</span>
            <div>
              <p className="info-title">セキュリティに関する注意</p>
              <p className="info-desc">
                APIキーはブラウザに保存されます。決して公開共有しないでください。
              </p>
            </div>
          </div>
        </section>

        {/* Auto-Monitoring Section */}
        <section className="settings-section">
          <div className="section-header">
            <h2>⚙️ 自動監視</h2>
            <p>ログディレクトリを監視して新しいファイルを自動インポート</p>
          </div>

          <div className="form-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={settings.autoMonitoring}
                onChange={e => handleInputChange('autoMonitoring', e.target.checked)}
              />
              <span className="checkbox-text">自動監視を有効化</span>
            </label>
            <p className="input-hint">
              有効にすると、設定ディレクトリの新しいログファイルが自動検出されてインポートされます。
            </p>
          </div>

          <div className="status-box" style={{ opacity: settings.autoMonitoring ? 1 : 0.5 }}>
            <span className="status-indicator" style={{ background: settings.autoMonitoring ? '#27ae60' : '#bbb' }} />
            <span className="status-text">
              {settings.autoMonitoring ? '自動監視: 有効' : '自動監視: 無効'}
            </span>
          </div>
        </section>

        {/* Actions */}
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={handleSave}>
            💾 設定を保存
          </button>
          <button className="btn btn-secondary" onClick={handleReset}>
            🔄 デフォルトに戻す
          </button>
        </div>

        {/* Status Message */}
        {saved && (
          <div className="settings-status">
            {saveMessage}
          </div>
        )}
      </div>
    </div>
  )
}
