import React, { useState, useEffect } from 'react'
import {
  X,
  Play,
  PowerOff,
  Headphones,
  MapPin,
  AlertCircle,
  Radio,
  Volume2,
  VolumeX,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Music,
  Plus,
  Trash2,
} from 'lucide-react'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { SpotifyIcon } from '../common/SpotifyIcon'
import { MediaManager } from '../../media/MediaManager'
import { toSpotifyDeepLink, SharedSpotifyTrack } from '../../types/spotifyJam'

export const SpotifyJamModal: React.FC = () => {
  const isModalOpen = useSpotifyJamStore((s) => s.isModalOpen)
  const setModalOpen = useSpotifyJamStore((s) => s.setModalOpen)
  const activeZoneIdForModal = useSpotifyJamStore((s) => s.activeZoneIdForModal)
  const jamsByZone = useSpotifyJamStore((s) => s.jamsByZone)
  const startJamInZone = useSpotifyJamStore((s) => s.startJamInZone)
  const stopJamInZone = useSpotifyJamStore((s) => s.stopJamInZone)

  const isDjModeActive = useSpotifyJamStore((s) => s.isDjModeActive)
  const djStateByZone = useSpotifyJamStore((s) => s.djStateByZone)
  const setDjStateInZone = useSpotifyJamStore((s) => s.setDjStateInZone)
  const sharedTracksByZone = useSpotifyJamStore((s) => s.sharedTracksByZone)
  const shareTrackInZone = useSpotifyJamStore((s) => s.shareTrackInZone)
  const removeSharedTrack = useSpotifyJamStore((s) => s.removeSharedTrack)
  const volume = useSpotifyJamStore((s) => s.volume)
  const setVolume = useSpotifyJamStore((s) => s.setVolume)
  const isMuted = useSpotifyJamStore((s) => s.isMuted)
  const toggleMute = useSpotifyJamStore((s) => s.toggleMute)

  const localPlayer = useGameStore((s) => s.localPlayer)
  const localZoneId = localPlayer.currentZoneId
  const mapZones = useMapStore((s) => s.mapData.zones)

  const targetZoneId = activeZoneIdForModal || localZoneId
  const currentZone = mapZones.find((z) => z.id === targetZoneId)
  const activeZoneJam = targetZoneId ? jamsByZone[targetZoneId] : null
  const zoneDjState = targetZoneId ? djStateByZone[targetZoneId] : null
  const sharedTracks = (targetZoneId ? sharedTracksByZone[targetZoneId] : []) || []
  const isDjActiveInZone = Boolean(zoneDjState?.isDjActive || isDjModeActive)

  const [inputUrl, setInputUrl] = useState('')
  const [isToolsExpanded, setIsToolsExpanded] = useState(true)
  const [newTrackInput, setNewTrackInput] = useState('')
  const [djLoading, setDjLoading] = useState(false)
  const [djError, setDjError] = useState<string | null>(null)

  useEffect(() => {
    if (activeZoneJam?.jamUrl) {
      setInputUrl(activeZoneJam.jamUrl)
    } else {
      setInputUrl('')
    }
  }, [activeZoneJam, isModalOpen])

  if (!isModalOpen) return null

  const handleStartWithUrl = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputUrl.trim() || !targetZoneId || !currentZone) return

    startJamInZone(targetZoneId, currentZone.name, inputUrl.trim())
    setInputUrl('')
  }

  const handleStopJam = () => {
    if (!targetZoneId) return
    if (isDjModeActive) {
      MediaManager.getInstance().stopDjAudio()
      setDjStateInZone(targetZoneId, null, true)
    }
    stopJamInZone(targetZoneId, true)
  }

  const handleToggleDjMode = async () => {
    if (!targetZoneId) return
    setDjError(null)
    setDjLoading(true)
    try {
      if (isDjModeActive) {
        await MediaManager.getInstance().stopDjAudio()
        setDjStateInZone(targetZoneId, null, true)
      } else {
        const res = await MediaManager.getInstance().startDjAudio()
        if (res.ok) {
          setDjStateInZone(
            targetZoneId,
            {
              zoneId: targetZoneId,
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

  const handleOpenWebPlayer = async () => {
    const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null
    if (electronAPI?.openSpotifyPlayer) {
      await electronAPI.openSpotifyPlayer(activeZoneJam?.jamUrl || 'https://open.spotify.com')
    } else {
      window.open(activeZoneJam?.jamUrl || 'https://open.spotify.com', '_blank')
    }
  }

  const handleAddSharedTrack = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newTrackInput.trim() || !targetZoneId) return
    shareTrackInZone(targetZoneId, newTrackInput.trim())
    setNewTrackInput('')
  }

  const handleOpenTrack = async (trackUrl: string) => {
    const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null
    const deepLink = toSpotifyDeepLink(trackUrl)
    if (electronAPI?.openExternal) {
      await electronAPI.openExternal(deepLink)
    } else {
      window.open(trackUrl, '_blank')
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md select-none animate-in fade-in duration-200"
    >
      <div className="bg-[#12151d] border border-[#2a3142] rounded-3xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl shadow-black/90 max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#222736] bg-[#0e1118] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-md">
              <SpotifyIcon size={20} className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-100">Spotify Jam</h2>
                {currentZone && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold uppercase tracking-wider">
                    {currentZone.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Músicas exclusivas para quem estiver nesta sala
              </p>
            </div>
          </div>

          <button
            onClick={() => setModalOpen(false)}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[calc(90vh-120px)]">
          {!targetZoneId || !currentZone ? (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
                <MapPin className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-amber-200">Você está no corredor</h3>
                <p className="text-xs text-slate-400">
                  Entre em uma sala privada no mapa para iniciar uma sessão de Jam. As músicas tocam exclusivamente para quem estiver na mesma sala!
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors"
              >
                Entendi
              </button>
            </div>
          ) : (
            <>
              {activeZoneJam?.isActive && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-emerald-300">Jam ativo nesta sala</div>
                      <div className="text-[10px] text-slate-400 truncate">
                        Iniciado por {activeZoneJam.startedBy}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleStopJam}
                    className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 rounded-lg transition-colors font-medium shrink-0"
                  >
                    <PowerOff className="w-3 h-3" />
                    <span>Encerrar</span>
                  </button>
                </div>
              )}

              {/* Form with link input only */}
              <form onSubmit={handleStartWithUrl} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Link do Spotify Jam
                  </label>
                  <input
                    type="text"
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    placeholder="Cole o link do Spotify Jam desta sala..."
                    className="w-full px-4 py-3 bg-[#0e1118] border border-[#2a3142] focus:border-emerald-500 rounded-xl text-xs sm:text-sm text-slate-100 placeholder-slate-500 focus:outline-none transition-colors"
                    autoFocus
                  />
                  <p className="text-[11px] text-slate-500 mt-1.5 flex items-start gap-1">
                    <AlertCircle className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span>Cole o link de convite do Spotify Jam (ex: spotify.link/...) ou o link de uma música/playlist.</span>
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={!inputUrl.trim()}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-950/40 transition-all flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>
                    {activeZoneJam?.isActive
                      ? 'Atualizar Jam da Sala'
                      : `Iniciar Jam em ${currentZone.name}`}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={handleOpenWebPlayer}
                  className="w-full py-2 bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 font-semibold text-xs rounded-xl border border-slate-700/60 transition-colors flex items-center justify-center gap-1.5"
                  title="Abrir Player Web dedicado do Spotify no Lira com login salvo"
                >
                  <SpotifyIcon size={14} className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Abrir Player Integrado do Spotify</span>
                </button>
              </form>

              {/* Modo DJ & Fila Compartilhada */}
              <div className="pt-2 border-t border-[#1e2330]">
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
                    {/* DJ Mode Toggle Card */}
                    <div className="p-2.5 rounded-xl bg-[#141721] border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-slate-200 flex items-center gap-1">
                          <Radio className="w-3 h-3 text-emerald-400" />
                          Transmissão DJ de Áudio
                        </span>
                        <button
                          type="button"
                          onClick={handleToggleDjMode}
                          disabled={djLoading}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                            isDjModeActive
                              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                              : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950/30'
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
                          type="button"
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
                          className="flex-1 bg-[#0e1118] border border-slate-700/80 focus:border-emerald-500 rounded-lg px-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={!newTrackInput.trim()}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors"
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
                            className="p-1.5 bg-[#0e1118] border border-slate-800/80 rounded-lg flex items-center justify-between gap-1.5 text-xs group"
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
                                onClick={() => handleOpenTrack(t.url)}
                                className="px-1.5 py-0.5 bg-emerald-600/80 hover:bg-emerald-500 text-white rounded text-[10px] font-bold flex items-center gap-0.5"
                                title="Tocar no meu Spotify"
                              >
                                <SpotifyIcon size={10} className="w-2.5 h-2.5" />
                                <span>Ouvir</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => removeSharedTrack(targetZoneId, t.id)}
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
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#222736] bg-[#0e1118] flex items-center justify-between text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5 text-slate-400">
            <SpotifyIcon size={14} className="w-3.5 h-3.5 text-emerald-400" />
            <span>Mini display lateral por sala</span>
          </span>
          <button
            onClick={() => setModalOpen(false)}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-medium transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
