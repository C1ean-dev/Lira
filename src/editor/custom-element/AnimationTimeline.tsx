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
    <div className="bg-[#18191c] rounded-2xl p-4 border border-[#2b2d31] space-y-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-bold text-slate-200">
            Linha do Tempo da Animação ({frames.length} quadros)
          </span>
        </div>

        <button
          type="button"
          onClick={onCaptureFrame}
          className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-600 to-rose-600 hover:from-amber-500 hover:to-rose-500 text-white font-bold text-xs shadow-md flex items-center gap-1.5 transition-all active:scale-95"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Salvar Estado Atual como Quadro</span>
        </button>
      </div>

      <div className="flex gap-4 items-center">
        <div className="flex-1 flex gap-2 overflow-x-auto pb-1 min-h-[72px] items-center p-2 bg-[#12151d] rounded-xl border border-[#2b2d31]">
          {frames.length === 0 ? (
            <div className="text-xs text-slate-500 px-3">
              Nenhum quadro animado capturado. Clique no botão ao lado para salvar o quadro 1!
            </div>
          ) : (
            frames.map((frameDataUrl, idx) => {
              const isSelected = selectedFrameIdx === idx
              return (
                <div
                  key={idx}
                  onClick={() => setSelectedFrameIdx(idx)}
                  className={`group relative p-1.5 rounded-xl border-2 flex flex-col items-center gap-1 cursor-pointer shrink-0 transition-all ${
                    isSelected
                      ? 'border-amber-500 bg-amber-500/20 ring-1 ring-amber-500/40'
                      : 'border-[#2b2d31] bg-[#18191c] hover:border-slate-600'
                  }`}
                >
                  <div className="w-12 h-12 flex items-center justify-center overflow-hidden rounded bg-[#12151d]">
                    <img
                      src={frameDataUrl}
                      alt={`Quadro ${idx + 1}`}
                      className="max-w-full max-h-full object-contain pixelated"
                    />
                  </div>
                  <span className="text-[10px] font-bold font-mono text-slate-300">
                    Q{idx + 1}
                  </span>

                  {frames.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteFrame(idx)
                      }}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-rose-600 text-white rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover:opacity-100 transition-opacity shadow"
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
          <div className="w-48 bg-[#12151d] p-2.5 rounded-xl border border-[#2b2d31] flex flex-col items-center gap-2 shrink-0">
            <div className="w-14 h-14 rounded-lg bg-[#18191c] border border-white/10 flex items-center justify-center overflow-hidden">
              <canvas ref={animCanvasRef} width={64} height={64} className="pixelated" />
            </div>

            <div className="flex items-center gap-2 w-full justify-between">
              <button
                type="button"
                onClick={() => setIsPlayingAnim(!isPlayingAnim)}
                className={`p-1.5 rounded-lg border text-xs font-bold flex items-center gap-1 transition-colors ${
                  isPlayingAnim
                    ? 'bg-amber-500 text-slate-900 border-amber-400'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {isPlayingAnim ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                <span>{isPlayingAnim ? 'Pausar' : 'Play'}</span>
              </button>

              <div className="text-[10px] font-mono text-slate-400">
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
              className="w-full h-1 bg-slate-800 rounded appearance-none cursor-pointer accent-amber-500"
            />
          </div>
        )}
      </div>
    </div>
  )
}
