import React, { useState } from 'react'
import { X, MapPin, Volume2, VolumeX } from 'lucide-react'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { SpotifyIcon } from '../common/SpotifyIcon'
import { MediaManager } from '../../media/MediaManager'
import { SpotifyPlayerFeedback } from './SpotifyPlayerFeedback'
import { SpotifyLoginControls } from './SpotifyLoginControls'

export const SpotifyJamModal: React.FC = () => {
  const isModalOpen = useSpotifyJamStore((s) => s.isModalOpen)
  const setModalOpen = useSpotifyJamStore((s) => s.setModalOpen)
  const activeZoneIdForModal = useSpotifyJamStore((s) => s.activeZoneIdForModal)
  const isDjModeActive = useSpotifyJamStore((s) => s.isDjModeActive)
  const setDjStateInZone = useSpotifyJamStore((s) => s.setDjStateInZone)
  const volume = useSpotifyJamStore((s) => s.volume)
  const setVolume = useSpotifyJamStore((s) => s.setVolume)
  const isMuted = useSpotifyJamStore((s) => s.isMuted)
  const toggleMute = useSpotifyJamStore((s) => s.toggleMute)

  const localPlayer = useGameStore((s) => s.localPlayer)
  const mapZones = useMapStore((s) => s.mapData.zones)
  const targetZoneId = activeZoneIdForModal || localPlayer.currentZoneId
  const currentZone = mapZones.find((z) => z.id === targetZoneId)

  const [djLoading, setDjLoading] = useState(false)
  const [djError, setDjError] = useState<string | null>(null)

  if (!isModalOpen) return null

  const handleToggleDjMode = async () => {
    if (!targetZoneId || djLoading) return
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="spotify-dj-title"
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md select-none animate-in fade-in duration-200"
    >
      <div className="bg-[#12151d] border border-[#2a3142] rounded-3xl w-full max-w-md overflow-hidden flex flex-col shadow-2xl shadow-black/90 max-h-[90vh]">
        <div className="px-5 py-4 border-b border-[#222736] bg-[#0e1118] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-md">
              <SpotifyIcon size={20} className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="spotify-dj-title" className="text-base font-bold text-slate-100">DJ</h2>
                {currentZone && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold uppercase tracking-wider">
                    {currentZone.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">Músicas exclusivas para quem estiver nesta sala</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Fechar DJ"
            onClick={() => setModalOpen(false)}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {!targetZoneId || !currentZone ? (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 text-center space-y-3">
              <div className="w-10 h-10 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
                <MapPin className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-bold text-amber-200">Você está no corredor</h3>
                <p className="text-xs text-slate-400">
                  Entre em uma sala privada no mapa para transmitir como DJ. As músicas tocam exclusivamente para quem estiver na mesma sala!
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
              {!isDjModeActive && <SpotifyLoginControls disabled={djLoading} />}
              <SpotifyPlayerFeedback opening={djLoading} error={djError} />
              <button
                type="button"
                onClick={handleToggleDjMode}
                disabled={djLoading}
                aria-busy={djLoading}
                className={`w-full py-4 px-5 rounded-2xl text-base font-bold flex items-center justify-center gap-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isDjModeActive
                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/40'
                }`}
              >
                <SpotifyIcon size={24} className="w-6 h-6 shrink-0" aria-hidden="true" />
                <span>{djLoading ? (isDjModeActive ? 'Parando...' : 'Iniciando...') : isDjModeActive ? 'Parar DJ' : 'Transmitir DJ'}</span>
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
                    MediaManager.getInstance().setDjVolume(v)
                  }}
                  className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
                <span className="text-xs text-slate-400 font-mono w-8 text-right">
                  {isMuted ? '0%' : `${volume}%`}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#222736] bg-[#0e1118] flex justify-end">
          <button
            type="button"
            onClick={() => setModalOpen(false)}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded-xl font-medium transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
