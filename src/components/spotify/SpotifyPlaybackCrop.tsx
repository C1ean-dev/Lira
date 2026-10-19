import React, { useEffect, useRef, useState } from 'react'
import { SkipBack, Play, Pause, SkipForward } from 'lucide-react'
import type { SpotifyPlaybackCommand, SpotifyPlaybackFrameData } from '../../types/spotifyPlayback'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { useLocalPlayerDetails } from '../../hooks/usePlayerDetails'
import { commandDjPlayback } from '../../services/spotifyDjPlayback'

const playbackTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export const SpotifyPlaybackFrame: React.FC<{
  frame: SpotifyPlaybackFrameData
  busy: boolean
  onCommand: (command: SpotifyPlaybackCommand) => void
}> = ({ frame, busy, onCommand }) => {
  const [progress, setProgress] = useState(frame.seek?.value || 0)
  const seeking = useRef(false)
  useEffect(() => { if (!seeking.current) setProgress(frame.seek?.value || 0) }, [frame.seek?.value])
  const icons = { previous: SkipBack, playpause: frame.playing ? Pause : Play, next: SkipForward }
  const labels = { previous: 'Anterior', playpause: frame.playing ? 'Pausar' : 'Reproduzir', next: 'Próxima' }
  const buttons = (Object.keys(labels) as Array<keyof typeof labels>).map(id => {
    const button = frame.buttons.find(button => button.id === id)
    return { id, label: button?.label || labels[id], disabled: button?.disabled ?? true }
  })
  const duration = frame.seek?.duration || 0
  return (
    <div className="w-full rounded-xl bg-black p-3 space-y-3 min-h-[92px]">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0" aria-live="polite">
          <p className="text-sm font-semibold text-white truncate" title={frame.track?.title}>{frame.track?.title || 'Escolha uma música no Spotify'}</p>
          {frame.track?.artist && <p className="text-xs text-slate-400 truncate">{frame.track.artist}</p>}
        </div>
      </div>
      <div className="flex items-center justify-center gap-3">
        {buttons.map(button => {
          const Icon = icons[button.id]
          const primary = button.id === 'playpause'
          return (
            <button
              key={button.id}
              type="button"
              aria-label={button.label}
              title={button.label}
              disabled={busy || button.disabled}
              onClick={() => onCommand({ action: button.id })}
              className={`relative flex items-center justify-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed ${
                primary ? 'w-10 h-10 bg-white text-black hover:bg-slate-200' : 'w-8 h-8 hover:bg-white/10 text-slate-300 hover:text-white'
              }`}
            >
              <Icon aria-hidden="true" className={primary ? 'w-5 h-5 fill-current' : 'w-4 h-4'} />
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2 text-[10px] text-slate-300 font-mono tabular-nums">
        <span>{playbackTime(duration * progress / 100)}</span>
        <input
          type="range"
          min="0" max="100" step="0.1"
          aria-label="Posição da música"
          aria-valuetext={`${playbackTime(duration * progress / 100)} de ${playbackTime(duration)}`}
          value={progress}
          disabled={busy || !frame.seek || duration <= 0}
          onChange={event => setProgress(Number(event.target.value))}
          onPointerDown={() => { seeking.current = true }}
          onPointerCancel={() => { seeking.current = false }}
          onPointerUp={event => { seeking.current = false; onCommand({ action: 'seek', fraction: Number(event.currentTarget.value) / 100 }) }}
          onKeyUp={event => {
            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) onCommand({ action: 'seek', fraction: Number(event.currentTarget.value) / 100 })
          }}
          className="w-full h-1 rounded-lg appearance-none bg-slate-700 cursor-pointer accent-emerald-500 disabled:cursor-not-allowed"
        />
        <span>{playbackTime(duration)}</span>
      </div>
    </div>
  )
}

export const SpotifyPlaybackCrop: React.FC = () => {
  const { currentZoneId } = useLocalPlayerDetails()
  const frame = useSpotifyJamStore(s => currentZoneId ? s.djStateByZone[currentZoneId]?.playback : undefined)
  const error = useSpotifyJamStore(s => currentZoneId ? s.djStateByZone[currentZoneId]?.playbackError : undefined)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const alive = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const command = async (selection: SpotifyPlaybackCommand) => {
    if (pending.current || !currentZoneId) return
    pending.current = true
    setBusy(true)
    setCommandError(null)
    try {
      const result = await commandDjPlayback(currentZoneId, selection)
      if (alive.current && !result.ok) setCommandError(result.error || 'Não foi possível controlar o Spotify.')
    } catch { if (alive.current) setCommandError('Não foi possível controlar o Spotify.') }
    finally { pending.current = false; if (alive.current) setBusy(false) }
  }
  return (
    <section aria-label="Reprodução do Spotify" className="space-y-2">
      {frame ? <SpotifyPlaybackFrame frame={frame} busy={busy} onCommand={selection => { void command(selection) }} /> : (
        <p role="status" className="text-xs text-slate-400 p-3 rounded-xl bg-black/40 min-h-[92px]">
          {error || 'Carregando os controles do Spotify...'}
        </p>
      )}
      {frame && error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
      {commandError && <p role="alert" className="text-xs text-rose-300">{commandError}</p>}
    </section>
  )
}
