import { Component, ErrorInfo, ReactNode } from 'react'
import '../styles/ErrorBoundary.css'

interface Props {
  children: ReactNode
  /** Optional fallback UI. If omitted, the default error card is shown. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

/**
 * React Error Boundary — catches render errors in the subtree and shows
 * a friendly fallback UI instead of a blank white screen.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <SomeComponent />
 *   </ErrorBoundary>
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Caught render error:', error, info.componentStack)
  }

  reset = () => {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    const { children, fallback } = this.props

    if (error) {
      if (fallback) return fallback(error, this.reset)

      return (
        <div className="eb-container">
          <div className="eb-card">
            <div className="eb-icon">⚠️</div>
            <h2 className="eb-title">Something went wrong</h2>
            <p className="eb-message">{error.message}</p>
            <details className="eb-details">
              <summary>Stack trace</summary>
              <pre className="eb-stack">{error.stack}</pre>
            </details>
            <button className="eb-reset-btn" onClick={this.reset}>
              🔄 Try Again
            </button>
          </div>
        </div>
      )
    }

    return children
  }
}
