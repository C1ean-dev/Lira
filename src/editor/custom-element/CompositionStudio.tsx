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
import { CustomAssetType, type PreservedDrawingRaster } from '../../types/customAsset'
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
  preservedRaster?: PreservedDrawingRaster
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
  composeTool: 'move' | 'collision' | 'seat'
  setComposeTool: (tool: 'move' | 'collision' | 'seat') => void
  composeZoom: number
  setComposeZoom: (z: number | ((prev: number) => number)) => void
  showCollisionOverlay: boolean
  setShowCollisionOverlay: (show: boolean) => void
  collisionGrid: boolean[][]
  onSetAllCollision: (solid: boolean) => void
  onSetBottomHalfCollision: () => void
  onClearSeats?: () => void
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
  onClearSeats,
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
    <div className="flex-1 flex flex-col bg-lira-ground rounded-[12px] border border-lira-quiet overflow-hidden font-mono text-lira-ink">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-dashed border-lira-rule/60 bg-lira-sidebar shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-1.5">
          <div className="flex bg-lira-ground p-1 rounded-[8px] border border-lira-quiet">
            <button
              type="button"
              onClick={() => setComposeTool('move')}
              className={`px-3 py-1 text-xs font-mono font-bold rounded-[6px] transition-colors flex items-center gap-1.5 ${
                composeTool === 'move'
                  ? 'bg-lira-accent text-lira-ground'
                  : 'text-lira-muted hover:text-lira-ink'
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
              className={`px-3 py-1 text-xs font-mono font-bold rounded-[6px] transition-colors flex items-center gap-1.5 ${
                composeTool === 'collision'
                  ? 'bg-lira-error text-lira-ground'
                  : 'text-lira-muted hover:text-lira-ink'
              }`}
            >
              <Brush className="w-3.5 h-3.5" />
              <span>Pintar Colisão (Tiles)</span>
            </button>
            {elementType === 'furniture' && (
              <button
                type="button"
                onClick={() => { setComposeTool('seat'); setShowCollisionOverlay(true) }}
                className={`px-3 py-1 text-xs font-mono font-bold rounded-[6px] flex items-center gap-1.5 ${
                  composeTool === 'seat' ? 'bg-lira-online text-lira-ground' : 'text-lira-muted hover:text-lira-ink'
                }`}
                title="Pinte as hitboxes onde o player pode sentar"
              >
                <Brush className="w-3.5 h-3.5" />
                <span>Pintar Assento</span>
              </button>
            )}
          </div>

          {onFitLayersToBoard && (
            <button
              type="button"
              onClick={onFitLayersToBoard}
              className="px-2.5 py-1 text-xs font-mono font-bold rounded-[8px] bg-lira-surface hover:border-lira-accent text-lira-accent border border-lira-rule transition-colors flex items-center gap-1.5"
              title="Ajustar e centralizar camadas proporcionalmente ao tamanho atual da mesa"
            >
              <Maximize2 className="w-3.5 h-3.5 text-lira-accent" />
              <span className="hidden sm:inline">Ajustar à Mesa</span>
            </button>
          )}

          <div className="flex items-center gap-1 bg-lira-ground p-1 rounded-[8px] border border-lira-quiet">
            <button
              type="button"
              onClick={() => setComposeZoom((z) => Math.max(1, z <= 4 ? z - 1 : z - 2))}
              className="p-1 rounded text-lira-muted hover:text-lira-ink hover:bg-lira-surface"
              title="Reduzir Zoom"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono font-bold text-lira-ink px-1 min-w-[24px] text-center tabular-nums">
              {composeZoom}x
            </span>
            <button
              type="button"
              onClick={() => setComposeZoom((z) => Math.min(24, z >= 4 ? z + 2 : z + 1))}
              className="p-1 rounded text-lira-muted hover:text-lira-ink hover:bg-lira-surface"
              title="Aumentar Zoom (até 24x)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setComposeZoom(pixelWidth <= 16 || pixelHeight <= 16 ? 8 : 2)}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-lira-muted hover:text-lira-ink hover:bg-lira-surface"
              title="Resetar Zoom"
            >
              Reset
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowCollisionOverlay(!showCollisionOverlay)}
            className={`p-1.5 rounded-[8px] border transition-colors ${
              showCollisionOverlay
                ? 'bg-lira-error/15 border-lira-error text-lira-error'
                : 'bg-lira-ground border-lira-quiet text-lira-muted hover:text-lira-ink'
            }`}
            title="Exibir/Ocultar hitboxes: colisão vermelha e assento verde"
          >
            <Eye className="w-4 h-4" />
          </button>
        </div>
      </div>

      {elementType === 'furniture' && (
        <div className="flex items-center justify-between px-4 py-2 bg-lira-panel border-b border-dashed border-lira-rule/60 shrink-0 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-lira-muted">Direção do Móvel:</span>
            <div className="flex bg-lira-ground p-1 rounded-[8px] border border-lira-quiet gap-1">
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
                    className={`px-3 py-1 text-xs font-mono font-bold rounded-[6px] transition-colors flex items-center gap-1.5 cursor-pointer ${
                      isSelected
                        ? 'bg-lira-accent text-lira-ground'
                        : 'text-lira-muted hover:text-lira-ink hover:bg-lira-surface'
                    }`}
                  >
                    <span>{d.label}</span>
                    <span className={`text-[10px] font-mono px-1 py-0.2 rounded ${
                      isSelected ? 'text-lira-accent bg-lira-ground' : 'text-lira-muted bg-lira-panel'
                    }`}>
                      {dimLabel}
                    </span>
                    {count > 0 && (
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                          isSelected
                            ? 'bg-lira-ground text-lira-accent'
                            : 'bg-lira-online/15 text-lira-online border border-lira-online/40'
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
                className="px-2.5 py-1 text-xs font-mono font-bold rounded-[8px] bg-lira-surface hover:border-lira-accent text-lira-ink border border-lira-rule transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Copiar as camadas da visão de Frente (⬇️) para esta direção"
              >
                <Copy className="w-3.5 h-3.5 text-lira-accent" />
                <span>Copiar da Frente</span>
              </button>
            )}

            {(activeDirection === 'left' || activeDirection === 'right') && onAutoMirrorLeftRight && (
              <button
                type="button"
                onClick={onAutoMirrorLeftRight}
                className="px-2.5 py-1 text-xs font-mono font-bold rounded-[8px] bg-lira-surface hover:border-lira-accent text-lira-accent border border-lira-rule transition-colors flex items-center gap-1.5 cursor-pointer"
                title="Espelhar horizontalmente as peças na mesa de composição"
              >
                <FlipHorizontal className="w-3.5 h-3.5 text-lira-accent" />
                <span>Espelhar ⬅️ ↔ ➡️</span>
              </button>
            )}
          </div>
        </div>
      )}

      <div ref={stageRef} className="flex-1 overflow-auto p-6 bg-lira-ground relative flex">
        <div className="m-auto relative border-2 border-lira-rule rounded-[12px] overflow-hidden bg-lira-sidebar shrink-0">
          <canvas
            ref={composeCanvasRef}
            onMouseDown={onComposeMouseDown}
            onMouseMove={onComposeMouseMove}
            onMouseUp={onComposeMouseUp}
            className={`pixelated ${
              composeTool !== 'move' ? 'cursor-crosshair' : 'cursor-move'
            }`}
          />
        </div>
      </div>

      {elementType === 'furniture' && composeTool === 'seat' && (
        <div className="p-3 bg-lira-sidebar border-t border-dashed border-lira-rule/60 flex items-center justify-between gap-3 text-xs font-mono text-lira-online">
          <span>Pinte ou apague os blocos verdes para sentar ao clicar ou passar pela hitbox. O player olha na direção do móvel e levanta ao andar.</span>
          <button type="button" onClick={onClearSeats} className="px-3 py-1 rounded-[8px] bg-lira-surface border border-lira-rule text-lira-ink shrink-0">Limpar Assentos</button>
        </div>
      )}

      {elementType === 'furniture' && composeTool === 'collision' && (
        <div className="p-3 bg-lira-sidebar border-t border-dashed border-lira-rule/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs font-mono text-lira-error">
            <Shield className="w-4 h-4 text-lira-error" />
            <span>
              Clique ou arraste nos blocos do quadro para pintar/limpar a barreira física onde os avatares não passam.
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSetBottomHalfCollision}
              className="px-3 py-1 rounded-[8px] bg-lira-surface hover:border-lira-accent text-xs font-mono font-bold text-lira-ink border border-lira-rule transition-colors"
            >
              Base Inferior (Padrão)
            </button>
            <button
              type="button"
              onClick={() => onSetAllCollision(true)}
              className="px-3 py-1 rounded-[8px] bg-lira-error/15 hover:bg-lira-error/25 text-lira-error border border-lira-error/40 text-xs font-mono font-bold transition-colors flex items-center gap-1"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>Bloquear Tudo</span>
            </button>
            <button
              type="button"
              onClick={() => onSetAllCollision(false)}
              className="px-3 py-1 rounded-[8px] bg-lira-surface hover:border-lira-accent text-xs font-mono font-bold text-lira-muted hover:text-lira-ink border border-lira-rule transition-colors flex items-center gap-1"
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
