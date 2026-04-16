import { Router, Request, Response } from 'express'

const router = Router()

// File watching is not supported in serverless/cloud deployments.
// These endpoints return a disabled status so the frontend degrades gracefully.

const CLOUD_STATUS = {
  watching: false,
  directory: null,
  cloudMode: true,
  message: 'File watching is not available in cloud mode. Use the log upload feature instead.',
}

router.get('/status', (_req: Request, res: Response) => {
  res.json({ success: true, data: CLOUD_STATUS, timestamp: new Date().toISOString() })
})

router.post('/start', (_req: Request, res: Response) => {
  res.status(400).json({
    success: false,
    error: CLOUD_STATUS.message,
    data: CLOUD_STATUS,
    timestamp: new Date().toISOString(),
  })
})

router.post('/stop', (_req: Request, res: Response) => {
  res.json({ success: true, data: CLOUD_STATUS, timestamp: new Date().toISOString() })
})

/**
 * GET /api/watcher/events
 * SSE stub — sends one heartbeat then keeps the connection open.
 * No real events are emitted in cloud mode.
 */
router.get('/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')

  res.write(`data: ${JSON.stringify({
    type: 'watcher:heartbeat',
    timestamp: new Date().toISOString(),
    data: { status: CLOUD_STATUS },
  })}\n\n`)

  req.on('close', () => {
    // nothing to clean up
  })
})

export default router
