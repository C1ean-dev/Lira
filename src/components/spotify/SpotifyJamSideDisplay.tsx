import React, { useState } from 'react'
import { Minimize2, Volume2, VolumeX, Edit2, Radio, X } from 'lucide-react'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { useMapStore } from '../../store/useMapStore'
import { useLocalPlayerDetails } from '../../hooks/usePlayerDetails'
import { SpotifyIcon } from '../common/SpotifyIcon'
import { MediaManager } from '../../media/MediaManager'
import { SpotifyPlayerFeedback } from './SpotifyPlayerFeedback'
import { SpotifyPlaybackCrop } from './SpotifyPlaybackCrop'
import { openSpotifyBrowserPlayer } from '../../services/openSpotifyPlayer'
import { stopDjForEveryone } from '../../services/stopDjForEveryone'

export const SpotifyJamSideDisplay: React.FC = () => {
  const localPlayer = useLocalPlayerDetails()
  const localZoneId = localPlayer.currentZoneId
  const localPlayerName = localPlayer.name
  const mapZones = useMapStore((s) => s.mapData.zones)
  const djStateByZone = useSpotifyJamStore((s) => s.djStateByZone)
  const isMinimized = useSpotifyJamStore((s) => s.isSideDisplayMinimized)
  const toggleMinimized = useSpotifyJamStore((s) => s.toggleSideDisplayMinimized)
  const setModalOpen = useSpotifyJamStore((s) => s.setModalOpen)
  const volume = useSpotifyJamStore((s) => s.volume)
  const setVolume = useSpotifyJamStore((s) => s.setVolume)
  const isMuted = useSpotifyJamStore((s) => s.isMuted)
  const toggleMute = useSpotifyJamStore((s) => s.toggleMute)
  const isDjModeActive = useSpotifyJamStore((s) => s.isDjModeActive)
  const setDjStateInZone = useSpotifyJamStore((s) => s.setDjStateInZone)

  const [djLoading, setDjLoading] = useState(false)
  const [djError, setDjError] = useState<string | null>(null)
  const [spotifyOpening, setSpotifyOpening] = useState(false)

  if (!localZoneId) return null
  const zoneDjState = djStateByZone[localZoneId]
  const isDjActiveInZone = Boolean(zoneDjState?.isDjActive || isDjModeActive)
  if (!isDjActiveInZone) return null

  const currentZone = mapZones.find((z) => z.id === localZoneId)
  const zoneDisplayName = currentZone?.name || 'Sala Privada'

  const handleStopDj = async () => {
    if (djLoading) return
    setDjError(null)
    setDjLoading(true)
    try {
      if (isDjModeActive) {
        await MediaManager.getInstance().stopDjAudio()
        setDjStateInZone(localZoneId, null, true)
      } else stopDjForEveryone(localZoneId)
    } catch { setDjError('Não foi possível parar a transmissão. Tente novamente.') }
    finally { setDjLoading(false) }
  }

  const handleOpenSpotify = async () => {
    if (spotifyOpening || !isDjModeActive) return
    setDjError(null)
    setSpotifyOpening(true)
    try {
      const api = typeof window !== 'undefined' ? window.electronAPI ?? null : null
      const result = await openSpotifyBrowserPlayer(api)
      if (!result.ok) setDjError(result.error || 'Não foi possível abrir o Spotify. Tente novamente.')
    } finally { setSpotifyOpening(false) }
  }

  const spotifyRestoreButton = isDjModeActive && (
    <button
      type="button"
      onClick={handleOpenSpotify}
      disabled={spotifyOpening}
      aria-busy={spotifyOpening}
      aria-label="Abrir Spotify"
      title="Abrir Spotify"
      className="p-1.5 text-emerald-400 hover:text-emerald-200 hover:bg-emerald-500/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-wait"
    >
      <SpotifyIcon size={16} className="w-4 h-4" aria-hidden="true" />
    </button>
  )
  const stopButton = <button type="button" onClick={handleStopDj} disabled={djLoading}
    aria-label="Encerrar DJ para todos" title="Encerrar DJ para todos"
    className="p-1.5 text-rose-400 hover:text-rose-200 hover:bg-rose-500/10 rounded-lg disabled:opacity-50">
    <X className="w-4 h-4" />
  </button>

  if (isMinimized) {
    return (
      <aside
        aria-label="DJ minimizado"
        className="fixed top-16 right-4 z-[60] animate-in fade-in slide-in-from-right-3 duration-200 select-none"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMinimized}
            className="flex items-center gap-2.5 px-3.5 py-2 bg-[#12151d]/95 hover:bg-[#181d29] border border-emerald-500/40 rounded-2xl shadow-xl shadow-emerald-950/40 backdrop-blur-md group transition-all"
            title={`Expandir painel de música da sala: ${zoneDisplayName}`}
          >
            <div className="relative flex items-center justify-center">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping absolute" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 relative" />
            </div>
            <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <SpotifyIcon size={14} className="w-3.5 h-3.5" />
            </div>
            <div className="text-left pr-1">
              <div className="text-[11px] font-bold text-slate-100 flex items-center gap-1.5 leading-none">
                <span>DJ</span>
                <span className="text-[9px] text-emerald-400 font-mono uppercase">Na Sala</span>
              </div>
              <div className="text-[10px] text-slate-300 truncate max-w-[110px] leading-tight mt-0.5 font-medium">
                {zoneDisplayName}
              </div>
            </div>
            <div className="flex items-end gap-0.5 h-3.5 px-1">
              <span className="w-0.5 bg-emerald-400 rounded-full animate-[pulse_0.7s_ease-in-out_infinite] h-2" />
              <span className="w-0.5 bg-emerald-400 rounded-full animate-[pulse_0.5s_ease-in-out_infinite] h-3.5" />
              <span className="w-0.5 bg-emerald-400 rounded-full animate-[pulse_0.9s_ease-in-out_infinite] h-1.5" />
            </div>
          </button>
          {spotifyRestoreButton}
          {stopButton}
        </div>
        <SpotifyPlayerFeedback opening={false} error={djError} />
      </aside>
    )
  }

  return (
    <aside
      aria-label="DJ"
      className="fixed top-16 right-4 z-[60] w-80 bg-[#12151d]/98 border border-emerald-500/40 rounded-3xl shadow-2xl shadow-emerald-950/50 backdrop-blur-xl overflow-hidden animate-in fade-in slide-in-from-right-4 duration-200 select-none flex flex-col max-h-[calc(100vh-80px)]"
    >
      <div className="p-3 bg-gradient-to-r from-emerald-950/40 via-[#161a25] to-[#12151d] border-b border-[#222938] flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative">
            <div className="w-8 h-8 rounded-xl bg-[#1db954] text-black flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <SpotifyIcon size={18} className="w-4 h-4 text-black" />
            </div>
            <span className="w-2 h-2 rounded-full bg-emerald-400 absolute -top-0.5 -right-0.5 ring-2 ring-[#12151d]" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-100 flex items-center gap-1.5">
              <span>DJ</span>
              <span className="text-[9px] font-mono px-1.5 py-0.2 bg-emerald-500/20 text-emerald-400 rounded-md border border-emerald-500/30">ÁUDIO AO VIVO</span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              <span className="font-semibold text-slate-300">{zoneDisplayName}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {spotifyRestoreButton}
          <button
            type="button"
            onClick={() => setModalOpen(true, localZoneId)}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-lg transition-colors"
            title="Controles do DJ"
            aria-label="Controles do DJ"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={toggleMinimized}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-lg transition-colors"
            title="Minimizar display"
            aria-label="Minimizar display"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="px-3 py-2 bg-emerald-950/40 border-b border-emerald-500/20 flex items-center gap-2">
        <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
        <span className="text-[11px] font-bold text-emerald-300 truncate">
          DJ: {zoneDjState?.djName || localPlayerName}
        </span>
      </div>

      <div className="p-3 bg-[#0a0c12]/70 space-y-3 overflow-y-auto">
        <SpotifyPlaybackCrop />
        <SpotifyPlayerFeedback opening={djLoading} error={djError} />
        <button
          type="button"
          onClick={handleStopDj}
          disabled={djLoading}
          aria-busy={djLoading}
          aria-label="Encerrar DJ para todos"
          className="w-full py-4 px-5 rounded-2xl text-base font-bold flex items-center justify-center gap-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30"
        >
          <SpotifyIcon size={24} className="w-6 h-6 shrink-0" aria-hidden="true" />
          <span>{djLoading ? 'Parando...' : 'Parar DJ'}</span>
        </button>

        <div className="flex items-center gap-3 p-3 rounded-xl bg-[#141721] border border-slate-800">
          <button
            type="button"
            onClick={toggleMute}
            className="p-1 text-slate-400 hover:text-white rounded transition-colors"
            title={isMuted ? 'Desmutar' : 'Mutar'}
            aria-label={isMuted ? 'Desmutar' : 'Mutar'}
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            aria-label="Volume do DJ"
            min="0"
            max="200"
            value={isMuted ? 0 : volume}
            onChange={(e) => {
              const v = Number(e.target.value)
              setVolume(v)
            }}
            className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
          />
          <span className="text-xs text-slate-400 font-mono w-8 text-right">
            {isMuted ? '0%' : `${volume}%`}
          </span>
        </div>
      </div>
    </aside>
  )
}
