import React, { useState } from 'react'
import { X, MapPin, Volume2, VolumeX } from 'lucide-react'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { useMapStore } from '../../store/useMapStore'
import { useLocalPlayerDetails } from '../../hooks/usePlayerDetails'
import { SpotifyIcon } from '../common/SpotifyIcon'
import { MediaManager } from '../../media/MediaManager'
import { SpotifyPlaybackCrop } from './SpotifyPlaybackCrop'
import { SpotifyPlayerFeedback } from './SpotifyPlayerFeedback'
import { SpotifyLoginControls } from './SpotifyLoginControls'
import { useSpotifyLogin } from '../../hooks/useSpotifyLogin'
import { stopDjForEveryone } from '../../services/stopDjForEveryone'

export const SpotifyJamModal: React.FC = () => {
  const isModalOpen = useSpotifyJamStore((s) => s.isModalOpen)
  const setModalOpen = useSpotifyJamStore((s) => s.setModalOpen)
  const activeZoneIdForModal = useSpotifyJamStore((s) => s.activeZoneIdForModal)
  const isDjModeActive = useSpotifyJamStore((s) => s.isDjModeActive)
  const setDjStateInZone = useSpotifyJamStore((s) => s.setDjStateInZone)
  const djStateByZone = useSpotifyJamStore(s => s.djStateByZone)
  const volume = useSpotifyJamStore((s) => s.volume)
  const setVolume = useSpotifyJamStore((s) => s.setVolume)
  const isMuted = useSpotifyJamStore((s) => s.isMuted)
  const toggleMute = useSpotifyJamStore((s) => s.toggleMute)

  const localPlayer = useLocalPlayerDetails()
  const mapZones = useMapStore((s) => s.mapData.zones)
  const targetZoneId = activeZoneIdForModal || localPlayer.currentZoneId
  const currentZone = mapZones.find((z) => z.id === targetZoneId)

  const [djLoading, setDjLoading] = useState(false)
  const [djError, setDjError] = useState<string | null>(null)
  const isListening = !!targetZoneId && !!djStateByZone[targetZoneId]?.isDjActive && !isDjModeActive
  const login = useSpotifyLogin(isModalOpen && !!currentZone && !isDjModeActive && !isListening)

  if (!isModalOpen) return null

  const handleCloseDj = () => setModalOpen(false)

  const handleToggleDjMode = async () => {
    if (!targetZoneId || djLoading || (!isDjModeActive && !isListening && !login.ready)) return
    setDjError(null)
    setDjLoading(true)
    try {
      if (isListening) {
        stopDjForEveryone(targetZoneId)
      } else if (isDjModeActive) {
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
    } catch { setDjError('Não foi possível alterar a transmissão. Tente novamente.') }
    finally {
      setDjLoading(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="spotify-dj-title"
      className="fixed inset-0 z-[105] flex items-center justify-center p-4 bg-lira-ground/80 select-none font-mono"
    >
      <div className="bg-lira-panel border border-dashed border-lira-rule rounded-xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-dashed border-lira-rule/60 bg-lira-sidebar flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-lira-online/15 border border-lira-online/40 text-lira-online flex items-center justify-center">
              <SpotifyIcon size={20} className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="spotify-dj-title" className="text-base font-display font-bold text-lira-accent">DJ</h2>
                {currentZone && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-lira-online/15 text-lira-online border border-lira-online/40 font-mono font-bold uppercase tracking-wider">
                    {currentZone.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-lira-muted">Músicas exclusivas para quem estiver nesta sala</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Fechar DJ"
            onClick={handleCloseDj}
            disabled={djLoading}
            className="p-2 text-lira-muted hover:text-lira-ink hover:bg-lira-surface rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          {!targetZoneId || !currentZone ? (
            <div className="bg-lira-surface border border-dashed border-lira-amber/60 rounded-xl p-4 text-center space-y-3">
              <div className="w-10 h-10 rounded-lg bg-lira-amber/15 border border-lira-amber/40 text-lira-amber flex items-center justify-center mx-auto">
                <MapPin className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xs font-display font-bold text-lira-amber">Você está no corredor</h3>
                <p className="text-xs text-lira-muted">
                  Entre em uma sala privada no mapa para transmitir como DJ. As músicas tocam exclusivamente para quem estiver na mesma sala!
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 bg-lira-ground hover:bg-lira-panel text-lira-ink border border-lira-rule text-xs font-semibold rounded-lg transition-colors"
              >
                Entendi
              </button>
            </div>
          ) : (
            <>
              {isListening && <SpotifyPlaybackCrop />}
              {!isDjModeActive && !isListening && <SpotifyLoginControls login={login} disabled={djLoading} />}
              <SpotifyPlayerFeedback opening={djLoading} error={djError} />
              <button
                type="button"
                onClick={handleToggleDjMode}
                disabled={djLoading || (!isDjModeActive && !isListening && !login.ready)}
                aria-busy={djLoading}
                className={`w-full py-4 px-5 rounded-xl text-base font-bold flex items-center justify-center gap-3 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isDjModeActive || isListening
                    ? 'bg-lira-error/15 text-lira-error border border-lira-error/50 hover:bg-lira-error/25'
                    : 'bg-lira-accent hover:bg-lira-ink text-lira-ground border-2 border-lira-accent hover:border-lira-ink'
                }`}
              >
                <SpotifyIcon size={24} className="w-6 h-6 shrink-0" aria-hidden="true" />
                <span>{djLoading ? (isDjModeActive || isListening ? 'Parando...' : 'Iniciando...') : isDjModeActive || isListening ? 'Parar DJ' : 'Transmitir DJ'}</span>
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
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-dashed border-lira-rule/60 bg-lira-sidebar flex justify-end">
          <button
            type="button"
            onClick={handleCloseDj}
            disabled={djLoading}
            className="px-4 py-1.5 bg-lira-surface hover:border-lira-accent text-lira-ink border border-lira-rule text-xs rounded-lg font-medium transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
