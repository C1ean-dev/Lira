import React from 'react'
import { PresenceStatus, STATUS_META } from '../../types/game'
import { MoonPhaseIcon } from './MoonPhaseIcon'

export interface StatusBadgeProps {
  status: PresenceStatus | 'offline' | string
  label?: string
  className?: string
}

const TONE: Record<string, string> = {
  busy: 'bg-lira-error/15 text-lira-error border-lira-error/40',
  focusing: 'bg-lira-accent/15 text-lira-accent border-lira-accent/40',
  away: 'bg-lira-amber/15 text-lira-amber border-lira-amber/40',
  available: 'bg-lira-online/15 text-lira-online border-lira-online/40',
  offline: 'bg-slate-800 bg-lira-ground text-lira-muted border-lira-quiet',
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, className = '' }) => {
  const isOffline = status === 'offline'
  const meta = STATUS_META[status as PresenceStatus]
  const tone = TONE[isOffline || !meta ? (isOffline ? 'offline' : 'available') : status]
  const text = label || (isOffline ? 'Offline' : (meta || STATUS_META.available).label)

  return (
    <span
      className={`text-[10px] font-mono pl-1 pr-2 py-0.5 rounded-[6px] font-bold border flex items-center gap-1 ${tone} ${className}`}
    >
      <MoonPhaseIcon status={status} className="w-3 h-3" />
      <span>{text}</span>
    </span>
  )
}
