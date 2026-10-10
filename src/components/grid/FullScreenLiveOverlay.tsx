import React, { useEffect, useRef, useState } from 'react'
import { Radio, Minimize2, Volume2, Volume1, VolumeX, EyeOff } from 'lucide-react'
import { ParticipantData } from './GridParticipantTile'
import { useMediaStore } from '../../store/useMediaStore'
import { attachStreamToVideo } from '../../media/attachVideoElement'
import { LiveWatchPrompt } from '../LiveWatchPrompt'
import { useLiveGate } from '../../hooks/useLiveGate'
import { useLiveViewBox } from '../../hooks/useLiveViewBox'

interface Props {
  user: ParticipantData
  onClose: () => void
}

export const FullScreenLiveOverlay: React.FC<Props> = ({ user, onClose }) => {
  const theaterVideoRef = useRef<HTMLVideoElement | null>(null)
  const theaterContainerRef = useRef<HTMLDivElement | null>(null)
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isInteractingWithVolumeRef = useRef(false)

  // Granular selectors — same VU-tick reason as the tiles.
  const participantVolumes = useMediaStore((s) => s.participantVolumes)
  const setParticipantVolume = useMediaStore((s) => s.setParticipantVolume)
  const liveStreamVolume = useMediaStore((s) => s.liveStreamVolume)
  const setLiveStreamVolume = useMediaStore((s) => s.setLiveStreamVolume)
  const outputVolume = useMediaStore((s) => s.outputVolume)
  const selectedAudioOutput = useMediaStore((s) => s.selectedAudioOutput)

  const rawVolume =
    participantVolumes[user.id] !== undefined
      ? participantVolumes[user.id]
      : user.name && participantVolumes[user.name] !== undefined
      ? participantVolumes[user.name]
      : liveStreamVolume !== undefined
      ? liveStreamVolume
      : 100

  const [prevVolume, setPrevVolume] = useState<number>(rawVolume > 0 ? rawVolume : 100)

  const activeStream = user.screenStream || user.stream
  // The full screen also shows a camera; only a live of somebody else waits for a click.
  const isLive = Boolean(user.screenStream || user.isScreenSharing)
  const liveGate = useLiveGate(user.id, Boolean(!user.isLocal && isLive && user.liveOptIn), !!user.liveWatching)

  useEffect(() => {
    const video = theaterVideoRef.current
    if (!video || !activeStream) return

    video.srcObject = activeStream

    // Apply audio output device if supported
    if (selectedAudioOutput && typeof (video as any).setSinkId === 'function') {
      ;(video as any).setSinkId(selectedAudioOutput === 'default' ? '' : selectedAudioOutput).catch(() => {})
    }

    // Shared attach with play-failure recovery (retry on audio/video unmute
    // and click). See attachVideoElement.ts.
    return attachStreamToVideo(video, activeStream, {
      tile: 'theater',
      peer: user.id,
      isLocal: !!user.isLocal,
    })
    // The <video> is a new element after the click to watch.
  }, [activeStream, selectedAudioOutput, liveGate.needsClick])

  useLiveViewBox(user.id, theaterVideoRef, 'contain', liveGate.watching)

  // Update volume in real-time
  useEffect(() => {
    const video = theaterVideoRef.current
    if (!video) return

    if (user.isLocal) {
      video.muted = true
      video.volume = 0
    } else {
      video.muted = false
      const master = (outputVolume !== undefined ? outputVolume : 100) / 100
      const participant = rawVolume / 100
      video.volume = Math.max(0, Math.min(1, master * participant))
    }
  }, [rawVolume, outputVolume, user.isLocal, liveGate.needsClick])

  const handleVolumeChange = (newVal: number) => {
    const clamped = Math.max(0, Math.min(200, newVal))
    setLiveStreamVolume(clamped)
    setParticipantVolume(user.id, clamped)
    if (user.name) {
      setParticipantVolume(user.name, clamped)
    }
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

  // Native Electron Window Fullscreen / Theater Mode
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

  // Keyboard shortcut handlers (ESC, Mute, Volume Up/Down)
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

  // Auto hide floating controls after 3.5 seconds of inactivity
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
    // Only close if at least 500ms have passed since mount, preventing double-click bounce
    if (Date.now() - mountedAtRef.current > 500) {
      onClose()
    }
  }

  return (
    <div
      ref={theaterContainerRef}
      onMouseMove={handleMouseMove}
      className="fixed inset-0 z-[100] bg-black flex items-center justify-center overflow-hidden select-none cursor-default"
    >
      {/* A live starts with a click: until then only the microphone arrives */}
      {!liveGate.needsClick && (
        <video
          ref={theaterVideoRef}
          autoPlay
          playsInline
          muted={user.isLocal}
          onLoadedMetadata={() => theaterVideoRef.current?.play().catch(() => {})}
          onCanPlay={() => theaterVideoRef.current?.play().catch(() => {})}
          onLoadedData={liveGate.onFrame}
          onPlaying={liveGate.onFrame}
          className="w-full h-full object-contain bg-black"
          onDoubleClick={handleDoubleClickVideo}
        />
      )}
      {(liveGate.needsClick || liveGate.connecting) && (
        <LiveWatchPrompt size="stage" name={user.name} connecting={liveGate.connecting} onWatch={liveGate.watch} />
      )}

      {/* Floating Top Control Bar */}
      <div
        className={`absolute top-6 left-6 right-6 flex items-center justify-between transition-opacity duration-300 z-50 ${
          controlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3 bg-black/80 backdrop-blur-xl px-4 py-2 rounded-2xl border border-white/15 shadow-2xl">
          <div className="flex items-center gap-2 px-2.5 py-1 bg-rose-600 text-white rounded-lg text-xs font-extrabold animate-pulse">
            <Radio className="w-3.5 h-3.5" />
            <span>AO VIVO</span>
          </div>
          <div className="text-sm font-bold text-white flex items-center gap-2">
            <span>{user.name}</span>
            <span className="text-slate-400 font-normal text-xs">• Transmissão em Tela Cheia</span>
          </div>
        </div>

        {/* Right Actions: Stop watching + Volume + Exit */}
        <div className="flex items-center gap-3">
          {liveGate.watching && (
            <button
              onClick={liveGate.stop}
              className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-black/80 hover:bg-rose-600 text-white border border-white/15 backdrop-blur-xl shadow-2xl font-bold text-xs transition-all hover:scale-105"
              title="Deixar de receber o vídeo e o som desta transmissão"
            >
              <EyeOff className="w-4 h-4" />
              <span>Parar de assistir</span>
            </button>
          )}

          {/* Volume Control for Viewer */}
          {!user.isLocal && !liveGate.needsClick && (
            <div
              className="flex items-center gap-2.5 bg-black/80 backdrop-blur-xl px-4 py-2 rounded-2xl border border-white/15 shadow-2xl"
              onMouseEnter={() => {
                isInteractingWithVolumeRef.current = true
              }}
              onMouseLeave={() => {
                isInteractingWithVolumeRef.current = false
              }}
            >
              <button
                onClick={handleToggleMute}
                className="p-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors"
                title={rawVolume === 0 ? 'Desmutar Transmissão (M)' : 'Mutar Transmissão (M)'}
              >
                {rawVolume === 0 ? (
                  <VolumeX className="w-4 h-4 text-rose-400" />
                ) : rawVolume < 50 ? (
                  <Volume1 className="w-4 h-4 text-indigo-400" />
                ) : (
                  <Volume2 className="w-4 h-4 text-indigo-400" />
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
                className="w-24 sm:w-28 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400"
                title={`Volume da Transmissão: ${rawVolume}% (Use ↑/↓)`}
              />

              <span className="text-xs font-mono font-bold text-slate-200 min-w-[34px] text-right">
                {rawVolume}%
              </span>
            </div>
          )}

          <button
            onClick={onClose}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-black/80 hover:bg-rose-600 text-white border border-white/15 backdrop-blur-xl shadow-2xl font-bold text-xs transition-all hover:scale-105"
          >
            <Minimize2 className="w-4 h-4" />
            <span>Sair da Tela Cheia (ESC)</span>
          </button>
        </div>
      </div>

      {/* Floating Bottom Info Pill */}
      <div
        className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/80 backdrop-blur-xl px-6 py-3 rounded-3xl border border-white/15 shadow-2xl transition-opacity duration-300 z-50 ${
          controlsVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <span className="text-xs text-slate-300 font-medium flex items-center gap-2">
          <span>Dê dois cliques no vídeo ou pressione <kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-white border border-slate-700 text-[10px]">ESC</kbd> para voltar</span>
          {!user.isLocal && (
            <>
              <span className="text-slate-500">•</span>
              <span>Volume: <kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-white border border-slate-700 text-[10px]">↑</kbd> <kbd className="bg-slate-800 px-1.5 py-0.5 rounded text-white border border-slate-700 text-[10px]">↓</kbd></span>
            </>
          )}
        </span>
      </div>
    </div>
  )
}
