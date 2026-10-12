import React, { useState } from 'react'
import {
  Copy,
  Check,
  Minimize2,
  Volume2,
  VolumeX,
  PowerOff,
  Edit2,
  Headphones,
  Music,
  Plus,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Trash2,
  Radio,
} from 'lucide-react'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { SpotifyIcon } from '../common/SpotifyIcon'
import { MediaManager } from '../../media/MediaManager'
import { toSpotifyDeepLink, SharedSpotifyTrack } from '../../types/spotifyJam'

export const SpotifyJamSideDisplay: React.FC = () => {
  const localPlayer = useGameStore((s) => s.localPlayer)
  const localZoneId = localPlayer.currentZoneId
  const mapZones = useMapStore((s) => s.mapData.zones)
  const jamsByZone = useSpotifyJamStore((s) => s.jamsByZone)
  const djStateByZone = useSpotifyJamStore((s) => s.djStateByZone)
  const sharedTracksByZone = useSpotifyJamStore((s) => s.sharedTracksByZone)
  const isMinimized = useSpotifyJamStore((s) => s.isSideDisplayMinimized)
  const toggleMinimized = useSpotifyJamStore((s) => s.toggleSideDisplayMinimized)
  const stopJamInZone = useSpotifyJamStore((s) => s.stopJamInZone)
  const setModalOpen = useSpotifyJamStore((s) => s.setModalOpen)
  const volume = useSpotifyJamStore((s) => s.volume)
  const setVolume = useSpotifyJamStore((s) => s.setVolume)
  const isMuted = useSpotifyJamStore((s) => s.isMuted)
  const toggleMute = useSpotifyJamStore((s) => s.toggleMute)
  const isDjModeActive = useSpotifyJamStore((s) => s.isDjModeActive)
  const shareTrackInZone = useSpotifyJamStore((s) => s.shareTrackInZone)
  const removeSharedTrack = useSpotifyJamStore((s) => s.removeSharedTrack)
  const setDjStateInZone = useSpotifyJamStore((s) => s.setDjStateInZone)

  const [copied, setCopied] = useState(false)
  const [isToolsExpanded, setIsToolsExpanded] = useState(true)
  const [newTrackInput, setNewTrackInput] = useState('')
  const [djLoading, setDjLoading] = useState(false)
  const [djError, setDjError] = useState<string | null>(null)

  // A Jam deve ser POR SALA: Se não estiver em uma sala ou se a sala não tiver sessão, não renderiza nada!
  if (!localZoneId) return null

  const activeJam = jamsByZone[localZoneId]
  const zoneDjState = djStateByZone[localZoneId]
  const sharedTracks = sharedTracksByZone[localZoneId] || []
  const hasJam = Boolean(activeJam && activeJam.isActive)
  const isDjActiveInZone = Boolean(zoneDjState?.isDjActive || isDjModeActive)

  if (!hasJam && !isDjActiveInZone && sharedTracks.length === 0) {
    return null
  }

  const currentZone = mapZones.find((z) => z.id === localZoneId)
  const zoneDisplayName = activeJam?.zoneName || currentZone?.name || 'Sala Privada'

  const handleCopyLink = () => {
    const url = activeJam?.jamUrl || (sharedTracks[0] ? sharedTracks[0].url : '')
    if (url) {
      navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2200)
    }
  }

  const handleOpenSpotifyApp = async (targetUrl?: string) => {
    const url = targetUrl || activeJam?.jamUrl
    if (!url) return
    const electronAPI = (window as any).electronAPI
    const deepLink = toSpotifyDeepLink(url)
    if (electronAPI?.openExternal) {
      await electronAPI.openExternal(deepLink)
    } else {
      window.open(url, '_blank')
    }
  }

  const handleOpenWebPlayer = async () => {
    const electronAPI = (window as any).electronAPI
    if (electronAPI?.openSpotifyPlayer) {
      await electronAPI.openSpotifyPlayer(activeJam?.jamUrl || 'https://open.spotify.com')
    } else {
      window.open(activeJam?.jamUrl || 'https://open.spotify.com', '_blank')
    }
  }

  const handleToggleDjMode = async () => {
    setDjError(null)
    setDjLoading(true)
    try {
      if (isDjModeActive) {
        await MediaManager.getInstance().stopDjAudio()
        setDjStateInZone(localZoneId, null, true)
      } else {
        const res = await MediaManager.getInstance().startDjAudio()
        if (res.ok) {
          setDjStateInZone(
            localZoneId,
            {
              zoneId: localZoneId,
              isDjActive: true,
              djPeerId: localPlayer.id,
              djName: localPlayer.name,
              startedAt: Date.now(),
            },
            true
          )
        } else {
          setDjError(res.error || 'Erro ao iniciar transmissão de áudio.')
        }
      }
    } finally {
      setDjLoading(false)
    }
  }

  const handleAddSharedTrack = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTrackInput.trim()) return
    shareTrackInZone(localZoneId, newTrackInput.trim())
    setNewTrackInput('')
  }

  const handleEditLink = () => {
    setModalOpen(true, localZoneId)
  }

  const handleStopJam = () => {
    if (isDjModeActive) {
      MediaManager.getInstance().stopDjAudio()
      setDjStateInZone(localZoneId, null, true)
    }
    stopJamInZone(localZoneId, true)
  }

  // Minimized state: sleek compact pill docked on the right side
  if (isMinimized) {
    return (
      <aside
        aria-label="Spotify Jam Mini Display Minimizado"
        className="fixed top-16 right-4 z-[60] animate-in fade-in slide-in-from-right-3 duration-200 select-none"
      >
        <button
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
              <span>{isDjActiveInZone ? 'DJ Modo' : 'Spotify'}</span>
              <span className="text-[9px] text-emerald-400 font-mono uppercase">Na Sala</span>
            </div>
            <div className="text-[10px] text-slate-300 truncate max-w-[110px] leading-tight mt-0.5 font-medium">
              {zoneDisplayName}
            </div>
          </div>

          {/* Equalizer animation */}
          <div className="flex items-end gap-0.5 h-3.5 px-1">
            <span className="w-0.5 bg-emerald-400 rounded-full animate-[pulse_0.7s_ease-in-out_infinite] h-2" />
            <span className="w-0.5 bg-emerald-400 rounded-full animate-[pulse_0.5s_ease-in-out_infinite] h-3.5" />
            <span className="w-0.5 bg-emerald-400 rounded-full animate-[pulse_0.9s_ease-in-out_infinite] h-1.5" />
          </div>
        </button>
      </aside>
    )
  }

  return (
    <aside
      aria-label="Spotify Jam Mini Display"
      className="fixed top-16 right-4 z-[60] w-80 bg-[#12151d]/98 border border-emerald-500/40 rounded-3xl shadow-2xl shadow-emerald-950/50 backdrop-blur-xl overflow-hidden animate-in fade-in slide-in-from-right-4 duration-200 select-none flex flex-col max-h-[calc(100vh-80px)]"
    >
      {/* Header */}
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
              <span>{isDjActiveInZone ? 'Spotify DJ' : 'Spotify Jam'}</span>
              <span className="text-[9px] font-mono px-1.5 py-0.2 bg-emerald-500/20 text-emerald-400 rounded-md border border-emerald-500/30">
                {isDjActiveInZone ? 'ÁUDIO AO VIVO' : 'SALA'}
              </span>
            </div>
            <div className="text-[10px] text-slate-400 flex items-center gap-1 truncate">
              <span className="font-semibold text-slate-300">{zoneDisplayName}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleEditLink}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-lg transition-colors"
            title="Trocar link da sessão Jam"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={toggleMinimized}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-lg transition-colors"
            title="Minimizar display"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleStopJam}
            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
            title="Encerrar nesta sala"
          >
            <PowerOff className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* DJ Banner if Active */}
      {isDjActiveInZone && (
        <div className="px-3 py-2 bg-emerald-950/40 border-b border-emerald-500/20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span className="text-[11px] font-bold text-emerald-300">
              DJ: {zoneDjState?.djName || localPlayer.name}
            </span>
          </div>
          <span className="text-[9px] text-emerald-400/80 font-mono">Stereo WebRTC</span>
        </div>
      )}

      {/* Main Content Area */}
      <div className="p-3 bg-[#0a0c12]/70 space-y-2 overflow-y-auto max-h-[calc(100vh-220px)]">
        {/* If user pasted a standard track/album/playlist embed, show iframe. If it's a Jam link, show clean Ouvir no Spotify button! */}
        {activeJam?.embedUrl && !activeJam?.isJamLink ? (
          <div className="rounded-xl overflow-hidden border border-[#2a3142]/80 bg-black/40 shadow-inner">
            <iframe
              src={activeJam.embedUrl}
              width="100%"
              height="80"
              frameBorder="0"
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              className="w-full"
              title="Spotify Player"
            />
          </div>
        ) : (
          <button
            onClick={() => handleOpenSpotifyApp()}
            className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-950/40 transition-all flex items-center justify-center gap-2"
            title="Abrir o Jam no Spotify instalado ou no navegador"
          >
            <SpotifyIcon size={16} className="w-4 h-4" />
            <span>Ouvir Jam no Spotify</span>
          </button>
        )}

        {/* Action Button: Copiar Link */}
        {activeJam?.jamUrl && (
          <button
            onClick={handleCopyLink}
            className="w-full flex items-center justify-center gap-1.5 text-xs py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700/80 transition-colors font-medium"
            title="Copiar Link da sessão Jam"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
            <span>{copied ? 'Link Copiado!' : 'Copiar Link'}</span>
          </button>
        )}

        {/* Expandable Tools & Collaborative Queue */}
        <div className="pt-1 border-t border-[#1e2330]">
          <button
            type="button"
            onClick={() => setIsToolsExpanded(!isToolsExpanded)}
            className="w-full py-1.5 px-2 flex items-center justify-between text-[11px] text-slate-400 hover:text-slate-200 transition-colors rounded-lg hover:bg-slate-800/40"
          >
            <span className="flex items-center gap-1.5 font-semibold">
              <Headphones className="w-3.5 h-3.5 text-emerald-400" />
              <span>Modo DJ & Fila Compartilhada</span>
            </span>
            {isToolsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {isToolsExpanded && (
            <div className="mt-2 space-y-2.5 pt-1 animate-in fade-in duration-150">
              {/* DJ Mode Toggle */}
              <div className="p-2.5 rounded-xl bg-[#141721] border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-200 flex items-center gap-1">
                    <Radio className="w-3 h-3 text-emerald-400" />
                    Transmissão DJ de Áudio
                  </span>
                  <button
                    onClick={handleToggleDjMode}
                    disabled={djLoading}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                      isDjModeActive
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    {djLoading ? 'Iniciando...' : isDjModeActive ? 'Parar DJ' : 'Transmitir DJ'}
                  </button>
                </div>

                {djError && (
                  <div className="text-[10px] text-rose-400 bg-rose-500/10 p-1.5 rounded-lg border border-rose-500/20">
                    {djError}
                  </div>
                )}

                {/* Volume Slider for DJ & Audio */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    onClick={toggleMute}
                    className="p-1 text-slate-400 hover:text-white rounded transition-colors"
                    title={isMuted ? 'Desmutar' : 'Mutar'}
                  >
                    {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      setVolume(v)
                      MediaManager.getInstance().setDjVolume(v)
                    }}
                    className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                  />
                  <span className="text-[10px] text-slate-400 font-mono w-7 text-right">
                    {isMuted ? '0%' : `${volume}%`}
                  </span>
                </div>
              </div>

              {/* Dedicated Web Player Button */}
              <button
                type="button"
                onClick={handleOpenWebPlayer}
                className="w-full py-1.5 px-2 bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 rounded-xl text-[11px] font-semibold border border-slate-700/60 flex items-center justify-center gap-1.5 transition-colors"
                title="Abrir Web Player nativo integrado com sessão salva"
              >
                <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                <span>Abrir Player Integrado (Login Salvo)</span>
              </button>

              {/* Collaborative Track Recommendation Form */}
              <form onSubmit={handleAddSharedTrack} className="space-y-1.5">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                  <Music className="w-3 h-3 text-emerald-400" />
                  <span>Recomendar Faixa para a Sala</span>
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={newTrackInput}
                    onChange={(e) => setNewTrackInput(e.target.value)}
                    placeholder="Link ou nome da música..."
                    className="flex-1 bg-[#12151d] border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                  <button
                    type="submit"
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-colors"
                    title="Adicionar à fila da sala"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </form>

              {/* Shared Tracks Queue List */}
              {sharedTracks.length > 0 && (
                <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                  <div className="text-[10px] font-bold text-slate-400">Fila da Sala ({sharedTracks.length})</div>
                  {sharedTracks.map((t: SharedSpotifyTrack) => (
                    <div
                      key={t.id}
                      className="p-1.5 bg-[#12151d] border border-slate-800/80 rounded-lg flex items-center justify-between gap-1.5 text-xs group"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-200 truncate">{t.title}</div>
                        <div className="text-[9px] text-slate-400 truncate">
                          {t.artist ? `${t.artist} • ` : ''}por {t.sharedBy}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpenSpotifyApp(t.url)}
                          className="px-1.5 py-0.5 bg-emerald-600/80 hover:bg-emerald-500 text-white rounded text-[10px] font-bold flex items-center gap-0.5"
                          title="Tocar no meu Spotify"
                        >
                          <SpotifyIcon size={10} className="w-2.5 h-2.5" />
                          <span>Ouvir</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => removeSharedTrack(localZoneId, t.id)}
                          className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors"
                          title="Remover"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
