import React from 'react'
import { Lock, MapPin, Users } from 'lucide-react'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'

export const CurrentLocationPill: React.FC = () => {
  const currentZoneId = useGameStore((s) => s.localPlayer.currentZoneId)
  const zones = useMapStore((s) => s.mapData.zones)
  const currentZone = zones.find((z) => z.id === currentZoneId)
  const name = currentZone ? currentZone.name : 'Corredor Geral'
  const color = currentZone ? currentZone.color : '#6b7280'

  return (
    <div
      role="status"
      aria-label="Local atual"
      title={name}
      className="pointer-events-auto flex min-w-0 max-w-[min(22rem,100%)] items-center gap-2 rounded-full border border-dashed border-lira-rule/80 bg-lira-panel/95 px-3.5 py-1.5 font-mono text-xs font-semibold text-lira-ink shadow-md backdrop-blur-sm select-none"
    >
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {currentZone?.isLocked ? (
        <Lock className="h-3.5 w-3.5 shrink-0 text-lira-amber" aria-hidden="true" />
      ) : currentZone ? (
        <Users className="h-3.5 w-3.5 shrink-0 text-lira-accent" aria-hidden="true" />
      ) : (
        <MapPin className="h-3.5 w-3.5 shrink-0 text-lira-accent" aria-hidden="true" />
      )}
      <span className="min-w-0 truncate">{name}</span>
    </div>
  )
}
