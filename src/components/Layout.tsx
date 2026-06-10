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
        <h2>VRChat Analytics</h2>
      </div>
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
  const { series, setSeries, seriesList } = useSeries()
  return (
    <header className="header">
      <div className="header-left">
        <h1 className="header-title">VRChat Event Analytics</h1>
      </div>
      <div className="header-right">
        {/* グローバルのシリーズ絞り込み。全ページ（ダッシュボード/レポート/インサイト/
            ランキング/ユーザー/出演者/イベント一覧）がこの選択で再計算される */}
        {seriesList.length > 0 && (
          <select
            value={series}
            onChange={e => setSeries(e.target.value)}
            title="シリーズで全ページを絞り込み"
            style={{
              padding: '6px 10px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              border: series ? '1.5px solid #6366f1' : '1px solid rgba(128,128,128,0.3)',
              background: series ? 'rgba(99,102,241,0.08)' : 'transparent',
              color: 'inherit', cursor: 'pointer', maxWidth: 200,
            }}
          >
            <option value="">🎪 全イベント</option>
            {seriesList.map(s => <option key={s} value={s}>🎪 {s}</option>)}
          </select>
        )}
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
