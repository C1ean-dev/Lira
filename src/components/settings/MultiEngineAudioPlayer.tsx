import React, { useState, useRef, useEffect, useId } from 'react'
import { Play, Pause, RotateCcw, Sparkles, Sliders, Cpu, Check } from 'lucide-react'
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
    deepfilter: EngineSampleData
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
    id: 'deepfilter',
    name: 'DeepFilterNet',
    desc: 'O melhor, porém mais lento, com fallback para RNNoise',
    icon: Sparkles,
  },
  {
    id: 'rnnoise',
    name: 'RNNoise Neural',
    desc: 'Rápido e eficiente',
    icon: Cpu,
  },
  {
    id: 'classic',
    name: 'DSP Clássico',
    desc: 'Filtro Passa-Altas + Hard Gate',
    icon: Sliders,
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
    deepfilter: 5,
    rnnoise: 5,
  })
  const [hoverScrubber, setHoverScrubber] = useState<{
    engine: AudioProcessorMode
    percent: number
  } | null>(null)

  const classicRef = useRef<HTMLAudioElement | null>(null)
  const deepFilterRef = useRef<HTMLAudioElement | null>(null)
  const rnnoiseRef = useRef<HTMLAudioElement | null>(null)

  const baseId = useId().replace(/:/g, '')

  const getAudioRef = (id: AudioProcessorMode) => {
    if (id === 'classic') return classicRef
    if (id === 'deepfilter') return deepFilterRef
    return rnnoiseRef
  }

  useEffect(() => {
    return () => {
      classicRef.current?.pause()
      deepFilterRef.current?.pause()
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
    <div className="rounded-[8px] p-3 border bg-lira-surface border-lira-online/40 space-y-2.5 font-mono">
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
        ref={deepFilterRef}
        src={samples.deepfilter.audioUrl}
        preload="metadata"
        onTimeUpdate={() => {
          if (playingEngine === 'deepfilter' && deepFilterRef.current) {
            setCurrentPlayTime(deepFilterRef.current.currentTime)
          }
        }}
        onLoadedMetadata={() => {
          const d = deepFilterRef.current?.duration
          if (typeof d === 'number' && Number.isFinite(d) && d > 0) {
            setDurations((prev) => ({ ...prev, deepfilter: d }))
          }
        }}
        onEnded={() => {
          if (playingEngine === 'deepfilter') {
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
          <Sparkles className="w-3.5 h-3.5 text-lira-online shrink-0" />
          <span className="text-xs font-bold text-lira-ink truncate">
            Como vai ficar com as alterações (3 Motores)
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-[6px] bg-lira-online/15 text-lira-online border border-lira-online/30">
            Comparação A/B/C
          </span>
          <span className="text-[9px] font-mono tabular-nums text-lira-muted px-1.5 py-0.5 rounded-[4px] bg-lira-panel border border-lira-quiet">
            Gate: {recommendedSensitivity}%
          </span>
        </div>
      </div>

      <div className="text-[10px] text-lira-muted leading-tight">
        Ouça a mesma gravação tratada individualmente por cada motor de supressão com o Noise Gate calibrado:
      </div>

      <div className="bg-lira-ground rounded-[8px] p-1.5 border border-lira-quiet divide-y divide-lira-quiet">
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
              className={`py-1.5 px-2 flex items-center gap-2.5 transition-colors rounded-[6px] ${
                isPlayingThis
                  ? 'bg-lira-surface'
                  : 'hover:bg-lira-panel'
              }`}
            >
              <div className="w-28 shrink-0 flex flex-col justify-center">
                <div className="flex items-center gap-1">
                  <Icon className="w-3 h-3 text-lira-online shrink-0" />
                  <span className="text-[10.5px] font-bold text-lira-ink truncate">
                    {name}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[8.5px] text-lira-muted truncate">
                    {desc}
                  </span>
                  {isRecommended && (
                    <span className="text-[7.5px] font-bold uppercase tracking-wider px-1 py-0.2 rounded-[4px] bg-lira-amber/15 text-lira-amber border border-lira-amber/30 shrink-0">
                      ★ Sugerido
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => togglePlay(id)}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors shrink-0 cursor-pointer border ${
                  isPlayingThis
                    ? 'bg-lira-online text-lira-ground border-lira-online animate-pulse'
                    : 'bg-lira-panel hover:bg-lira-surface text-lira-ink border-lira-rule'
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
                className="p-1 text-lira-muted hover:text-lira-ink transition-colors shrink-0 cursor-pointer"
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
                      <stop offset="0%" stopColor="#b9e99f" />
                      <stop offset="100%" stopColor="#d1b5ff" />
                    </linearGradient>
                    <linearGradient id={unplayedGradId} x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#826998" stopOpacity="0.45" />
                      <stop offset="100%" stopColor="#826998" stopOpacity="0.4" />
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
                      stroke="#c1b0d2"
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
                        stroke="#f3ecff"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </g>
                  )}
                </svg>
              </div>

              <div className="text-[9.5px] font-mono tabular-nums font-medium text-lira-muted shrink-0 w-14 text-right">
                {formatTime(isPlayingThis ? currentPlayTime : 0)} / {formatTime(trackDuration)}
              </div>

              <div className="shrink-0 w-20 flex justify-end">
                {isActive ? (
                  <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-[6px] bg-lira-online/15 text-lira-online border border-lira-online/30 flex items-center gap-1">
                    <Check className="w-2.5 h-2.5" />
                    <span>Em Uso</span>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onApplyEngine(id)}
                    className="px-2.5 py-1 rounded-[6px] bg-lira-online hover:bg-lira-ink text-lira-ground text-[9.5px] font-mono font-bold uppercase tracking-wide transition-colors cursor-pointer"
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

