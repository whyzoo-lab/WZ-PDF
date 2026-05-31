import { Component, type ErrorInfo, type ReactNode } from 'react'
import { t } from '../i18n'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Catches render/runtime errors in the subtree (e.g. a Konva/pdfjs crash) so
 * one bad page doesn't blank the entire app. Shows a recoverable fallback
 * with a reload action. Class component because error boundaries have no
 * hooks equivalent.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-gray-900 p-8 text-center text-gray-200">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-12 w-12 text-red-400">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
        <h2 className="text-lg font-semibold">{t('errorBoundary.title')}</h2>
        <p className="max-w-sm text-sm text-gray-400">{t('errorBoundary.body')}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
        >
          {t('errorBoundary.reload')}
        </button>
      </div>
    )
  }
}
