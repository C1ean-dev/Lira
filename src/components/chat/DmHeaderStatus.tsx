import React from 'react'
import { ChatPerson, getChatPersonStatusDisplay } from '../../utils/chatPeople'
import { MoonPhaseIcon } from '../common/MoonPhaseIcon'

interface Props {
  person: ChatPerson | null
  fallbackName: string
}

export const DmHeaderStatus: React.FC<Props> = ({ person, fallbackName }) => {
  const display = getChatPersonStatusDisplay(person, fallbackName)

  if (!display.isOnline) {
    return (
      <div
        className="flex items-center gap-1.5 shrink-0 px-2 py-0.5 rounded-[6px] font-mono bg-lira-ground border border-lira-quiet"
        title={display.tooltip}
      >
        <span className="w-1.5 h-1.5 rounded-full border border-lira-muted/70 bg-lira-ground shrink-0" />
        <span className="text-[10px] font-semibold text-lira-muted">Offline</span>
      </div>
    )
  }

  return (
    <div
      className={`flex items-center gap-1.5 min-w-0 max-w-[65%] px-2 py-0.5 rounded-[6px] font-mono border ${display.pillClass}`}
      title={display.tooltip}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-lira-online shadow-[0_0_6px_rgb(var(--online-rgb)/0.9)] shrink-0" />
      <span className="text-[10px] font-bold text-lira-online shrink-0">Online</span>
      <span className="text-[10px] text-lira-muted/70 shrink-0">•</span>
      <MoonPhaseIcon status={display.statusKey} className="w-3 h-3 shrink-0" />
      <span className={`text-[10px] font-medium truncate ${display.textClass}`}>
        {display.statusLabel}
      </span>
    </div>
  )
}
