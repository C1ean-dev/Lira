import { RasterImage } from '../../components/common/RasterImage'
import React from 'react'
import {
  Sparkles,
  Plus,
  Play,
  Pause,
  Trash2,
} from 'lucide-react'

interface Props {
  frames: string[]
  selectedFrameIdx: number | null
  setSelectedFrameIdx: (idx: number) => void
  onCaptureFrame: () => void
  onDeleteFrame: (idx: number) => void
  isPlayingAnim: boolean
  setIsPlayingAnim: (play: boolean) => void
  frameRateMs: number
  setFrameRateMs: (ms: number) => void
  animCanvasRef: React.RefObject<HTMLCanvasElement>
}

export const AnimationTimeline: React.FC<Props> = ({
  frames,
  selectedFrameIdx,
  setSelectedFrameIdx,
  onCaptureFrame,
  onDeleteFrame,
  isPlayingAnim,
  setIsPlayingAnim,
  frameRateMs,
  setFrameRateMs,
  animCanvasRef,
}) => {
  return (
    <div className="bg-lira-panel rounded-[12px] p-4 border border-lira-quiet space-y-3.5 font-mono text-lira-ink">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-lira-amber" />
          <span className="text-xs font-display font-bold text-lira-accent">
            Linha do Tempo da Animação ({frames.length} quadros)
          </span>
        </div>

        <button
          type="button"
          onClick={onCaptureFrame}
          className="px-3 py-1.5 rounded-[8px] bg-lira-accent hover:bg-lira-ink text-lira-ground font-mono font-bold text-xs border-2 border-lira-accent hover:border-lira-ink flex items-center gap-1.5 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Salvar Estado Atual como Quadro</span>
        </button>
      </div>

      <div className="flex gap-4 items-center">
        <div className="flex-1 flex gap-2 overflow-x-auto pb-1 min-h-[72px] items-center p-2 bg-lira-ground rounded-[8px] border border-lira-quiet">
          {frames.length === 0 ? (
            <div className="text-xs font-mono text-lira-muted px-3">
              Nenhum quadro animado capturado. Clique no botão ao lado para salvar o quadro 1!
            </div>
          ) : (
            frames.map((frameDataUrl, idx) => {
              const isSelected = selectedFrameIdx === idx
              return (
                <div
                  key={idx}
                  onClick={() => setSelectedFrameIdx(idx)}
                  className={`group relative p-1.5 rounded-[8px] border-2 flex flex-col items-center gap-1 cursor-pointer shrink-0 transition-colors ${
                    isSelected
                      ? 'border-lira-accent bg-lira-surface'
                      : 'border-lira-quiet bg-lira-panel hover:border-lira-rule'
                  }`}
                >
                  <div className="w-12 h-12 flex items-center justify-center overflow-hidden rounded bg-lira-ground">
                    <RasterImage
                      src={frameDataUrl}
                      alt={`Quadro ${idx + 1}`}
                      className="max-w-full max-h-full object-contain pixelated"
                    />
                  </div>
                  <span className="text-[10px] font-bold font-mono text-lira-ink">
                    Q{idx + 1}
                  </span>

                  {frames.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteFrame(idx)
                      }}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-lira-error text-lira-ground rounded-full flex items-center justify-center text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Excluir Quadro"
                    >
                      ×
                    </button>
                  )}
                </div>
              )
            })
          )}
        </div>

        {frames.length > 1 && (
          <div className="w-48 bg-lira-ground p-2.5 rounded-[8px] border border-lira-quiet flex flex-col items-center gap-2 shrink-0">
            <div className="w-14 h-14 rounded-[6px] bg-lira-panel border border-lira-quiet flex items-center justify-center overflow-hidden">
              <canvas ref={animCanvasRef} width={64} height={64} className="pixelated" />
            </div>

            <div className="flex items-center gap-2 w-full justify-between">
              <button
                type="button"
                onClick={() => setIsPlayingAnim(!isPlayingAnim)}
                className={`p-1.5 rounded-[6px] border text-xs font-mono font-bold flex items-center gap-1 transition-colors ${
                  isPlayingAnim
                    ? 'bg-lira-amber text-lira-ground border-lira-amber'
                    : 'bg-lira-surface text-lira-muted border-lira-rule hover:text-lira-ink'
                }`}
              >
                {isPlayingAnim ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{isPlayingAnim ? 'Pausar' : 'Play'}</span>
              </button>

              <div className="text-[10px] font-mono text-lira-muted tabular-nums">
                {Math.round(1000 / frameRateMs)} FPS
              </div>
            </div>

            <input
              type="range"
              min={60}
              max={500}
              step={20}
              value={frameRateMs}
              onChange={(e) => setFrameRateMs(Number(e.target.value))}
              className="w-full h-1 bg-lira-surface rounded appearance-none cursor-pointer accent-[#d1b5ff]"
            />
          </div>
        )}
      </div>
    </div>
  )
}
