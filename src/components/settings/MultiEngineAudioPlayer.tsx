import React, { useState, useRef, useEffect, useId } from 'react'
import { Play, Pause, RotateCcw, Sparkles, Sliders, Cpu, Check, Feather } from 'lucide-react'
import { AudioProcessorMode } from '../../types/audio'

export interface EngineSampleData {
  audioUrl: string
  waveform?: number[]
}

interface Props {
  recommendedMode: AudioProcessorMode
  recommendedSensitivity: number
  activeMode: AudioProcessorMode
  samples: {
    classic: EngineSampleData
    soft: EngineSampleData
    rnnoise: EngineSampleData
  }
  onApplyEngine: (mode: AudioProcessorMode) => void
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

const ENGINES: {
  id: AudioProcessorMode
  name: string
  desc: string
  icon: React.ComponentType<{ className?: string }>
}[] = [
  {
    id: 'classic',
    name: 'DSP Clássico',
    desc: 'Filtro Passa-Altas + Hard Gate',
    icon: Sliders,
  },
  {
    id: 'soft',
    name: 'DSP Suave',
    desc: 'Expansor Dinâmico Natural',
    icon: Feather,
  },
  {
    id: 'rnnoise',
    name: 'RNNoise Neural',
    desc: 'IA WebAssembly (Anti-Ruído)',
    icon: Cpu,
  },
]

export const MultiEngineAudioPlayer: React.FC<Props> = ({
  recommendedMode,
  recommendedSensitivity,
  activeMode,
  samples,
  onApplyEngine,
}) => {
  const [playingEngine, setPlayingEngine] = useState<AudioProcessorMode | null>(null)
  const [currentPlayTime, setCurrentPlayTime] = useState(0)
  const [durations, setDurations] = useState<Record<AudioProcessorMode, number>>({
    classic: 5,
    soft: 5,
    rnnoise: 5,
  })
  const [hoverScrubber, setHoverScrubber] = useState<{
    engine: AudioProcessorMode
    percent: number
  } | null>(null)

  const classicRef = useRef<HTMLAudioElement | null>(null)
  const softRef = useRef<HTMLAudioElement | null>(null)
  const rnnoiseRef = useRef<HTMLAudioElement | null>(null)

  const baseId = useId().replace(/:/g, '')

  const getAudioRef = (id: AudioProcessorMode) => {
    if (id === 'classic') return classicRef
    if (id === 'soft') return softRef
    return rnnoiseRef
  }

  useEffect(() => {
    return () => {
      classicRef.current?.pause()
      softRef.current?.pause()
      rnnoiseRef.current?.pause()
    }
  }, [])

  const togglePlay = (engine: AudioProcessorMode) => {
    const targetAudio = getAudioRef(engine).current
    if (!targetAudio) return

    if (playingEngine === engine) {
      targetAudio.pause()
      setPlayingEngine(null)
    } else {
      ENGINES.forEach(({ id }) => {
        if (id !== engine) {
          const other = getAudioRef(id).current
          if (other) other.pause()
        }
      })

      const dur = durations[engine] || 5
      const syncTime =
        currentPlayTime > 0 && currentPlayTime < dur - 0.1
          ? currentPlayTime
          : 0

      targetAudio.currentTime = syncTime
      targetAudio
        .play()
        .then(() => {
          setPlayingEngine(engine)
          setCurrentPlayTime(syncTime)
        })
        .catch((err) => {
          console.warn('[MultiEngine] Play error:', err)
          setPlayingEngine(null)
        })
    }
  }

  const handleSeek = (
    engine: AudioProcessorMode,
    e: React.MouseEvent<SVGSVGElement>
  ) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percent = Math.max(0, Math.min(1, clickX / rect.width))
    const dur = durations[engine] || 5
    const newTime = percent * dur

    setCurrentPlayTime(newTime)

    const audio = getAudioRef(engine).current
    if (audio) {
      audio.currentTime = newTime
    }

    ENGINES.forEach(({ id }) => {
      if (id !== engine) {
        const other = getAudioRef(id).current
        if (other) other.currentTime = newTime
      }
    })
  }

  const handleRestart = (engine: AudioProcessorMode) => {
    ENGINES.forEach(({ id }) => {
      if (id !== engine) {
        const other = getAudioRef(id).current
        if (other) other.pause()
      }
    })

    const audio = getAudioRef(engine).current
    if (!audio) return
    audio.currentTime = 0
    setCurrentPlayTime(0)
    audio
      .play()
      .then(() => setPlayingEngine(engine))
      .catch(() => {})
  }

  const viewBoxWidth = 500
  const viewBoxHeight = 28
  const centerY = viewBoxHeight / 2

  return (
    <div className="rounded-xl p-3 border bg-gradient-to-r from-emerald-950/40 via-[#131a24] to-[#101720] border-emerald-500/30 shadow-lg shadow-emerald-950/20 space-y-2.5">
      <audio
        ref={classicRef}
        src={samples.classic.audioUrl}
        preload="metadata"
        onTimeUpdate={() => {
          if (playingEngine === 'classic' && classicRef.current) {
            setCurrentPlayTime(classicRef.current.currentTime)
          }
        }}
        onLoadedMetadata={() => {
          const d = classicRef.current?.duration
          if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
            setDurations((prev) => ({ ...prev, classic: d }))
          }
        }}
        onEnded={() => {
          if (playingEngine === 'classic') {
            setPlayingEngine(null)
            setCurrentPlayTime(0)
          }
        }}
      />
      <audio
        ref={softRef}
        src={samples.soft.audioUrl}
        preload="metadata"
        onTimeUpdate={() => {
          if (playingEngine === 'soft' && softRef.current) {
            setCurrentPlayTime(softRef.current.currentTime)
          }
        }}
        onLoadedMetadata={() => {
          const d = softRef.current?.duration
          if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
            setDurations((prev) => ({ ...prev, soft: d }))
          }
        }}
        onEnded={() => {
          if (playingEngine === 'soft') {
            setPlayingEngine(null)
            setCurrentPlayTime(0)
          }
        }}
      />
      <audio
        ref={rnnoiseRef}
        src={samples.rnnoise.audioUrl}
        preload="metadata"
        onTimeUpdate={() => {
          if (playingEngine === 'rnnoise' && rnnoiseRef.current) {
            setCurrentPlayTime(rnnoiseRef.current.currentTime)
          }
        }}
        onLoadedMetadata={() => {
          const d = rnnoiseRef.current?.duration
          if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
            setDurations((prev) => ({ ...prev, rnnoise: d }))
          }
        }}
        onEnded={() => {
          if (playingEngine === 'rnnoise') {
            setPlayingEngine(null)
            setCurrentPlayTime(0)
          }
        }}
      />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-xs font-bold text-slate-100 truncate">
            Como vai ficar com as alterações (3 Motores)
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            Comparação A/B/C
          </span>
          <span className="text-[9px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-slate-800/80 border border-slate-700/60">
            Gate: {recommendedSensitivity}%
          </span>
        </div>
      </div>

      <div className="text-[10px] text-slate-400 leading-tight">
        Ouça a mesma gravação tratada individualmente por cada motor de supressão com o Noise Gate calibrado:
      </div>

      <div className="bg-slate-950/90 rounded-xl p-1.5 border border-slate-800/90 shadow-inner divide-y divide-slate-800/60">
        {ENGINES.map(({ id, name, desc, icon: Icon }) => {
          const isPlayingThis = playingEngine === id
          const isRecommended = recommendedMode === id
          const isActive = activeMode === id
          const trackDuration = durations[id] || 5
          const progressFraction = trackDuration > 0 ? currentPlayTime / trackDuration : 0
          const sampleData = samples[id]
          const waveform =
            sampleData?.waveform && sampleData.waveform.length > 0
              ? sampleData.waveform
              : Array.from({ length: 60 }, (_, i) => {
                  const ripple = Math.sin(i * 0.35) * 0.12 + Math.cos(i * 0.8) * 0.08
                  return Math.max(0.08, 0.18 + ripple)
                })

          const step = viewBoxWidth / waveform.length
          const barWidth = 2.4
          const playedGradId = `multi-played-${id}-${baseId}`
          const unplayedGradId = `multi-unplayed-${id}-${baseId}`

          return (
            <div
              key={id}
              className={`py-1.5 px-2 flex items-center gap-2.5 transition-colors rounded-lg ${
                isPlayingThis
                  ? 'bg-emerald-950/30'
                  : 'hover:bg-slate-900/50'
              }`}
            >
              <div className="w-28 shrink-0 flex flex-col justify-center">
                <div className="flex items-center gap-1">
                  <Icon className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="text-[10.5px] font-bold text-slate-200 truncate">
                    {name}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[8.5px] text-slate-400 truncate">
                    {desc}
                  </span>
                  {isRecommended && (
                    <span className="text-[7.5px] font-bold uppercase tracking-wider px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                      ★ Sugerido
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => togglePlay(id)}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-all shrink-0 active:scale-90 cursor-pointer shadow-sm ${
                  isPlayingThis
                    ? 'bg-gradient-to-tr from-emerald-500 to-teal-400 text-white shadow-emerald-500/40 animate-pulse'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700/60'
                }`}
                title={isPlayingThis ? `Pausar ${name}` : `Ouvir com ${name}`}
              >
                {isPlayingThis ? (
                  <Pause className="w-3 h-3 fill-current" />
                ) : (
                  <Play className="w-3 h-3 fill-current translate-x-0.5" />
                )}
              </button>

              <button
                type="button"
                onClick={() => handleRestart(id)}
                className="p-1 text-slate-500 hover:text-slate-300 transition-colors shrink-0 cursor-pointer"
                title="Reiniciar do começo"
              >
                <RotateCcw className="w-3 h-3" />
              </button>

              <div className="flex-1 h-7 flex items-center relative select-none">
                <svg
                  viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
                  preserveAspectRatio="none"
                  className="w-full h-full cursor-pointer overflow-visible"
                  onClick={(e) => handleSeek(id, e)}
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const clickX = e.clientX - rect.left
                    setHoverScrubber({
                      engine: id,
                      percent: Math.max(0, Math.min(1, clickX / rect.width)),
                    })
                  }}
                  onMouseLeave={() => setHoverScrubber(null)}
                >
                  <defs>
                    <linearGradient id={playedGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#10b981" />
                      <stop offset="35%" stopColor="#14b8a6" />
                      <stop offset="70%" stopColor="#06b6d4" />
                      <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>
                    <linearGradient id={unplayedGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#064e3b" stopOpacity="0.45" />
                      <stop offset="50%" stopColor="#0f766e" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0.4" />
                    </linearGradient>
                  </defs>

                  {waveform.map((normHeight, idx) => {
                    const barFraction = idx / waveform.length
                    const isPlayed = isPlayingThis && barFraction <= progressFraction
                    const maxH = viewBoxHeight - 4
                    const barHeight = Math.max(3, Math.round(normHeight * maxH))
                    const y = centerY - barHeight / 2
                    const x = idx * step + (step - barWidth) / 2

                    return (
                      <rect
                        key={idx}
                        x={x}
                        y={y}
                        width={barWidth}
                        height={barHeight}
                        rx={1.2}
                        ry={1.2}
                        fill={isPlayed ? `url(#${playedGradId})` : `url(#${unplayedGradId})`}
                        className="transition-all duration-75"
                      />
                    )
                  })}

                  {hoverScrubber && hoverScrubber.engine === id && (
                    <line
                      x1={hoverScrubber.percent * viewBoxWidth}
                      y1={0}
                      x2={hoverScrubber.percent * viewBoxWidth}
                      y2={viewBoxHeight}
                      stroke="#94a3b8"
                      strokeWidth="1"
                      strokeDasharray="2 2"
                      opacity="0.6"
                    />
                  )}

                  {isPlayingThis && (
                    <g transform={`translate(${progressFraction * viewBoxWidth}, 0)`}>
                      <line
                        x1={0}
                        y1={1}
                        x2={0}
                        y2={viewBoxHeight - 1}
                        stroke="#ffffff"
                        strokeWidth="2"
                        strokeLinecap="round"
                        style={{
                          filter: 'drop-shadow(0 0 4px rgba(16, 185, 129, 0.9))',
                        }}
                      />
                    </g>
                  )}
                </svg>
              </div>

              <div className="text-[9.5px] font-mono font-medium text-slate-400 shrink-0 w-14 text-right tabular-nums">
                {formatTime(isPlayingThis ? currentPlayTime : 0)} / {formatTime(trackDuration)}
              </div>

              <div className="shrink-0 w-20 flex justify-end">
                {isActive ? (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                    <Check className="w-2.5 h-2.5" />
                    <span>Em Uso</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onApplyEngine(id)}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[9.5px] font-bold uppercase tracking-wide transition-all active:scale-95 shadow-sm shadow-emerald-600/30 cursor-pointer"
                    title={`Definir ${name} como o motor ativo`}
                  >
                    Aplicar
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
