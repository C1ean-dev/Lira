import React from 'react'
import { PresenceStatus, STATUS_META } from '../../types/game'
import { MoonPhaseIcon } from './MoonPhaseIcon'

export interface StatusBadgeProps {
  status: PresenceStatus | 'offline' | string
  /** Status text to show; defaults to the status name. */
  label?: string
  className?: string
}

const TONE: Record<string, string> = {
  busy: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  focusing: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  away: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  available: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  offline: 'bg-slate-800 text-slate-400 border-slate-700',
}

/** Presence pill: the status image (not a colored dot) followed by the status text. */
export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, className = '' }) => {
  const isOffline = status === 'offline'
  const meta = STATUS_META[status as PresenceStatus]
  const tone = TONE[isOffline || !meta ? (isOffline ? 'offline' : 'available') : status]
  const text = label || (isOffline ? 'Offline' : (meta || STATUS_META.available).label)

  return (
    <span
      className={`text-[9px] pl-1 pr-2 py-0.5 rounded-full font-bold border flex items-center gap-1 ${tone} ${className}`}
    >
      <MoonPhaseIcon status={status} className="w-3 h-3" />
      <span>{text}</span>
    </span>
  )
}
