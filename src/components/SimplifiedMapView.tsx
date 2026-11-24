import React, { useState, useRef, useMemo } from 'react'
import { Zap, Lock, Crown } from 'lucide-react'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useMediaStore } from '../store/useMediaStore'
import { MediaManager } from '../media/MediaManager'
import { PeerManager } from '../p2p/PeerManager'
import { PrivateZone } from '../types/map'
import { Player } from '../types/game'
import { knockOnLockedDoor } from '../utils/doorKnockHelper'
import { useSimplifiedMapSnapshot } from '../hooks/useSimplifiedMapSnapshot'
import { findSafePlayerPosition } from '../engine/physics/safePlayerPosition'

export const SimplifiedMapView = React.memo(function SimplifiedMapView() {
  const { localPlayer, remotePlayers, width, height, zones } = useSimplifiedMapSnapshot()

  const [zoom, setZoom] = useState(1.0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef({ x: 0, y: 0 })

  const mapWidth = Math.max(20, width || 70)
  const mapHeight = Math.max(15, height || 45)

  const getZoneIcon = (name: string) => {
    const n = name.toLowerCase()
    if (n.includes('team') || n.includes('reuni') || n.includes('central')) return '👥'
    if (n.includes('sof') || n.includes('lounge') || n.includes('descans')) return '🛋️'
    if (n.includes('caf') || n.includes('coffee') || n.includes('lanche')) return '☕'
    if (n.includes('foco') || n.includes('dev') || n.includes('trabalh')) return '💻'
    if (n.includes('execut') || n.includes('diretor')) return '📊'
    return '🚪'
  }

  const handleRoomClick = (displayedZone: PrivateZone, e: React.MouseEvent) => {
    e.stopPropagation()

    const zone = useMapStore.getState().mapData.zones?.find(z => z.id === displayedZone.id)
    if (!zone) return
    const { localPlayer, setLocalPlayer } = useGameStore.getState()
    if (zone.isLocked && !useMapStore.getState().isPeerAuthorizedForZone(zone.id, localPlayer.id, localPlayer.name)) {
      knockOnLockedDoor(zone)
      return
    }

    const destination = findSafePlayerPosition(
      Math.floor(zone.x + zone.width / 2), Math.floor(zone.y + zone.height / 2),
      useMapStore.getState().mapData, zone.id
    )
    if (!destination) return
    const { x: targetX, y: targetY } = destination

    const prevZoneId = localPlayer.currentZoneId
    if (prevZoneId && prevZoneId !== zone.id) {
      if (useMediaStore.getState().isScreenSharing) {
        MediaManager.getInstance().stopScreenShare()
      }
      useMediaStore.getState().setGridCallOpen(false)
      PeerManager.getInstance().endAllZoneMediaCalls()
    }

    setLocalPlayer({
      x: targetX,
      y: targetY,
      currentZoneId: zone.id,
      isMoving: false,
      seatedOn: null,
    })

    PeerManager.getInstance().sendPlayerUpdate({
      x: targetX,
      y: targetY,
      currentZoneId: zone.id,
      isMoving: false,
      seatedOn: null,
    })

    useMapStore.getState().checkAndUnlockEmptyZones()
  }

  const handleFloorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const { localPlayer, setLocalPlayer } = useGameStore.getState()
    const { mapData } = useMapStore.getState()
    const mapWidth = Math.max(20, mapData.width || 70)
    const mapHeight = Math.max(15, mapData.height || 45)
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = (e.clientX - rect.left) / rect.width
    const clickY = (e.clientY - rect.top) / rect.height

    const targetX = Math.max(1, Math.min(mapWidth - 1, Math.floor(clickX * mapWidth)))
    const targetY = Math.max(1, Math.min(mapHeight - 1, Math.floor(clickY * mapHeight)))

    const targetZone = mapData.zones?.find(
      (z) =>
        targetX >= z.x &&
        targetX < z.x + z.width &&
        targetY >= z.y &&
        targetY < z.y + z.height
    )

    if (targetZone && targetZone.isLocked && !useMapStore.getState().isPeerAuthorizedForZone(targetZone.id, localPlayer.id, localPlayer.name)) {
      knockOnLockedDoor(targetZone)
      return
    }

    const destination = findSafePlayerPosition(targetX, targetY, mapData, targetZone?.id ?? null)
    if (!destination) return
    const newZoneId = destination.currentZoneId
    const prevZoneId = localPlayer.currentZoneId

    if (prevZoneId && prevZoneId !== newZoneId) {
      if (useMediaStore.getState().isScreenSharing) {
        MediaManager.getInstance().stopScreenShare()
      }
      useMediaStore.getState().setGridCallOpen(false)
      PeerManager.getInstance().endAllZoneMediaCalls()
    }

    setLocalPlayer({
      x: destination.x,
      y: destination.y,
      currentZoneId: newZoneId,
      isMoving: false,
      seatedOn: null,
    })

    PeerManager.getInstance().sendPlayerUpdate({
      x: destination.x,
      y: destination.y,
      currentZoneId: newZoneId,
      isMoving: false,
      seatedOn: null,
    })

    useMapStore.getState().checkAndUnlockEmptyZones()
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && e.target === e.currentTarget) {
      setIsPanning(true)
      panStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y }
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      })
    }
  }

  const handleMouseUp = () => {
    setIsPanning(false)
  }

  const handleWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY < 0 ? 0.1 : -0.1
    setZoom((prev) => Math.max(0.6, Math.min(2.2, Number((prev + delta).toFixed(2)))))
  }

  const playersByZone = useMemo(() => {
    const grouped = new Map<string | null, Player[]>()
    for (const player of Object.values(remotePlayers)) {
      if (player.isDjBot || player.id.startsWith('dj-')) continue
      const zoneId = player.currentZoneId || null
      const players = grouped.get(zoneId)
      if (players) players.push(player)
      else grouped.set(zoneId, [player])
    }
    return grouped
  }, [remotePlayers])

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      className="relative flex-1 w-full h-full overflow-hidden bg-lira-ground cursor-crosshair select-none flex items-center justify-center font-mono"
    >
      <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-lira-panel border border-dashed border-lira-rule text-lira-ink px-4 py-1.5 rounded-[8px] flex items-center gap-2 text-xs font-semibold pointer-events-none z-20">
        <Zap className="w-3.5 h-3.5 text-lira-online" />
        <span>Modo Simplificado (Baixo Consumo)</span>
        <span className="text-[10px] bg-lira-online/15 text-lira-online px-2 py-0.2 rounded-[4px] border border-lira-online/40">
          Baixo consumo
        </span>
      </div>

      <div
        onClick={handleFloorClick}
        className="relative rounded-3xl bg-[#0e2a2e]/60 border border-[#194c52]/70 overflow-hidden"
        style={{
          width: '860px',
          height: `${Math.round(860 * (mapHeight / mapWidth))}px`,
          maxHeight: '78vh',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(to right, rgba(130, 105, 152, 0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(130, 105, 152, 0.16) 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />

        <div className="absolute top-3 left-3 text-[11px] font-bold text-lira-muted uppercase tracking-widest pointer-events-none flex items-center gap-1.5">
          <span>🏢 Corredor Geral ({mapWidth}x{mapHeight})</span>
        </div>

        {zones?.map((zone) => {
          const leftPercent = (zone.x / mapWidth) * 100
          const topPercent = (zone.y / mapHeight) * 100
          const widthPercent = (zone.width / mapWidth) * 100
          const heightPercent = (zone.height / mapHeight) * 100

          const isLocalInside = localPlayer.currentZoneId === zone.id
          const isAuthorized = !zone.isLocked || useMapStore.getState().isPeerAuthorizedForZone(zone.id, localPlayer.id, localPlayer.name)
          const playersInZone = playersByZone.get(zone.id) || []
          const totalInZone = playersInZone.length + (isLocalInside ? 1 : 0)

          return (
            <div
              key={zone.id}
              onClick={(e) => handleRoomClick(zone, e)}
              title={
                zone.isLocked && !isAuthorized
                  ? `${zone.name} (Trancada - Clique para bater na porta)`
                  : `${zone.name} - Clique para entrar`
              }
              className={`absolute rounded-[12px] cursor-pointer flex flex-col items-center justify-between p-2.5 group ${
                isLocalInside
                  ? 'bg-lira-surface border-2 border-lira-online z-10'
                  : zone.isLocked && !isAuthorized
                  ? 'bg-lira-panel hover:bg-lira-surface border border-dashed border-lira-error/50 hover:border-lira-error'
                  : 'bg-lira-panel hover:bg-lira-surface border border-dashed border-lira-rule/70 hover:border-lira-accent'
              }`}
              style={{
                left: `${leftPercent}%`,
                top: `${topPercent}%`,
                width: `${widthPercent}%`,
                height: `${heightPercent}%`,
              }}
            >
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] bg-lira-ground border border-lira-quiet text-lira-ink text-xs font-display font-bold pointer-events-none max-w-[90%] truncate">
                {zone.isLocked ? (
                  <Lock className="w-3 h-3 text-lira-error shrink-0" />
                ) : (
                  <span>{getZoneIcon(zone.name)}</span>
                )}
                <span className="truncate">{zone.name}</span>
                {zone.isLocked && !isAuthorized && (
                  <span className="text-[9px] font-mono bg-lira-error/15 text-lira-error px-1.5 py-0.2 rounded-[4px] border border-lira-error/40 font-semibold">
                    Bater
                  </span>
                )}
                {zone.admins && zone.admins.includes(localPlayer.name) && (
                  <Crown className="w-3 h-3 text-lira-amber shrink-0" />
                )}
                {totalInZone > 0 && (
                  <span className="ml-1 text-[10px] font-mono bg-lira-surface text-lira-accent px-1.5 py-0.2 rounded-[4px] border border-lira-rule font-semibold">
                    {totalInZone}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 mt-auto flex-wrap justify-center pointer-events-none pb-1">
                {isLocalInside && (
                  <div className="flex flex-col items-center">
                    <div className="flex items-center gap-1.5 bg-lira-accent text-lira-ground px-2 py-0.5 rounded-[6px] border border-lira-accent text-[11px] font-bold">
                      <div className="w-3.5 h-3.5 rounded-[4px] bg-lira-ground/20 flex items-center justify-center text-[8px]">
                        {localPlayer.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="w-1.5 h-1.5 rounded-full bg-lira-online" />
                      <span className="truncate max-w-[80px]">{localPlayer.name}</span>
                    </div>
                    <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-lira-accent" />
                    <div
                      className="w-7 h-7 rounded-[6px] flex items-center justify-center font-bold text-xs text-white border border-lira-ink mt-0.5"
                      style={{ backgroundColor: localPlayer.avatar?.shirtColor || '#4c6ef5' }}
                    >
                      {localPlayer.name.charAt(0).toUpperCase()}
                    </div>
                  </div>
                )}

                {playersInZone.map((remote) => (
                  <div key={remote.id} className="flex flex-col items-center">
                    <div className="flex items-center gap-1 bg-lira-surface text-lira-ink px-1.5 py-0.5 rounded-[6px] border border-lira-rule text-[10px] font-medium">
                      <div className="w-1.5 h-1.5 rounded-full bg-lira-online" />
                      <span className="truncate max-w-[70px]">{remote.name}</span>
                    </div>
                    <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[3px] border-t-lira-surface" />
                    <div
                      className="w-6 h-6 rounded-[6px] flex items-center justify-center font-bold text-[10px] text-white border border-lira-rule mt-0.5"
                      style={{ backgroundColor: remote.avatar?.shirtColor || '#ec4899' }}
                    >
                      {remote.name.charAt(0).toUpperCase()}
                    </div>
                  </div>
                ))}
              </div>

              {isLocalInside && (
                <div className="absolute -top-2.5 -right-2.5 bg-lira-online text-lira-ground font-extrabold text-[9px] px-2 py-0.5 rounded-[6px] border border-lira-online flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-lira-ground" />
                  <span>Sua Sala</span>
                </div>
              )}

              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1/3 max-w-[48px] h-1.5 bg-lira-ground border-t border-lira-rule rounded-t-sm flex items-center justify-center pointer-events-none">
                <div className="w-2.5 h-0.5 bg-lira-amber rounded-full" />
              </div>
            </div>
          )
        })}

        {!localPlayer.currentZoneId && (
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-30"
            style={{
              left: `${(localPlayer.x / mapWidth) * 100}%`,
              top: `${(localPlayer.y / mapHeight) * 100}%`,
            }}
          >
            <div className="flex items-center gap-1.5 bg-lira-accent text-lira-ground px-2.5 py-1 rounded-[8px] border border-lira-accent text-xs font-bold">
              <div className="w-4 h-4 rounded-[4px] bg-lira-ground/20 flex items-center justify-center text-[9px]">
                {localPlayer.name.charAt(0).toUpperCase()}
              </div>
              <div className="w-2 h-2 rounded-full bg-lira-online" />
              <span className="truncate max-w-[90px]">{localPlayer.name}</span>
            </div>
            <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-lira-accent" />
            <div
              className="w-8 h-8 rounded-[6px] flex items-center justify-center font-bold text-xs text-white border-2 border-lira-ink mt-0.5"
              style={{ backgroundColor: localPlayer.avatar?.shirtColor || '#4c6ef5' }}
            >
              {localPlayer.name.charAt(0).toUpperCase()}
            </div>
          </div>
        )}

        {(playersByZone.get(null) || [])
          .map((remote) => (
            <div
              key={remote.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-20"
              style={{
                left: `${(remote.x / mapWidth) * 100}%`,
                top: `${(remote.y / mapHeight) * 100}%`,
              }}
            >
              <div className="flex items-center gap-1 bg-lira-surface text-lira-ink px-2 py-0.5 rounded-[6px] border border-lira-rule text-[10px] font-semibold">
                <div className="w-1.5 h-1.5 rounded-full bg-lira-online" />
                <span className="truncate max-w-[70px]">{remote.name}</span>
              </div>
              <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-lira-surface" />
              <div
                className="w-7 h-7 rounded-[6px] flex items-center justify-center font-bold text-xs text-white border border-lira-rule mt-0.5"
                style={{ backgroundColor: remote.avatar?.shirtColor || '#ec4899' }}
              >
                {remote.name.charAt(0).toUpperCase()}
              </div>
            </div>
          ))}
      </div>
    </div>
  )
})
