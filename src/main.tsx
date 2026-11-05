import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installWriteAuthFetch } from './utils/writeAuth'

installWriteAuthFetch()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
