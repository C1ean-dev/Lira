import React from 'react'

export function NoiseSuppressionNotice({ message, warning }: { message: string | null; warning: boolean }) {
  if (!message) return null
  return (
    <p
      role="status"
      aria-live="polite"
      className={`mx-1 mb-1.5 px-2.5 py-1.5 rounded-[8px] font-mono text-[10px] leading-snug border ${
        warning
          ? 'bg-lira-amber/15 text-lira-amber border-lira-amber/40'
          : 'bg-lira-surface text-lira-muted border-lira-quiet'
      }`}
    >
      {message}
    </p>
  )
}
