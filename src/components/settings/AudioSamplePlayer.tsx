import React, { useState, useRef, useEffect, useId } from 'react'
import { Play, Pause, RotateCcw, Sparkles, Mic } from 'lucide-react'

interface Props {
  title: string
  subtitle?: string
  badge: string
  badgeVariant?: 'raw' | 'processed'
  audioUrl: string
  waveform?: number[]
  onApplySettings?: () => void
  applyLabel?: string
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

export const AudioSamplePlayer: React.FC<Props> = ({
  title,
  subtitle,
  badge,
  badgeVariant = 'raw',
  audioUrl,
  waveform = [],
  onApplySettings,
  applyLabel,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [hoverPercent, setHoverPercent] = useState<number | null>(null)

  const rawId = useId().replace(/:/g, '')
  const gradId = `wave-grad-${rawId}`
  const unplayedGradId = `wave-unplayed-${rawId}`

  const isProcessed = badgeVariant === 'processed'

  const bars =
    waveform.length > 0
      ? waveform
      : Array.from({ length: 75 }, (_, i) => {
          const wave =
            Math.sin(i * 0.35) * 0.15 +
            Math.cos(i * 0.8) * 0.1 +
            Math.sin(i * 1.5) * 0.08
          return Math.max(0.08, 0.2 + wave)
        })

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 5)
    }
    const handleEnded = () => {
      setIsPlaying(false)
      setCurrentTime(0)
    }
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.pause()
    }
  }, [audioUrl])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
    } else {
      audio.play().catch((err) => console.warn('Playback error:', err))
    }
  }

  const handleSeek = (e: React.MouseEvent<SVGSVGElement | HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percent = Math.max(0, Math.min(1, clickX / rect.width))
    const audio = audioRef.current
    if (audio && duration > 0) {
      audio.currentTime = percent * duration
      setCurrentTime(audio.currentTime)
    }
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    setHoverPercent(Math.max(0, Math.min(1, clickX / rect.width)))
  }

  const handleRestart = () => {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = 0
    setCurrentTime(0)
    audio.play().catch(() => {})
  }

  const progressFraction = duration > 0 ? currentTime / duration : 0
  const progressPercent = progressFraction * 100

  const viewBoxWidth = 750
  const viewBoxHeight = 64
  const centerY = viewBoxHeight / 2
  const step = viewBoxWidth / bars.length
  const barWidth = 3.2

  return (
    <div
      className={`rounded-[8px] p-3.5 border transition-colors font-mono ${
        isProcessed
          ? 'bg-lira-surface border-lira-online/40'
          : 'bg-lira-ground border-lira-quiet'
      }`}
    >
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {isProcessed ? (
            <Sparkles className="w-4 h-4 text-lira-online shrink-0" />
          ) : (
            <Mic className="w-4 h-4 text-lira-accent shrink-0" />
          )}
          <span className="text-xs font-bold text-lira-ink truncate">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-[6px] ${
              isProcessed
                ? 'bg-lira-online/15 text-lira-online border border-lira-online/30'
                : 'bg-lira-accent/15 text-lira-accent border border-lira-accent/30'
            }`}
          >
            {badge}
          </span>

          {onApplySettings && applyLabel && (
            <button
              type="button"
              onClick={onApplySettings}
              className="px-2.5 py-1 rounded-[6px] bg-lira-online hover:bg-lira-ink text-lira-ground text-[10px] font-mono font-bold uppercase tracking-wide transition-colors cursor-pointer"
              title="Aplicar as configurações ouvidas nesta prévia"
            >
              {applyLabel}
            </button>
          )}
        </div>
      </div>

      {subtitle && (
        <div className="text-[10.5px] text-lira-muted mb-2.5 leading-tight">
          {subtitle}
        </div>
      )}

      <div className="flex items-center gap-3 bg-lira-panel rounded-[8px] p-2.5 border border-lira-quiet">
        <button
          type="button"
          onClick={togglePlay}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0 cursor-pointer border ${
            isProcessed
              ? 'bg-lira-online text-lira-ground border-lira-online hover:bg-lira-ink'
              : 'bg-lira-accent text-lira-ground border-lira-accent hover:bg-lira-ink'
          }`}
          title={isPlaying ? 'Pausar reprodução' : 'Ouvir gravação'}
        >
          {isPlaying ? (
            <Pause className="w-4 h-4 fill-current" />
          ) : (
            <Play className="w-4 h-4 fill-current translate-x-0.5" />
          )}
        </button>

        <button
          type="button"
          onClick={handleRestart}
          className="p-1.5 rounded-[6px] text-lira-muted hover:text-lira-ink hover:bg-lira-surface transition-colors cursor-pointer"
          title="Reiniciar do começo"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        <div className="flex-1 h-16 flex items-center relative select-none">
          <svg
            viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
            preserveAspectRatio="none"
            className="w-full h-full cursor-pointer overflow-visible"
            onClick={handleSeek}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoverPercent(null)}
          >
            <defs>
              {isProcessed ? (
                <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#b9e99f" />
                  <stop offset="100%" stopColor="#d1b5ff" />
                </linearGradient>
              ) : (
                <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ffb0bd" />
                  <stop offset="50%" stopColor="#d1b5ff" />
                  <stop offset="100%" stopColor="#f5cc85" />
                </linearGradient>
              )}

              {isProcessed ? (
                <linearGradient id={unplayedGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#826998" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#826998" stopOpacity="0.4" />
                </linearGradient>
              ) : (
                <linearGradient id={unplayedGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#826998" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#826998" stopOpacity="0.4" />
                </linearGradient>
              )}
            </defs>

            {bars.map((normHeight, i) => {
              const barFraction = i / bars.length
              const isPlayed = barFraction <= progressFraction
              const maxAvailableHeight = viewBoxHeight - 6
              const barHeight = Math.max(3.5, Math.round(normHeight * maxAvailableHeight))
              const y = centerY - barHeight / 2
              const x = i * step + (step - barWidth) / 2

              return (
                <rect
                  key={i}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx={1.6}
                  ry={1.6}
                  fill={isPlayed ? `url(#${gradId})` : `url(#${unplayedGradId})`}
                  className="transition-all duration-75"
                />
              )
            })}

            {hoverPercent !== null && (
              <line
                x1={hoverPercent * viewBoxWidth}
                y1={0}
                x2={hoverPercent * viewBoxWidth}
                y2={viewBoxHeight}
                stroke="#c1b0d2"
                strokeWidth="1.2"
                strokeDasharray="3 3"
                opacity="0.6"
              />
            )}

            <g transform={`translate(${progressFraction * viewBoxWidth}, 0)`}>
              <line
                x1={0}
                y1={2}
                x2={0}
                y2={viewBoxHeight - 2}
                stroke="#f3ecff"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <circle cx={0} cy={3} r={3} fill="#f3ecff" />
              <circle cx={0} cy={viewBoxHeight - 3} r={3} fill="#f3ecff" />
            </g>
          </svg>
        </div>

        <div className="text-[10.5px] font-mono tabular-nums font-medium text-lira-ink shrink-0 w-16 text-right">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>
    </div>
  )
}
