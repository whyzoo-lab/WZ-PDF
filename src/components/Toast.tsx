// src/components/Toast.tsx
import { useEffect } from 'react'

export interface ToastProps {
  message: string
  /** Auto-dismiss delay in ms (default 2500) */
  duration?: number
  onDismiss: () => void
}

/**
 * Lightweight bottom-center toast. Auto-dismisses after `duration` ms.
 * Caller is responsible for owning the message state and clearing it.
 */
export function Toast({ message, duration = 2500, onDismiss }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, duration)
    return () => clearTimeout(t)
  }, [message, duration, onDismiss])

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999]
                 bg-gray-800 text-white text-sm px-4 py-2.5 rounded-lg shadow-xl
                 border border-gray-700 flex items-center gap-2 pointer-events-none
                 animate-[fadeIn_.15s_ease-out]"
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-emerald-400">
        <path d="M5 10l3 3 7-7" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <span>{message}</span>
    </div>
  )
}
