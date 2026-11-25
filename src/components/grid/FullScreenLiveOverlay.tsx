import React, { useEffect, useRef, useState } from 'react'
import { Minimize2, Volume2, Volume1, VolumeX, EyeOff, Crop } from 'lucide-react'
import { ParticipantData } from './GridParticipantTile'
import { useMediaStore } from '../../store/useMediaStore'
import { attachStreamToVideo } from '../../media/attachVideoElement'
import { LiveWatchPrompt } from '../LiveWatchPrompt'
import { useLiveGate } from '../../hooks/useLiveGate'
import { useLiveViewBox } from '../../hooks/useLiveViewBox'
import { LiveTransmissionInfo } from './LiveTransmissionInfo'
import { useLiveFrameFit } from '../../hooks/useLiveFrameFit'

interface Props {
  user: ParticipantData
  onClose: () => void
}

export const FullScreenLiveOverlay: React.FC<Props> = ({ user, onClose }) => {
  const theaterVideoRef = useRef<HTMLVideoElement | null>(null)
  const frameRef = useRef<HTMLDivElement | null>(null)
  const theaterContainerRef = useRef<HTMLDivElement | null>(null)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [infoOpen, setInfoOpen] = useState(false)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isInteractingWithVolumeRef = useRef(false)

  const liveStreamVolume = useMediaStore((s) => s.liveStreamVolume)
  const setLiveStreamVolume = useMediaStore((s) => s.setLiveStreamVolume)

  const rawVolume = liveStreamVolume !== undefined ? liveStreamVolume : 100

  const [prevVolume, setPrevVolume] = useState<number>(rawVolume > 0 ? rawVolume : 100)
  // Hiding a native capture outline is an explicit crop, never an automatic zoom.
  const [removeCaptureBorder, setRemoveCaptureBorder] = useState(false)
  const toggleRemoveCaptureBorder = () => setRemoveCaptureBorder(hidden => !hidden)

  const activeStream = user.screenStream || user.stream
  const isLive = Boolean(user.screenStream || user.isScreenSharing)
  const liveGate = useLiveGate(user.id, Boolean(!user.isLocal && isLive && user.liveOptIn), !!user.liveWatching)
  const frameStyle = useLiveFrameFit(frameRef, theaterVideoRef, activeStream, !liveGate.needsClick)

  useEffect(() => {
    const video = theaterVideoRef.current
    if (!video || !activeStream) return

    // The grid's RemoteAudio keeps playing while the theater is open.
    video.muted = true
    return attachStreamToVideo(video, activeStream, {
      tile: 'theater',
      peer: user.id,
      isLocal: !!user.isLocal,
      muted: true,
    })
  }, [activeStream, user.id, user.isLocal, liveGate.needsClick])

  useLiveViewBox(user.id, theaterVideoRef, 'contain', liveGate.watching, 'full')

  const handleVolumeChange = (newVal: number) => {
    const clamped = Math.max(0, Math.min(200, newVal))
    setLiveStreamVolume(clamped)
    if (clamped > 0) {
      setPrevVolume(clamped)
    }
  }

  const handleToggleMute = () => {
    if (rawVolume > 0) {
      setPrevVolume(rawVolume)
      handleVolumeChange(0)
    } else {
      handleVolumeChange(prevVolume || 100)
    }
  }

  const rawVolumeRef = useRef(rawVolume)
  rawVolumeRef.current = rawVolume
  const prevVolumeRef = useRef(prevVolume)
  prevVolumeRef.current = prevVolume

  useEffect(() => {
    if (window.electronAPI && typeof window.electronAPI.setFullScreen === 'function') {
      window.electronAPI.setFullScreen(true).catch(() => {})
    }

    return () => {
      if (window.electronAPI && typeof window.electronAPI.setFullScreen === 'function') {
        window.electronAPI.setFullScreen(false).catch(() => {})
      }
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {})
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'm' || e.key === 'M') {
        if (rawVolumeRef.current > 0) {
          setPrevVolume(rawVolumeRef.current)
          handleVolumeChange(0)
        } else {
          handleVolumeChange(prevVolumeRef.current || 100)
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        handleVolumeChange(rawVolumeRef.current + 5)
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        handleVolumeChange(rawVolumeRef.current - 5)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const handleMouseMove = () => {
    setControlsVisible(true)
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current)
    hideTimeoutRef.current = setTimeout(() => {
      if (!isInteractingWithVolumeRef.current) {
        setControlsVisible(false)
      }
    }, 3500)
  }

  const mountedAtRef = useRef(Date.now())
  const handleDoubleClickVideo = () => {
    if (Date.now() - mountedAtRef.current > 500) {
      onClose()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Transmissão em tela cheia"
      ref={theaterContainerRef}
      onMouseMove={handleMouseMove}
      className="fixed inset-0 z-[100] bg-lira-ground flex items-center justify-center overflow-hidden select-none cursor-default font-mono"
    >
      {!liveGate.needsClick && (
        <div
          ref={frameRef}
          style={frameStyle}
          className="relative w-full h-full overflow-hidden flex items-center justify-center"
        >
          <video
            ref={theaterVideoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={() => {
              theaterVideoRef.current?.play().catch(() => {})
            }}
            onCanPlay={() => {
              theaterVideoRef.current?.play().catch(() => {})
            }}
            onLoadedData={liveGate.onFrame}
            onPlaying={liveGate.onFrame}
            className={`w-full h-full object-contain bg-lira-ground transition-transform duration-200 ${
              removeCaptureBorder ? 'scale-[1.01]' : 'scale-100'
            }`}
            onDoubleClick={handleDoubleClickVideo}
          />
        </div>
      )}
      {(liveGate.needsClick || liveGate.connecting) && (
        <LiveWatchPrompt size="stage" name={user.name} connecting={liveGate.connecting} onWatch={liveGate.watch} />
      )}

      <div
        className={`absolute top-6 left-6 right-6 flex items-center justify-between transition-opacity duration-300 z-50 ${
          controlsVisible || infoOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3 bg-lira-panel/95 px-4 py-2 rounded-[12px] border border-dashed border-lira-rule">
          <LiveTransmissionInfo stream={activeStream} local={!!user.isLocal} peerName={user.name} onOpenChange={setInfoOpen} />
          <div className="text-sm font-bold text-lira-ink flex items-center gap-2">
            <span className="font-display text-base text-lira-accent">{user.name}</span>
            <span className="text-lira-muted font-mono font-normal text-xs">• Transmissão em Tela Cheia</span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {liveGate.watching && (
            <button
              onClick={liveGate.stop}
              className="flex items-center gap-2 px-3.5 py-2 rounded-[8px] bg-lira-surface hover:bg-lira-error hover:text-lira-ground text-lira-error border border-lira-error/40 font-mono font-bold text-xs transition-colors"
              title="Deixar de receber o vídeo e o som desta transmissão"
            >
              <EyeOff className="w-4 h-4" />
              <span>Parar de assistir</span>
            </button>
          )}

          {!user.isLocal && !liveGate.needsClick && (
            <div
              className="flex items-center gap-2.5 bg-lira-panel/95 px-3.5 py-2 rounded-[12px] border border-dashed border-lira-rule"
              onMouseEnter={() => {
                isInteractingWithVolumeRef.current = true
              }}
              onMouseLeave={() => {
                isInteractingWithVolumeRef.current = false
              }}
            >
              <button
                onClick={handleToggleMute}
                className="p-1 rounded-[6px] text-lira-muted hover:text-lira-ink hover:bg-lira-surface transition-colors"
                title={rawVolume === 0 ? 'Desmutar Transmissão (M)' : 'Mutar Transmissão (M)'}
              >
                {rawVolume === 0 ? (
                  <VolumeX className="w-4 h-4 text-lira-error" />
                ) : rawVolume < 50 ? (
                  <Volume1 className="w-4 h-4 text-lira-accent" />
                ) : (
                  <Volume2 className="w-4 h-4 text-lira-accent" />
                )}
              </button>

              <input
                type="range"
                min="0"
                max="200"
                value={rawVolume}
                onChange={(e) => handleVolumeChange(Number(e.target.value))}
                onMouseDown={() => {
                  isInteractingWithVolumeRef.current = true
                }}
                onMouseUp={() => {
                  isInteractingWithVolumeRef.current = false
                }}
                className="w-24 sm:w-28 h-1.5 bg-lira-surface rounded-[4px] appearance-none cursor-pointer accent-lira-accent"
                title={`Volume da Transmissão: ${rawVolume}% (Use ↑/↓)`}
              />

              <span className="text-xs font-mono tabular-nums font-bold text-lira-ink min-w-[34px] text-right">
                {rawVolume}%
              </span>
            </div>
          )}

          <button
            onClick={toggleRemoveCaptureBorder}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-[8px] border font-mono font-bold text-xs transition-colors ${
              removeCaptureBorder
                ? 'bg-lira-surface text-lira-accent border-lira-accent'
                : 'bg-lira-panel/95 text-lira-muted border-lira-rule hover:border-lira-accent hover:text-lira-ink'
            }`}
            title={
              removeCaptureBorder
                ? 'Borda amarela do Windows: Oculta (Clique para exibir)'
                : 'Borda amarela do Windows: Visível (Clique para remover)'
            }
          >
            <Crop className="w-4 h-4" />
            <span>{removeCaptureBorder ? 'Borda Oculta' : 'Borda Visível'}</span>
          </button>

          <button
            onClick={onClose}
            className="flex items-center gap-2 px-3.5 py-2 rounded-[8px] bg-lira-surface hover:bg-lira-error hover:text-lira-ground text-lira-ink border border-lira-rule hover:border-lira-error font-mono font-bold text-xs transition-colors"
          >
            <Minimize2 className="w-4 h-4" />
            <span>Sair da Tela Cheia (ESC)</span>
          </button>
        </div>
      </div>

      <div
        className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-lira-panel/95 px-5 py-2.5 rounded-[12px] border border-dashed border-lira-rule transition-opacity duration-300 z-50 ${
          controlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <span className="text-xs text-lira-muted font-mono flex items-center gap-2">
          <span>Dê dois cliques no vídeo ou pressione <kbd className="bg-lira-surface px-1.5 py-0.5 rounded-[4px] text-lira-accent border border-lira-rule text-[10px] font-mono">ESC</kbd> para voltar</span>
          {!user.isLocal && (
            <>
              <span className="text-lira-rule">•</span>
              <span>Volume: <kbd className="bg-lira-surface px-1.5 py-0.5 rounded-[4px] text-lira-accent border border-lira-rule text-[10px] font-mono">↑</kbd> <kbd className="bg-lira-surface px-1.5 py-0.5 rounded-[4px] text-lira-accent border border-lira-rule text-[10px] font-mono">↓</kbd></span>
            </>
          )}
        </span>
      </div>
    </div>
  )
}
