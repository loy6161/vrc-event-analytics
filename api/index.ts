import { buildApp } from '../server/app.js'

// Build and export the Express app for Vercel serverless.
// Top-level await is supported in Node 18+ ESM (Vercel default runtime).
const app = await buildApp()

export default app
