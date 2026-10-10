import React, { useRef, useEffect } from 'react'
import {
  Shield,
  Brush,
  RotateCcw,
  CheckSquare,
  Move,
  Eye,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Copy,
  FlipHorizontal,
} from 'lucide-react'
import { CustomAssetType } from '../../types/customAsset'
import { Direction } from '../../types/game'

export interface CompositeLayer {
  id: string
  clipId: string
  name: string
  dataUrl: string
  x: number
  y: number
  width: number
  height: number
  origWidth?: number
  origHeight?: number
  flipH: boolean
  opacity: number
}

interface Props {
  elementType: CustomAssetType
  tileWidth: number
  tileHeight: number
  pixelWidth?: number
  pixelHeight?: number
  setBoardSizeInTiles: (w: number, h: number) => void
  composeCanvasRef: React.RefObject<HTMLCanvasElement>
  composeTool: 'move' | 'collision'
  setComposeTool: (tool: 'move' | 'collision') => void
  composeZoom: number
  setComposeZoom: (z: number | ((prev: number) => number)) => void
  showCollisionOverlay: boolean
  setShowCollisionOverlay: (show: boolean) => void
  collisionGrid: boolean[][]
  onSetAllCollision: (solid: boolean) => void
  onSetBottomHalfCollision: () => void
  onFitLayersToBoard?: () => void
  onComposeMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void
  onComposeMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void
  onComposeMouseUp: () => void
  activeDirection?: Direction
  onSelectDirection?: (dir: Direction) => void
  directionalFramesCount?: Record<Direction, number>
  directionalDimensions?: Partial<Record<Direction, { tileWidth: number; tileHeight: number; pixelWidth?: number; pixelHeight?: number }>>
  onCopyFromDownDirection?: () => void
  onAutoMirrorLeftRight?: () => void
}

export const CompositionStudio: React.FC<Props> = ({
  elementType,
  tileWidth,
  tileHeight,
  pixelWidth = tileWidth * 32,
  pixelHeight = tileHeight * 32,
  setBoardSizeInTiles,
  composeCanvasRef,
  composeTool,
  setComposeTool,
  composeZoom,
  setComposeZoom,
  showCollisionOverlay,
  setShowCollisionOverlay,
  collisionGrid,
  onSetAllCollision,
  onSetBottomHalfCollision,
  onFitLayersToBoard,
  onComposeMouseDown,
  onComposeMouseMove,
  onComposeMouseUp,
  activeDirection = 'down',
  onSelectDirection,
  directionalFramesCount,
  directionalDimensions,
  onCopyFromDownDirection,
  onAutoMirrorLeftRight,
}) => {
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        if (e.deltaY < 0) {
          setComposeZoom((z) => Math.min(24, z >= 4 ? z + 2 : z + 1))
        } else if (e.deltaY > 0) {
          setComposeZoom((z) => Math.max(1, z <= 4 ? z - 1 : z - 2))
        }
      }
    }

    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      stage.removeEventListener('wheel', handleWheel)
    }
  }, [setComposeZoom])

  return (
    <div className="flex-1 flex flex-col bg-[#12151d] rounded-2xl border border-[#2b2d31] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#2b2d31] bg-[#18191c]/80 shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-300">Tamanho no Mapa:</span>
          <div className="flex items-center gap-2 bg-[#12151d] px-2.5 py-1 rounded-xl border border-[#2b2d31]">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-semibold">Largura:</span>
              <input
                type="number"
                min={1}
                max={32}
                value={tileWidth}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val)) {
                    setBoardSizeInTiles(val, tileHeight)
                  }
                }}
                className="w-12 bg-[#18191c] border border-[#2b2d31] rounded-lg px-1.5 py-0.5 text-xs font-bold text-center text-white focus:outline-none focus:border-indigo-500"
              />
              <span className="text-[10px] text-slate-400 font-mono">
                ({pixelWidth ? `${pixelWidth}px` : `${tileWidth * 32}px`})
              </span>
            </div>

            <span className="text-slate-600 font-bold">×</span>

            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400 font-semibold">Altura:</span>
              <input
                type="number"
                min={1}
                max={32}
                value={tileHeight}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val)) {
                    setBoardSizeInTiles(tileWidth, val)
                  }
                }}
                className="w-12 bg-[#18191c] border border-[#2b2d31] rounded-lg px-1.5 py-0.5 text-xs font-bold text-center text-white focus:outline-none focus:border-indigo-500"
              />
              <span className="text-[10px] text-slate-400 font-mono">
                ({pixelHeight ? `${pixelHeight}px` : `${tileHeight * 32}px`})
              </span>
            </div>
          </div>

          <span className="text-xs font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-lg border border-emerald-800/60 font-mono">
            {pixelWidth}×{pixelHeight}px
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex bg-[#12151d] p-1 rounded-xl border border-[#2b2d31]">
            <button
              type="button"
              onClick={() => setComposeTool('move')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                composeTool === 'move'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Move className="w-3.5 h-3.5" />
              <span>Mover Peças</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setComposeTool('collision')
                setShowCollisionOverlay(true)
              }}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 ${
                composeTool === 'collision'
                  ? 'bg-rose-600 text-white shadow animate-pulse'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Brush className="w-3.5 h-3.5" />
              <span>Pintar Colisão (Tiles)</span>
            </button>
          </div>

          {onFitLayersToBoard && (
            <button
              type="button"
              onClick={onFitLayersToBoard}
              className="px-2.5 py-1 text-xs font-bold rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 hover:border-indigo-400 transition-all flex items-center gap-1.5"
              title="Ajustar e centralizar camadas proporcionalmente ao tamanho atual da mesa"
            >
              <Maximize2 className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Ajustar à Mesa</span>
            </button>
          )}

          <div className="flex items-center gap-1 bg-[#12151d] p-1 rounded-xl border border-[#2b2d31]">
            <button
              type="button"
              onClick={() => setComposeZoom((z) => Math.max(1, z <= 4 ? z - 1 : z - 2))}
              className="p-1 rounded text-slate-300 hover:text-white hover:bg-[#2b2d31]"
              title="Reduzir Zoom"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono font-bold text-slate-300 px-1 min-w-[24px] text-center">
              {composeZoom}x
            </span>
            <button
              type="button"
              onClick={() => setComposeZoom((z) => Math.min(24, z >= 4 ? z + 2 : z + 1))}
              className="p-1 rounded text-slate-300 hover:text-white hover:bg-[#2b2d31]"
              title="Aumentar Zoom (até 24x)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setComposeZoom(pixelWidth <= 16 || pixelHeight <= 16 ? 8 : 2)}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-300 hover:text-white hover:bg-[#2b2d31]"
              title="Resetar Zoom"
            >
              Reset
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowCollisionOverlay(!showCollisionOverlay)}
            className={`p-1.5 rounded-xl border transition-colors ${
              showCollisionOverlay
                ? 'bg-rose-600/20 border-rose-500 text-rose-400'
                : 'bg-[#12151d] border-[#2b2d31] text-slate-400 hover:text-white'
            }`}
            title="Exibir/Ocultar grade de colisão vermelha"
          >
            <Eye className="w-4 h-4" />
          </button>
        </div>
      </div>

      {elementType === 'furniture' && (
        <div className="flex items-center justify-between px-4 py-2 bg-[#14161f] border-b border-[#2b2d31] shrink-0 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-300">Direção do Móvel:</span>
            <div className="flex bg-[#18191c] p-1 rounded-xl border border-[#2b2d31] gap-1">
              {(
                [
                  { dir: 'down' as Direction, label: '⬇️ Frente' },
                  { dir: 'left' as Direction, label: '⬅️ Esquerda' },
                  { dir: 'up' as Direction, label: '⬆️ Costas' },
                  { dir: 'right' as Direction, label: '➡️ Direita' },
                ]
              ).map((d) => {
                const isSelected = activeDirection === d.dir
                const count = directionalFramesCount?.[d.dir] || 0
                const dirDim = directionalDimensions?.[d.dir]
                const dimLabel = dirDim
                  ? `${dirDim.tileWidth}×${dirDim.tileHeight}`
                  : isSelected
                  ? `${tileWidth}×${tileHeight}`
                  : '2×2'
                return (
                  <button
                    key={d.dir}
                    type="button"
                    onClick={() => onSelectDirection?.(d.dir)}
                    className={`px-3 py-1 text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-600 text-white shadow'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-[#2b2d31]/50'
                    }`}
                  >
                    <span>{d.label}</span>
                    <span className={`text-[10px] font-mono px-1 py-0.2 rounded ${
                      isSelected ? 'text-indigo-200 bg-indigo-700/50' : 'text-slate-500 bg-black/20'
                    }`}>
                      {dimLabel}
                    </span>
                    {count > 0 && (
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                          isSelected
                            ? 'bg-indigo-800 text-indigo-100'
                            : 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                        }`}
                        title={`${count} quadro(s) configurado(s)`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeDirection !== 'down' && onCopyFromDownDirection && (
              <button
                type="button"
                onClick={onCopyFromDownDirection}
                className="px-2.5 py-1 text-xs font-bold rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all flex items-center gap-1.5 cursor-pointer"
                title="Copiar as camadas da visão de Frente (⬇️) para esta direção"
              >
                <Copy className="w-3.5 h-3.5 text-indigo-400" />
                <span>Copiar da Frente</span>
              </button>
            )}

            {(activeDirection === 'left' || activeDirection === 'right') && onAutoMirrorLeftRight && (
              <button
                type="button"
                onClick={onAutoMirrorLeftRight}
                className="px-2.5 py-1 text-xs font-bold rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 transition-all flex items-center gap-1.5 cursor-pointer"
                title="Espelhar horizontalmente as peças na mesa de composição"
              >
                <FlipHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                <span>Espelhar ⬅️ ↔ ➡️</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div ref={stageRef} className="flex-1 overflow-auto p-6 bg-[#0e1015] relative flex">
        <div className="m-auto relative border-2 border-indigo-500/50 rounded-2xl shadow-2xl overflow-hidden bg-[#18191c]/90 shrink-0">
          <canvas
            ref={composeCanvasRef}
            onMouseDown={onComposeMouseDown}
            onMouseMove={onComposeMouseMove}
            onMouseUp={onComposeMouseUp}
            className={`pixelated ${
              composeTool === 'collision' ? 'cursor-crosshair' : 'cursor-move'
            }`}
          />
        </div>
      </div>

      {elementType === 'furniture' && composeTool === 'collision' && (
        <div className="p-3 bg-[#18191c] border-t border-[#2b2d31] flex items-center justify-between shrink-0 animate-in fade-in duration-150">
          <div className="flex items-center gap-2 text-xs text-rose-300">
            <Shield className="w-4 h-4 text-rose-400" />
            <span>
              Clique ou arraste nos blocos do quadro para pintar/limpar a barreira física onde os avatares não passam.
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSetBottomHalfCollision}
              className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-200 border border-slate-700 transition-colors"
            >
              Base Inferior (Padrão)
            </button>
            <button
              type="button"
              onClick={() => onSetAllCollision(true)}
              className="px-3 py-1 rounded-xl bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/40 text-xs font-bold transition-colors flex items-center gap-1"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>Bloquear Tudo</span>
            </button>
            <button
              type="button"
              onClick={() => onSetAllCollision(false)}
              className="px-3 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 border border-slate-700 transition-colors flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Limpar Tudo</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
