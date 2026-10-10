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
      className={`rounded-xl p-3.5 border transition-all ${
        isProcessed
          ? 'bg-gradient-to-r from-emerald-950/40 via-[#131a24] to-[#101720] border-emerald-500/30 shadow-lg shadow-emerald-950/20'
          : 'bg-[#111622] border-slate-700/60 shadow-md'
      }`}
    >
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {isProcessed ? (
            <Sparkles className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <Mic className="w-4 h-4 text-pink-400 shrink-0" />
          )}
          <span className="text-xs font-bold text-slate-100 truncate">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              isProcessed
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                : 'bg-pink-500/20 text-pink-300 border border-pink-500/30'
            }`}
          >
            {badge}
          </span>

          {onApplySettings && applyLabel && (
            <button
              type="button"
              onClick={onApplySettings}
              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wide transition-all active:scale-95 shadow-sm shadow-emerald-600/30 cursor-pointer"
              title="Aplicar as configurações ouvidas nesta prévia"
            >
              {applyLabel}
            </button>
          )}
        </div>
      </div>

      {subtitle && (
        <div className="text-[10.5px] text-slate-400 mb-2.5 leading-tight">
          {subtitle}
        </div>
      )}

      <div className="flex items-center gap-3 bg-slate-950/90 rounded-xl p-2.5 border border-slate-800/90 shadow-inner">
        <button
          type="button"
          onClick={togglePlay}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-all shrink-0 active:scale-90 cursor-pointer shadow-md ${
            isProcessed
              ? 'bg-gradient-to-tr from-emerald-600 to-teal-400 hover:from-emerald-500 hover:to-teal-300 text-white shadow-emerald-600/40'
              : 'bg-gradient-to-tr from-rose-600 via-purple-600 to-cyan-400 hover:brightness-110 text-white shadow-purple-600/40'
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
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-200 hover:bg-slate-800/80 transition-colors cursor-pointer"
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
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="35%" stopColor="#14b8a6" />
                  <stop offset="70%" stopColor="#06b6d4" />
                  <stop offset="100%" stopColor="#3b82f6" />
                </linearGradient>
              ) : (
                <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#ff0055" />
                  <stop offset="25%" stopColor="#d9008f" />
                  <stop offset="50%" stopColor="#9d00ff" />
                  <stop offset="75%" stopColor="#4f46e5" />
                  <stop offset="100%" stopColor="#00f2fe" />
                </linearGradient>
              )}

              {isProcessed ? (
                <linearGradient id={unplayedGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#064e3b" stopOpacity="0.45" />
                  <stop offset="50%" stopColor="#0f766e" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0.4" />
                </linearGradient>
              ) : (
                <linearGradient id={unplayedGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#831843" stopOpacity="0.45" />
                  <stop offset="50%" stopColor="#581c87" stopOpacity="0.4" />
                  <stop offset="100%" stopColor="#164e63" stopOpacity="0.4" />
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
                stroke="#94a3b8"
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
                stroke="#ffffff"
                strokeWidth="2.5"
                strokeLinecap="round"
                style={{
                  filter: isProcessed
                    ? 'drop-shadow(0 0 6px rgba(16, 185, 129, 0.9))'
                    : 'drop-shadow(0 0 6px rgba(0, 242, 254, 0.9))',
                }}
              />
              <circle cx={0} cy={3} r={3} fill="#ffffff" />
              <circle cx={0} cy={viewBoxHeight - 3} r={3} fill="#ffffff" />
            </g>
          </svg>
        </div>

        <div className="text-[10.5px] font-mono font-medium text-slate-300 shrink-0 w-16 text-right tabular-nums">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>
    </div>
  )
}
