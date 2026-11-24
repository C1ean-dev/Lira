import React, { useState } from 'react'
import { Minimize2, Volume2, VolumeX, Edit2, Radio, X } from 'lucide-react'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { useMapStore } from '../../store/useMapStore'
import { useLocalPlayerDetails } from '../../hooks/usePlayerDetails'
import { SpotifyIcon } from '../common/SpotifyIcon'
import { MediaManager } from '../../media/MediaManager'
import { SpotifyPlayerFeedback } from './SpotifyPlayerFeedback'
import { SpotifyPlaybackCrop } from './SpotifyPlaybackCrop'
import { SpotifyDjRequests } from './SpotifyDjRequests'
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
      className="p-1.5 text-lira-online hover:text-lira-ink hover:bg-lira-online/15 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-wait"
    >
      <SpotifyIcon size={16} className="w-4 h-4" aria-hidden="true" />
    </button>
  )
  const stopButton = <button type="button" onClick={handleStopDj} disabled={djLoading}
    aria-label="Encerrar DJ para todos" title="Encerrar DJ para todos"
    className="p-1.5 text-lira-error hover:bg-lira-error/15 rounded-lg disabled:opacity-50 transition-colors">
    <X className="w-4 h-4" />
  </button>

  if (isMinimized) {
    return (
      <aside
        aria-label="DJ minimizado"
        className="fixed top-4 right-4 z-[60] max-w-[calc(100vw-var(--rail-width)-24px)] select-none font-mono"
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleMinimized}
            className="flex items-center gap-2.5 px-3.5 py-2 bg-lira-panel hover:bg-lira-surface border border-dashed border-lira-rule rounded-xl group transition-colors"
            title={`Expandir painel de música da sala: ${zoneDisplayName}`}
          >
            <div className="relative flex items-center justify-center">
              <span className="w-2.5 h-2.5 rounded-full bg-lira-online animate-ping absolute" />
              <span className="w-2.5 h-2.5 rounded-full bg-lira-online relative" />
            </div>
            <div className="w-6 h-6 rounded-lg bg-lira-online/15 text-lira-online flex items-center justify-center">
              <SpotifyIcon size={14} className="w-3.5 h-3.5" />
            </div>
            <div className="text-left pr-1">
              <div className="text-[11px] font-display font-bold text-lira-ink flex items-center gap-1.5 leading-none">
                <span>DJ</span>
                <span className="text-[9px] text-lira-online font-mono uppercase">Na Sala</span>
              </div>
              <div className="text-[10px] text-lira-muted truncate max-w-[110px] leading-tight mt-0.5 font-medium">
                {zoneDisplayName}
              </div>
            </div>
            <div className="flex items-end gap-0.5 h-3.5 px-1">
              <span className="w-0.5 bg-lira-online rounded-full animate-[pulse_0.7s_ease-in-out_infinite] h-2" />
              <span className="w-0.5 bg-lira-online rounded-full animate-[pulse_0.5s_ease-in-out_infinite] h-3.5" />
              <span className="w-0.5 bg-lira-online rounded-full animate-[pulse_0.9s_ease-in-out_infinite] h-1.5" />
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
      className="fixed top-4 right-4 z-[60] w-80 max-w-[calc(100vw-var(--rail-width)-24px)] bg-lira-panel border border-dashed border-lira-rule rounded-xl overflow-hidden select-none flex flex-col max-h-[calc(100vh-32px)] font-mono"
    >
      <div className="p-3 bg-lira-sidebar border-b border-dashed border-lira-rule/60 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="relative">
            <div className="w-8 h-8 rounded-lg bg-lira-online text-lira-ground flex items-center justify-center">
              <SpotifyIcon size={18} className="w-4 h-4 text-lira-ground" />
            </div>
            <span className="w-2 h-2 rounded-full bg-lira-online absolute -top-0.5 -right-0.5 ring-2 ring-lira-sidebar" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-display font-bold text-lira-ink flex items-center gap-1.5">
              <span>DJ</span>
              <span className="text-[9px] font-mono px-1.5 py-0.2 bg-lira-online/15 text-lira-online rounded border border-lira-online/40">ÁUDIO AO VIVO</span>
            </div>
            <div className="text-[10px] text-lira-muted truncate">
              <span className="font-semibold text-lira-ink">{zoneDisplayName}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {spotifyRestoreButton}
          <button
            type="button"
            onClick={() => setModalOpen(true, localZoneId)}
            className="p-1.5 text-lira-muted hover:text-lira-ink hover:bg-lira-surface rounded-lg transition-colors"
            title="Controles do DJ"
            aria-label="Controles do DJ"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={toggleMinimized}
            className="p-1.5 text-lira-muted hover:text-lira-ink hover:bg-lira-surface rounded-lg transition-colors"
            title="Minimizar display"
            aria-label="Minimizar display"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="px-3 py-2 bg-lira-surface border-b border-dashed border-lira-rule/60 flex items-center gap-2">
        <Radio className="w-3.5 h-3.5 text-lira-online animate-pulse" />
        <span className="text-[11px] font-bold text-lira-online truncate">
          DJ: {zoneDjState?.djName || localPlayerName}
        </span>
      </div>

      <div className="p-3 bg-lira-panel space-y-3 overflow-y-auto">
        <SpotifyPlaybackCrop />
        {zoneDjState?.isDjActive && (
          <SpotifyDjRequests zoneId={localZoneId}
            key={`${localZoneId}:${zoneDjState.djPeerId}:${zoneDjState.startedAt}`} />
        )}
        <SpotifyPlayerFeedback opening={djLoading} error={djError} />
        <button
          type="button"
          onClick={handleStopDj}
          disabled={djLoading}
          aria-busy={djLoading}
          aria-label="Encerrar DJ para todos"
          className="w-full py-4 px-5 rounded-xl text-base font-bold flex items-center justify-center gap-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-lira-error/15 text-lira-error border border-lira-error/50 hover:bg-lira-error/25"
        >
          <SpotifyIcon size={24} className="w-6 h-6 shrink-0" aria-hidden="true" />
          <span>{djLoading ? 'Parando...' : 'Parar DJ'}</span>
        </button>

        <div className="flex items-center gap-3 p-3 rounded-lg bg-lira-surface border border-lira-quiet">
          <button
            type="button"
            onClick={toggleMute}
            className="p-1 text-lira-muted hover:text-lira-ink rounded transition-colors"
            title={isMuted ? 'Desmutar' : 'Mutar'}
            aria-label={isMuted ? 'Desmutar' : 'Mutar'}
          >
            {isMuted ? <VolumeX className="w-4 h-4 text-lira-error" /> : <Volume2 className="w-4 h-4" />}
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
            className="w-full h-1 bg-lira-ground rounded-lg appearance-none cursor-pointer accent-[var(--accent)]"
          />
          <span className="text-xs text-lira-muted font-mono tabular-nums w-8 text-right">
            {isMuted ? '0%' : `${volume}%`}
          </span>
        </div>
      </div>
    </aside>
  )
}
