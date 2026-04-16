import { useState, useEffect } from 'react'
import { Layout } from './components/Layout'
import { EventList } from './components/EventList'
import { EventForm } from './components/EventForm'
import { EventAnalyticsPanel } from './components/EventAnalyticsPanel'
import { Settings } from './components/Settings'
import { ReportsPage } from './components/ReportsPage'
import { InsightsPage } from './components/InsightsPage'
import { UserTable } from './components/UserTable'
import { UserDetail } from './components/UserDetail'
import { RankingPage } from './components/RankingPage'
import { Dashboard } from './components/Dashboard'
import { YouTubePage } from './components/YouTubePage'
import { LogImporter } from './components/LogImporter'
import { HelpPage } from './components/HelpPage'
import { PerformersPage } from './components/PerformersPage'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Event } from './types/index.js'
import './App.css'

type Page = 'dashboard' | 'events' | 'events-new' | 'events-edit' | 'users' | 'users-detail' | 'rankings' | 'reports' | 'insights' | 'youtube' | 'performers' | 'logs' | 'settings' | 'help'

function App() {
  const [currentPage, setCurrentPage] = useState<Page>('dashboard')
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null)
  const [editEventId, setEditEventId] = useState<number | null>(null)
  const [selectedUserName, setSelectedUserName] = useState<string | null>(null)

  // Simple router based on hash
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1) // Remove #
      const parts = hash.split('/').filter(Boolean) // Remove empty segments from leading /
      const [page, ...params] = parts.length > 0 ? parts : ['']

      if (page === 'events') {
        if (params[0] === 'new') {
          setCurrentPage('events-new')
          setEditEventId(null)
        } else if (params[0] && params[1] === 'edit') {
          setCurrentPage('events-edit')
          setEditEventId(parseInt(params[0]))
        } else {
          setCurrentPage('events')
          setEditEventId(null)
        }
      } else if (page === 'users') {
        if (params[0] === 'detail' && params[1]) {
          setCurrentPage('users-detail')
          setSelectedUserName(decodeURIComponent(params[1]))
        } else {
          setCurrentPage('users')
          setSelectedUserName(null)
        }
      } else if (page === 'rankings') {
        setCurrentPage('rankings')
      } else if (page === 'reports') {
        setCurrentPage('reports')
      } else if (page === 'insights') {
        setCurrentPage('insights')
      } else if (page === 'youtube') {
        setCurrentPage('youtube')
      } else if (page === 'performers') {
        setCurrentPage('performers')
      } else if (page === 'logs') {
        setCurrentPage('logs')
      } else if (page === 'settings') {
        setCurrentPage('settings')
      } else if (page === 'help') {
        setCurrentPage('help')
      } else {
        setCurrentPage('dashboard')
      }
    }

    window.addEventListener('hashchange', handleHashChange)
    handleHashChange() // Initial route

    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const renderPage = () => {
    switch (currentPage) {
      case 'events':
        return (
          <div className="page">
            <EventList onSelect={setSelectedEvent} />
            {selectedEvent && (
              <EventAnalyticsPanel
                eventId={selectedEvent.id}
                eventName={selectedEvent.name}
                event={selectedEvent}
              />
            )}
          </div>
        )

      case 'events-new':
        return (
          <div className="page">
            <EventForm onSuccess={() => setCurrentPage('events')} />
          </div>
        )

      case 'events-edit':
        return (
          <div className="page">
            <EventForm eventId={editEventId!} onSuccess={() => setCurrentPage('events')} />
          </div>
        )

      case 'dashboard':
        return (
          <div className="page">
            <Dashboard />
          </div>
        )

      case 'reports':
        return (
          <div className="page">
            <ReportsPage />
          </div>
        )

      case 'insights':
        return (
          <div className="page">
            <InsightsPage />
          </div>
        )

      case 'users':
        return (
          <div className="page">
            <div className="page-header">
              <h1>Users</h1>
              <p>View all users and their attendance history</p>
            </div>
            <UserTable
              onSelectUser={user => {
                setSelectedUserName(user.display_name)
                window.location.hash = `#/users/detail/${encodeURIComponent(user.display_name)}`
              }}
            />
          </div>
        )

      case 'users-detail':
        return (
          <div className="page">
            <UserDetail
              displayName={selectedUserName!}
              onBack={() => {
                setSelectedUserName(null)
                window.location.hash = '#/users'
              }}
            />
          </div>
        )

      case 'rankings':
        return (
          <div className="page">
            <RankingPage />
          </div>
        )

      case 'youtube':
        return (
          <div className="page">
            <YouTubePage />
          </div>
        )

      case 'performers':
        return (
          <div className="page">
            <PerformersPage />
          </div>
        )

      case 'logs':
        return (
          <div className="page">
            <LogImporter />
          </div>
        )

      case 'settings':
        return (
          <div className="page">
            <Settings />
          </div>
        )

      case 'help':
        return (
          <div className="page">
            <HelpPage />
          </div>
        )

      default:
        return null
    }
  }

  return (
    <ErrorBoundary>
      <Layout>
        <ErrorBoundary>
          {renderPage()}
        </ErrorBoundary>
      </Layout>
    </ErrorBoundary>
  )
}

export default App
