import React from 'react'

export function NoiseSuppressionNotice({ message, warning }: { message: string | null; warning: boolean }) {
  if (!message) return null
  return <p role="status" aria-live="polite"
    className={`mx-1 mb-1.5 px-2 py-1.5 rounded-lg text-[10px] leading-snug ${warning ? 'bg-amber-500/10 text-amber-300' : 'bg-slate-800/60 text-slate-300'}`}>
    {message}
  </p>
}
