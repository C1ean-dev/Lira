import React, { useState, useRef, useMemo } from 'react'
import {
  Users,
  Maximize2,
  Plus,
  Minus,
  Sparkles,
  MapPin,
  Compass,
  Monitor,
  Zap,
  Lock,
  Crown,
  Shield,
} from 'lucide-react'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useMediaStore } from '../store/useMediaStore'
import { MediaManager } from '../media/MediaManager'
import { PeerManager } from '../p2p/PeerManager'
import { PrivateZone } from '../types/map'
import { Player } from '../types/game'
import { knockOnLockedDoor } from '../utils/doorKnockHelper'

export const SimplifiedMapView: React.FC = () => {
  const { localPlayer, remotePlayers, setLocalPlayer } = useGameStore()
  const { mapData } = useMapStore()

  const [zoom, setZoom] = useState(1.0)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef({ x: 0, y: 0 })

  // Map dimensions from real space data
  const mapWidth = Math.max(20, mapData.width || 70)
  const mapHeight = Math.max(15, mapData.height || 45)

  // Real user-created zones ONLY
  const zones: PrivateZone[] = useMemo(() => {
    return mapData.zones || []
  }, [mapData.zones])

  // Get zone icon based on name
  const getZoneIcon = (name: string) => {
    const n = name.toLowerCase()
    if (n.includes('team') || n.includes('reuni') || n.includes('central')) return '👥'
    if (n.includes('sof') || n.includes('lounge') || n.includes('descans')) return '🛋️'
    if (n.includes('caf') || n.includes('coffee') || n.includes('lanche')) return '☕'
    if (n.includes('foco') || n.includes('dev') || n.includes('trabalh')) return '💻'
    if (n.includes('execut') || n.includes('diretor')) return '📊'
    return '🚪'
  }

  // Handle clicking on a room/zone to move into it
  const handleRoomClick = (zone: PrivateZone, e: React.MouseEvent) => {
    e.stopPropagation()

    if (zone.isLocked && !useMapStore.getState().isPeerAuthorizedForZone(zone.id, localPlayer.id, localPlayer.name)) {
      knockOnLockedDoor(zone)
      return
    }

    const targetX = Math.floor(zone.x + zone.width / 2)
    const targetY = Math.floor(zone.y + zone.height / 2)

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
    })

    PeerManager.getInstance().sendPlayerUpdate({
      x: targetX,
      y: targetY,
      currentZoneId: zone.id,
    })

    useMapStore.getState().checkAndUnlockEmptyZones()
  }

  // Click on Corredor Geral floor to move freely
  const handleFloorClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = (e.clientX - rect.left) / rect.width
    const clickY = (e.clientY - rect.top) / rect.height

    const targetX = Math.max(1, Math.min(mapWidth - 1, Math.floor(clickX * mapWidth)))
    const targetY = Math.max(1, Math.min(mapHeight - 1, Math.floor(clickY * mapHeight)))

    // Detect if clicked inside an existing zone
    const targetZone = zones.find(
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

    const newZoneId = targetZone ? targetZone.id : null
    const prevZoneId = localPlayer.currentZoneId

    // If leaving a private zone into general corridor, close screen share and media
    if (prevZoneId && prevZoneId !== newZoneId) {
      if (useMediaStore.getState().isScreenSharing) {
        MediaManager.getInstance().stopScreenShare()
      }
      useMediaStore.getState().setGridCallOpen(false)
      PeerManager.getInstance().endAllZoneMediaCalls()
    }

    setLocalPlayer({
      x: targetX,
      y: targetY,
      currentZoneId: newZoneId,
    })

    PeerManager.getInstance().sendPlayerUpdate({
      x: targetX,
      y: targetY,
      currentZoneId: newZoneId,
    })

    useMapStore.getState().checkAndUnlockEmptyZones()
  }

  // Mouse pan handlers
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

  const allRemotePlayers: Player[] = Object.values(remotePlayers)

  return (
    <div
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
      className="relative flex-1 w-full h-[calc(100vh-56px)] overflow-hidden bg-[#072427] cursor-crosshair select-none flex items-center justify-center"
      style={{
        backgroundImage: `radial-gradient(circle at 50% 50%, #0d383c 0%, #061c1f 100%)`,
      }}
    >
      {/* Top Banner Indicator */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#0c2428]/90 backdrop-blur-md border border-[#1a4a4f] text-teal-200 px-4 py-1.5 rounded-full shadow-lg flex items-center gap-2 text-xs font-semibold pointer-events-none z-20">
        <Zap className="w-3.5 h-3.5 text-emerald-400" />
        <span>Modo Simplificado (Baixo Consumo)</span>
        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.2 rounded-full border border-emerald-500/30">
          60 FPS
        </span>
      </div>

      {/* Schematic Map Stage (Corredor Geral Area) */}
      <div
        onClick={handleFloorClick}
        className="relative transition-transform duration-75 rounded-3xl bg-[#0e2a2e]/60 border border-[#194c52]/70 shadow-2xl overflow-hidden"
        style={{
          width: '860px',
          height: `${Math.round(860 * (mapHeight / mapWidth))}px`,
          maxHeight: '78vh',
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
      >
        {/* Architectural Floor Grid (Corredor Geral Blueprint) */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(to right, rgba(25, 80, 88, 0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(25, 80, 88, 0.18) 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />

        {/* Corredor Geral Label Watermark */}
        <div className="absolute top-3 left-3 text-[11px] font-bold text-teal-400/50 uppercase tracking-widest pointer-events-none flex items-center gap-1.5">
          <span>🏢 Corredor Geral ({mapWidth}x{mapHeight})</span>
        </div>

        {/* User-Created Rooms / Zones Only */}
        {zones.map((zone) => {
          const leftPercent = (zone.x / mapWidth) * 100
          const topPercent = (zone.y / mapHeight) * 100
          const widthPercent = (zone.width / mapWidth) * 100
          const heightPercent = (zone.height / mapHeight) * 100

          const isLocalInside = localPlayer.currentZoneId === zone.id
          const isAuthorized = !zone.isLocked || useMapStore.getState().isPeerAuthorizedForZone(zone.id, localPlayer.id, localPlayer.name)
          const playersInZone = allRemotePlayers.filter((p) => p.currentZoneId === zone.id)
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
              className={`absolute rounded-xl transition-all duration-200 cursor-pointer flex flex-col items-center justify-between p-2.5 group shadow-lg ${
                isLocalInside
                  ? 'bg-[#182030] border-2 border-emerald-400 shadow-emerald-500/20 ring-4 ring-emerald-500/10 z-10'
                  : zone.isLocked && !isAuthorized
                  ? 'bg-[#1a141b]/92 hover:bg-[#251722] border border-rose-500/30 hover:border-rose-400/60'
                  : 'bg-[#131926]/92 hover:bg-[#182030] border border-[#2b3548] hover:border-indigo-400/50'
              }`}
              style={{
                left: `${leftPercent}%`,
                top: `${topPercent}%`,
                width: `${widthPercent}%`,
                height: `${heightPercent}%`,
              }}
            >
              {/* Room Badge Header */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0d121c]/80 border border-[#232c3d] text-slate-200 text-xs font-bold shadow-sm pointer-events-none max-w-[90%] truncate">
                {zone.isLocked ? (
                  <Lock className="w-3 h-3 text-rose-400 shrink-0" />
                ) : (
                  <span>{getZoneIcon(zone.name)}</span>
                )}
                <span className="truncate">{zone.name}</span>
                {zone.isLocked && !isAuthorized && (
                  <span className="text-[9px] bg-rose-500/20 text-rose-300 px-1.5 py-0.2 rounded-full border border-rose-500/30 font-semibold">
                    Bater
                  </span>
                )}
                {zone.admins && zone.admins.includes(localPlayer.name) && (
                  <Crown className="w-3 h-3 text-amber-400 shrink-0" />
                )}
                {totalInZone > 0 && (
                  <span className="ml-1 text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.2 rounded-full border border-indigo-500/30 font-semibold">
                    {totalInZone}
                  </span>
                )}
              </div>

              {/* Avatars inside this Room */}
              <div className="flex items-center gap-2 mt-auto flex-wrap justify-center pointer-events-none pb-1">
                {/* Local Player Speech Bubble & Avatar if inside */}
                {isLocalInside && (
                  <div className="flex flex-col items-center animate-in zoom-in-90 duration-150">
                    <div className="flex items-center gap-1.5 bg-[#5b50e6] text-white px-2 py-0.5 rounded-lg shadow-md border border-[#7268f2] text-[11px] font-bold">
                      <div className="w-3.5 h-3.5 rounded-full bg-white/20 flex items-center justify-center text-[8px]">
                        {localPlayer.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span className="truncate max-w-[80px]">{localPlayer.name}</span>
                    </div>
                    <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-[#5b50e6]" />
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs text-white border-2 border-white shadow-md mt-0.5"
                      style={{ backgroundColor: localPlayer.avatar?.shirtColor || '#4c6ef5' }}
                    >
                      {localPlayer.name.charAt(0).toUpperCase()}
                    </div>
                  </div>
                )}

                {/* Remote Players inside this Room */}
                {playersInZone.map((remote) => (
                  <div key={remote.id} className="flex flex-col items-center">
                    <div className="flex items-center gap-1 bg-[#1e2738] text-slate-200 px-1.5 py-0.5 rounded-lg border border-[#324058] text-[10px] font-medium shadow-sm">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      <span className="truncate max-w-[70px]">{remote.name}</span>
                    </div>
                    <div className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[3px] border-t-[#1e2738]" />
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[10px] text-white border border-white/40 shadow-sm mt-0.5"
                      style={{ backgroundColor: remote.avatar?.shirtColor || '#ec4899' }}
                    >
                      {remote.name.charAt(0).toUpperCase()}
                    </div>
                  </div>
                ))}
              </div>

              {/* Active Room Badge */}
              {isLocalInside && (
                <div className="absolute -top-2.5 -right-2.5 bg-emerald-500 text-slate-950 font-extrabold text-[9px] px-2 py-0.5 rounded-full shadow-lg border border-emerald-300 flex items-center gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-950 animate-ping" />
                  <span>Sua Sala</span>
                </div>
              )}

              {/* Room Entrance Door Threshold Marker */}
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1/3 max-w-[48px] h-1.5 bg-[#1c1917] border-t border-indigo-400/50 rounded-t-sm flex items-center justify-center pointer-events-none shadow-sm">
                <div className="w-2.5 h-0.5 bg-amber-400/70 rounded-full" />
              </div>
            </div>
          )
        })}

        {/* Local Player Marker in Corredor Geral (Outside any zone) */}
        {!localPlayer.currentZoneId && (
          <div
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-30 transition-all duration-100"
            style={{
              left: `${(localPlayer.x / mapWidth) * 100}%`,
              top: `${(localPlayer.y / mapHeight) * 100}%`,
            }}
          >
            {/* Speech Bubble Tag */}
            <div className="flex items-center gap-1.5 bg-[#5b50e6] text-white px-2.5 py-1 rounded-xl shadow-xl border border-[#7268f2] text-xs font-bold">
              <div className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[9px]">
                {localPlayer.name.charAt(0).toUpperCase()}
              </div>
              <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-sm" />
              <span className="truncate max-w-[90px]">{localPlayer.name}</span>
            </div>
            {/* Pointer Tail */}
            <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-[#5b50e6]" />
            {/* Avatar Circle */}
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white border-2 border-white shadow-lg mt-0.5 ring-4 ring-[#5b50e6]/30"
              style={{ backgroundColor: localPlayer.avatar?.shirtColor || '#4c6ef5' }}
            >
              {localPlayer.name.charAt(0).toUpperCase()}
            </div>
          </div>
        )}

        {/* Remote Players Markers in Corredor Geral */}
        {allRemotePlayers
          .filter((p) => !p.currentZoneId)
          .map((remote) => (
            <div
              key={remote.id}
              className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none z-20 transition-all duration-100"
              style={{
                left: `${(remote.x / mapWidth) * 100}%`,
                top: `${(remote.y / mapHeight) * 100}%`,
              }}
            >
              <div className="flex items-center gap-1 bg-[#1e2738] text-slate-200 px-2 py-0.5 rounded-lg border border-[#324058] text-[10px] font-semibold shadow-md">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="truncate max-w-[70px]">{remote.name}</span>
              </div>
              <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-[#1e2738]" />
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs text-white border border-white/40 shadow-md mt-0.5"
                style={{ backgroundColor: remote.avatar?.shirtColor || '#ec4899' }}
              >
                {remote.name.charAt(0).toUpperCase()}
              </div>
            </div>
          ))}
      </div>
    </div>
  )
}
