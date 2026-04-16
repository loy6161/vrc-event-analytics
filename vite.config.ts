import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Forward /api/* to the Express server as-is — no path rewriting.
      // The backend registers routes at /api/events, /api/analytics, etc.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: 'esbuild',
    rollupOptions: {
      output: {
        // Split large vendor chunks for better browser caching
        manualChunks: {
          'vendor-react':  ['react', 'react-dom'],
          'vendor-charts': ['recharts'],
          'vendor-table':  ['@tanstack/react-table'],
        }
      }
    }
  }
})
