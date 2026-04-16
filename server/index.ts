import 'dotenv/config'
import { buildApp } from './app.js'

const PORT = process.env.PORT || 3000

const app = await buildApp()

app.listen(PORT, () => {
  console.log(`✓ Server listening on http://localhost:${PORT}`)
  console.log(`  NODE_ENV: ${process.env.NODE_ENV ?? 'development'}`)
})
