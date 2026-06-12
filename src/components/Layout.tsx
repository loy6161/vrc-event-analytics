import { useState, useEffect, ReactNode } from 'react'
import { WatcherStatus } from './WatcherStatus'
import { useSeries } from '../contexts/SeriesContext'
import '../styles/Layout.css'

interface LayoutProps {
  children: ReactNode
}

const NAV_GROUPS = [
  {
    label: 'データ収集',
    items: [
      { href: '#/logs',     icon: '📂', label: 'ログ取込',      match: /^\/logs/ },
      { href: '#/events',   icon: '📅', label: 'イベント',      match: /^\/events/ },
    ],
  },
  {
    label: '分析',
    items: [
      { href: '#/',         icon: '📊', label: 'ダッシュボード', match: /^[/]?$/ },
      { href: '#/reports',  icon: '📋', label: 'レポート',      match: /^\/reports/ },
      { href: '#/insights', icon: '💡', label: 'インサイト',    match: /^\/insights/ },
      { href: '#/rankings', icon: '🏆', label: 'ランキング',    match: /^\/rankings/ },
      { href: '#/users',    icon: '👥', label: 'ユーザー',      match: /^\/users/ },
      { href: '#/youtube',     icon: '📺', label: 'YouTube',       match: /^\/youtube/ },
      { href: '#/performers', icon: '🎤', label: '出演者',        match: /^\/performers/ },
    ],
  },
  {
    label: '設定',
    items: [
      { href: '#/settings', icon: '⚙️', label: '設定',          match: /^\/settings/ },
      { href: '#/help',     icon: '❓', label: 'ヘルプ',        match: /^\/help/ },
    ],
  },
]

function SeriesSwitcher() {
  const { series, setSeries, seriesMeta, colorOf } = useSeries()
  if (seriesMeta.length === 0) return null

  const Item = ({ value, label, dot }: { value: string; label: string; dot?: string }) => (
    <button
      className={`series-switch-item${series === value ? ' active' : ''}`}
      onClick={() => setSeries(value)}
      title={label}
    >
      <span className="series-switch-dot" style={{ background: dot ?? 'transparent', border: dot ? 'none' : '1.5px solid currentColor' }} />
      <span className="series-switch-label">{label}</span>
    </button>
  )

  return (
    <div className="series-switcher">
      <div className="series-switch-caption">表示中のイベント</div>
      <Item value="" label="全体（横断）" />
      {seriesMeta.map(s => (
        <Item key={s.name} value={s.name} label={s.name} dot={colorOf(s.name)} />
      ))}
    </div>
  )
}

export function Sidebar() {
  const [currentPath, setCurrentPath] = useState(() =>
    window.location.hash.slice(1) || '/'
  )

  useEffect(() => {
    const onHashChange = () => {
      setCurrentPath(window.location.hash.slice(1) || '/')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h2>VRC Event Data</h2>
      </div>
      <SeriesSwitcher />
      <nav className="sidebar-nav">
        {NAV_GROUPS.map(group => (
          <div key={group.label} className="nav-group">
            <div className="nav-group-label">{group.label}</div>
            {group.items.map(({ href, icon, label, match }) => (
              <a
                key={href}
                href={href}
                className={`nav-item${match.test(currentPath) ? ' active' : ''}`}
                title={label}
              >
                <span className="nav-icon">{icon}</span>
                <span className="nav-label">{label}</span>
              </a>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}

export function Header() {
  const { series, setSeries, colorOf } = useSeries()
  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-title">VRC Event Data</h1>
        {/* 現在のスコープを全ページで常時表示（モード見落とし対策）。×で全体に戻る */}
        {series ? (
          <span className="scope-chip" title="表示中のシリーズ。×で全体に戻る">
            <span className="scope-chip-dot" style={{ background: colorOf(series) }} />
            🎪 {series}
            <button className="scope-chip-clear" onClick={() => setSeries('')} title="全体に戻す">×</button>
          </span>
        ) : (
          <span className="scope-chip scope-chip-all">🌐 全イベント（横断）</span>
        )}
      </div>
      <div className="header-right">
        <WatcherStatus />
        <a href="#/settings" className="btn-icon" title="設定">⚙️</a>
      </div>
    </header>
  )
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="app-layout">
      <Sidebar />
      <div className="app-main">
        <Header />
        <main className="app-content">
          {children}
        </main>
      </div>
    </div>
  )
}
