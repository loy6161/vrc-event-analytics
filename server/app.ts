import express from 'express'
import { initializeDatabase } from './db/schema.js'
import eventsRouter from './routes/events.js'
import logsRouter from './routes/logs.js'
import analyticsRouter from './routes/analytics.js'
import usersRouter from './routes/users.js'
import youtubeRouter from './routes/youtube.js'
import exportRouter from './routes/export.js'
import watcherRouter from './routes/watcher.js'
import { toMessage } from './utils/response.js'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function buildApp() {
  const app = express()

  // ── Body parsers ────────────────────────────────────────────────
  app.use(express.json({ limit: '50mb' }))
  app.use(express.urlencoded({ extended: true }))

  // ── CORS ────────────────────────────────────────────────────────
  app.use((req: express.Request, res: express.Response, next: express.NextFunction): void => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept')
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.sendStatus(200)
      return
    }
    next()
  })

  // ── Database initialization ──────────────────────────────────────
  let dbAvailable = true
  try {
    await initializeDatabase()
    console.log('✓ Database initialized (Turso)')
  } catch (_error) {
    console.warn('⚠ Database initialization failed:', _error)
    dbAvailable = false
  }

  // Health check
  app.get('/api/health', (_req: express.Request, res: express.Response): void => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), dbAvailable })
  })

  // Database availability middleware
  const requireDatabase = (_req: express.Request, res: express.Response, next: express.NextFunction): void => {
    if (!dbAvailable) {
      res.status(503).json({
        success: false,
        error: 'Database unavailable — initialization failed. Check server logs.',
        timestamp: new Date().toISOString(),
      })
      return
    }
    next()
  }

  // ── Routes ──────────────────────────────────────────────────────
  app.use('/api/events', requireDatabase, eventsRouter)
  app.use('/api/logs', requireDatabase, logsRouter)
  app.use('/api/analytics', requireDatabase, analyticsRouter)
  app.use('/api/users', requireDatabase, usersRouter)
  app.use('/api/export', requireDatabase, exportRouter)
  app.use('/api/watcher', requireDatabase, watcherRouter)
  app.use('/api/youtube', requireDatabase, youtubeRouter)

  // ── Static files (local production only) ────────────────────────
  // In Vercel, static files are served by the CDN from outputDirectory.
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL !== '1') {
    const distPath = path.join(__dirname, '..', 'dist')
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath))
      app.get('*', (_req: express.Request, res: express.Response): void => {
        res.sendFile(path.join(distPath, 'index.html'))
      })
      console.log(`✓ Serving static files from ${distPath}`)
    }
  }

  // ── Global error handler ─────────────────────────────────────────
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction): void => {
    const message = toMessage(err)
    console.error(`[${new Date().toISOString()}] Unhandled error:`, err)
    res.status(500).json({
      success: false,
      error: message,
      timestamp: new Date().toISOString(),
      ...(process.env.NODE_ENV === 'development' && err instanceof Error ? { stack: err.stack } : {}),
    })
  })

  return app
}
