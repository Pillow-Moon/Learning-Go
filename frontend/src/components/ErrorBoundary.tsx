/**
 * React 错误边界：捕获子组件渲染错误，展示降级 UI。
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="coming-soon">
          <h1>出了点问题</h1>
          {this.state.error?.message && (
            <p style={{ color: 'var(--danger)' }}>{this.state.error.message}</p>
          )}
          <Link to="/" className="btn primary">
            返回首页
          </Link>
        </div>
      )
    }

    return this.props.children
  }
}
