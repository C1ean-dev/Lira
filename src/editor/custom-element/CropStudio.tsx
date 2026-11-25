import React, { useState, useCallback, useRef, useEffect } from 'react'
import {
  Upload,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid,
  Scissors,
  CheckSquare,
  Wand2,
  Move,
  Sliders,
} from 'lucide-react'

export interface CroppedClip {
  id: string
  name: string
  dataUrl: string
  width: number
  height: number
  origWidth?: number
  origHeight?: number
}

interface Props {
  sourceImage: HTMLImageElement | null
  sourceImageSrc: string
  zoom: number
  setZoom: (z: number | ((prev: number) => number)) => void
  snapToGrid: boolean
  setSnapToGrid: (snap: boolean) => void
  gridSnapSize?: number
  setGridSnapSize?: (size: number) => void
  selection: { x: number; y: number; w: number; h: number }
  setSelection: React.Dispatch<React.SetStateAction<{ x: number; y: number; w: number; h: number }>>
  isEyedropperActive: boolean
  mainCanvasRef: React.RefObject<HTMLCanvasElement>
  fileInputRef: React.RefObject<HTMLInputElement>
  onUploadImage: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDropFile: (file: File) => void
  onCanvasMouseDown: (e: React.MouseEvent<HTMLCanvasElement>) => void
  onCanvasMouseMove: (e: React.MouseEvent<HTMLCanvasElement>) => void
  onCanvasMouseUp: () => void
  onCropAndSaveClip: () => void
  tileWidth?: number
  tileHeight?: number
  pixelWidth?: number
  pixelHeight?: number
  onSetBoardSizeInTiles?: (w: number, h: number) => void
  onSetPixelSize?: (w: number, h: number) => void
  onAutoCropToContent?: () => void
  scaleFitMode?: 'fit' | 'stretch'
}

export const CropStudio: React.FC<Props> = ({
  sourceImage,
  sourceImageSrc,
  zoom,
  setZoom,
  snapToGrid,
  setSnapToGrid,
  gridSnapSize = 32,
  setGridSnapSize,
  selection,
  setSelection,
  isEyedropperActive,
  mainCanvasRef,
  fileInputRef,
  onUploadImage,
  onDropFile,
  onCanvasMouseDown,
  onCanvasMouseMove,
  onCanvasMouseUp,
  onCropAndSaveClip,
  tileWidth,
  tileHeight,
  pixelWidth,
  pixelHeight,
  onSetBoardSizeInTiles,
  onSetPixelSize,
  onAutoCropToContent,
  scaleFitMode,
}) => {
  const [isDragOverFile, setIsDragOverFile] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      if (!isDragOverFile) setIsDragOverFile(true)
    }
  }, [isDragOverFile])

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (e.currentTarget === e.target) {
      setIsDragOverFile(false)
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setIsDragOverFile(false)
      const file = e.dataTransfer.files?.[0]
      if (file) onDropFile(file)
    },
    [onDropFile]
  )

  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        e.stopPropagation()
        if (e.deltaY < 0) {
          setZoom((z) => Math.min(10, z + 1))
        } else if (e.deltaY > 0) {
          setZoom((z) => Math.max(1, z - 1))
        }
      }
    }

    stage.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      stage.removeEventListener('wheel', handleWheel)
    }
  }, [setZoom])

  const handleFitToScreen = () => {
    if (!stageRef.current || !sourceImage) return
    const stageW = stageRef.current.clientWidth - 48
    const stageH = stageRef.current.clientHeight - 48
    if (stageW <= 0 || stageH <= 0) return
    const fitZoom = Math.min(1, Math.min(stageW / sourceImage.naturalWidth, stageH / sourceImage.naturalHeight))
    setZoom(Math.max(0.1, Math.round(fitZoom * 100) / 100))
  }

  return (
    <div className="flex-1 flex flex-col bg-lira-ground rounded-[12px] border border-lira-quiet overflow-hidden font-mono text-lira-ink">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-dashed border-lira-rule/60 bg-lira-sidebar shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 rounded-[8px] bg-lira-accent hover:bg-lira-ink text-lira-ground font-mono font-bold text-xs border-2 border-lira-accent hover:border-lira-ink transition-colors flex items-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Importar Imagem / Spritesheet</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={onUploadImage}
            className="hidden"
          />

          {sourceImage && (
            <span className="text-[11px] font-mono text-lira-muted">
              {sourceImage.width}x{sourceImage.height}px
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-lira-ground p-1 rounded-[8px] border border-lira-quiet">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.1, Math.round((z - 0.25) * 100) / 100))}
              className="p-1 rounded text-lira-muted hover:text-lira-ink hover:bg-lira-surface"
              title="Reduzir Zoom"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono font-bold text-lira-ink px-1 min-w-[32px] text-center tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(6, Math.round((z + 0.25) * 100) / 100))}
              className="p-1 rounded text-lira-muted hover:text-lira-ink hover:bg-lira-surface"
              title="Aumentar Zoom"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold text-lira-muted hover:text-lira-ink hover:bg-lira-surface"
              title="Restaurar 100%"
            >
              100%
            </button>
            {sourceImage && (
              <button
                type="button"
                onClick={handleFitToScreen}
                className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-lira-surface text-lira-accent hover:border-lira-accent border border-lira-rule"
                title="Ajustar zoom para caber a imagem inteira na tela"
              >
                Ajustar Tela
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-lira-ground p-1 rounded-[8px] border border-lira-quiet">
            <span className="text-[10px] font-mono text-lira-muted font-semibold px-1 flex items-center gap-1">
              <Grid className="w-3 h-3 text-lira-accent" />
              <span>Modo:</span>
            </span>

            <button
              type="button"
              onClick={() => {
                setSnapToGrid(false)
                setGridSnapSize?.(1)
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${
                !snapToGrid || gridSnapSize === 1
                  ? 'bg-lira-accent text-lira-ground'
                  : 'text-lira-muted hover:text-lira-ink hover:bg-lira-surface'
              }`}
              title="Recorte dinâmico livre (pixel a pixel, sem travar em grade)"
            >
              Livre (1px)
            </button>

            <button
              type="button"
              onClick={() => {
                setSnapToGrid(true)
                setGridSnapSize?.(8)
              }}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${
                snapToGrid && gridSnapSize === 8
                  ? 'bg-lira-accent text-lira-ground'
                  : 'text-lira-muted hover:text-lira-ink hover:bg-lira-surface'
              }`}
              title="Encaixar em grade de 8px"
            >
              8px
            </button>

            <button
              type="button"
              onClick={() => {
                setSnapToGrid(true)
                setGridSnapSize?.(16)
              }}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${
                snapToGrid && gridSnapSize === 16
                  ? 'bg-lira-accent text-lira-ground'
                  : 'text-lira-muted hover:text-lira-ink hover:bg-lira-surface'
              }`}
              title="Encaixar em grade de 16px"
            >
              16px
            </button>

            <button
              type="button"
              onClick={() => {
                setSnapToGrid(true)
                setGridSnapSize?.(32)
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${
                snapToGrid && gridSnapSize === 32
                  ? 'bg-lira-accent text-lira-ground'
                  : 'text-lira-muted hover:text-lira-ink hover:bg-lira-surface'
              }`}
              title="Encaixar em grade clássica de 32px (tiles)"
            >
              Grade 32px
            </button>
          </div>

          {onAutoCropToContent && (
            <button
              type="button"
              onClick={onAutoCropToContent}
              className="px-2.5 py-1 rounded-[8px] bg-lira-amber/15 hover:bg-lira-amber/25 border border-lira-amber/40 text-lira-amber font-mono font-bold text-[11px] flex items-center gap-1.5 transition-colors"
              title="Ajustar automaticamente os 4 cantos da seleção ao contorno real do desenho"
            >
              <Wand2 className="w-3.5 h-3.5 text-lira-amber" />
              <span>Ajustar ao Desenho</span>
            </button>
          )}

          {sourceImage && (
            <button
              type="button"
              onClick={() => {
                setSelection({ x: 0, y: 0, w: sourceImage.naturalWidth, h: sourceImage.naturalHeight })
              }}
              className="px-2 py-1 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-rule text-lira-ink font-mono font-bold text-[11px] flex items-center gap-1 transition-colors"
              title="Selecionar toda a área da imagem carregada"
            >
              <CheckSquare className="w-3.5 h-3.5 text-lira-muted" />
              <span>Selecionar Tudo</span>
            </button>
          )}

          {pixelWidth && pixelHeight && (
            <button
              type="button"
              onClick={() =>
                setSelection((prev) => ({
                  ...prev,
                  w: pixelWidth,
                  h: pixelHeight,
                }))
              }
              className="px-2.5 py-1 rounded-[8px] bg-lira-surface hover:border-lira-accent border border-lira-rule text-lira-ink font-mono font-medium text-[11px] flex items-center gap-1.5 transition-colors"
              title="Ajustar largura e altura da seleção para o tamanho final configurado da mobília"
            >
              <Maximize2 className="w-3.5 h-3.5 text-lira-muted" />
              <span>Tam. Final ({pixelWidth}×{pixelHeight})</span>
            </button>
          )}
        </div>
      </div>

      <div
        ref={stageRef}
        className="flex-1 overflow-auto p-4 relative bg-lira-ground flex"
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {sourceImageSrc ? (
          <div
            className={`m-auto relative border-2 rounded-[8px] overflow-hidden bg-lira-sidebar transition-colors shrink-0 ${
              isDragOverFile
                ? 'border-lira-accent ring-2 ring-lira-accent/40'
                : 'border-lira-quiet'
            }`}
          >
            <canvas
              ref={mainCanvasRef}
              onMouseDown={onCanvasMouseDown}
              onMouseMove={onCanvasMouseMove}
              onMouseUp={onCanvasMouseUp}
              className={`pixelated ${isEyedropperActive ? 'cursor-crosshair' : 'cursor-default'} ${
                isDragOverFile ? 'opacity-60' : ''
              }`}
            />
            {isDragOverFile && (
              <div className="absolute inset-0 flex items-center justify-center bg-lira-accent/15 pointer-events-none">
                <div className="px-4 py-2 rounded-[8px] bg-lira-accent text-lira-ground text-xs font-mono font-bold">
                  Solte para substituir a imagem
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`m-auto border-2 border-dashed rounded-[12px] p-10 text-center cursor-pointer space-y-3 transition-colors ${
              isDragOverFile
                ? 'border-lira-accent bg-lira-surface'
                : 'border-lira-rule/60 hover:border-lira-accent bg-lira-panel'
            }`}
          >
            <div
              className={`w-14 h-14 rounded-[12px] mx-auto flex items-center justify-center transition-colors ${
                isDragOverFile
                  ? 'bg-lira-surface border border-lira-accent text-lira-accent'
                  : 'bg-lira-surface border border-lira-rule text-lira-accent'
              }`}
            >
              <Upload className="w-7 h-7" />
            </div>
            <div>
              <div className="text-sm font-mono font-bold text-lira-ink">
                {isDragOverFile
                  ? 'Solte a imagem aqui'
                  : 'Arraste uma imagem ou clique para selecionar'}
              </div>
              <div className="text-xs font-mono text-lira-muted mt-1">
                Suporta PNG, JPEG, Spritesheets de jogos, LPC assets e GIFs
              </div>
            </div>
          </div>
        )}
      </div>

      {sourceImageSrc && (
        <div className="p-3 bg-lira-sidebar border-t border-dashed border-lira-rule/60 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center flex-wrap gap-2.5 text-xs font-mono text-lira-ink">
            <div className="flex items-center gap-1.5 bg-lira-ground px-2.5 py-1 rounded-[8px] border border-lira-quiet">
              <span className="text-[11px] font-mono font-semibold text-lira-muted">Posição:</span>
              <span className="text-[10px] font-mono text-lira-muted">X</span>
              <input
                type="number"
                min={0}
                max={sourceImage ? sourceImage.naturalWidth - 1 : 9999}
                value={selection.x}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val)) {
                    setSelection((prev) => ({
                      ...prev,
                      x: Math.max(0, val),
                    }))
                  }
                }}
                className="w-12 bg-lira-panel border border-lira-rule rounded px-1.5 py-0.5 text-xs font-mono font-bold text-center text-lira-ink focus:outline-none focus:border-lira-accent"
                title="Posição X inicial em pixels"
              />
              <span className="text-[10px] font-mono text-lira-muted">Y</span>
              <input
                type="number"
                min={0}
                max={sourceImage ? sourceImage.naturalHeight - 1 : 9999}
                value={selection.y}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val)) {
                    setSelection((prev) => ({
                      ...prev,
                      y: Math.max(0, val),
                    }))
                  }
                }}
                className="w-12 bg-lira-panel border border-lira-rule rounded px-1.5 py-0.5 text-xs font-mono font-bold text-center text-lira-ink focus:outline-none focus:border-lira-accent"
                title="Posição Y inicial em pixels"
              />
            </div>

            <div className="flex items-center gap-1.5 bg-lira-ground px-2.5 py-1 rounded-[8px] border border-lira-quiet">
              <span className="text-[11px] font-mono font-semibold text-lira-muted">Recorte:</span>
              <input
                type="number"
                min={1}
                max={sourceImage ? sourceImage.naturalWidth : 9999}
                value={selection.w}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val)) {
                    setSelection((prev) => ({
                      ...prev,
                      w: Math.max(1, val),
                    }))
                  }
                }}
                className="w-14 bg-lira-panel border border-lira-rule rounded px-1.5 py-0.5 text-xs font-mono font-bold text-center text-lira-accent focus:outline-none focus:border-lira-accent"
                title="Largura do recorte em pixels (dinâmico livre)"
              />
              <span className="text-lira-muted text-xs font-bold">×</span>
              <input
                type="number"
                min={1}
                max={sourceImage ? sourceImage.naturalHeight : 9999}
                value={selection.h}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val)) {
                    setSelection((prev) => ({
                      ...prev,
                      h: Math.max(1, val),
                    }))
                  }
                }}
                className="w-14 bg-lira-panel border border-lira-rule rounded px-1.5 py-0.5 text-xs font-mono font-bold text-center text-lira-accent focus:outline-none focus:border-lira-accent"
                title="Altura do recorte em pixels (dinâmico livre)"
              />
              <span className="text-[10px] font-mono text-lira-muted">px</span>
            </div>

            {onSetPixelSize && (
              <button
                type="button"
                onClick={() => onSetPixelSize(selection.w, selection.h)}
                className="px-2.5 py-1 rounded-[8px] bg-lira-online/15 hover:bg-lira-online/25 border border-lira-online/40 text-lira-online font-mono font-semibold text-[11px] transition-colors flex items-center gap-1.5"
                title="Ajusta o tamanho final do elemento para corresponder exatamente às dimensões deste recorte"
              >
                <span>Definir como Tamanho Final ({selection.w}×{selection.h}px)</span>
              </button>
            )}

            {(pixelWidth || (tileWidth && tileHeight)) && (
              <div className="flex items-center gap-1.5 bg-lira-ground px-2.5 py-1 rounded-[8px] border border-lira-quiet">
                <span className="text-[11px] font-mono font-semibold text-lira-muted">Mobília Final:</span>
                <strong className="font-mono text-lira-online text-xs">
                  {pixelWidth || (tileWidth ? tileWidth * 32 : 32)}×{pixelHeight || (tileHeight ? tileHeight * 32 : 32)}px
                </strong>

              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCropAndSaveClip}
              className="px-4 py-2 rounded-[8px] bg-lira-online hover:bg-lira-ink text-lira-ground font-mono font-bold text-xs flex items-center gap-2 transition-colors"
            >
              <Scissors className="w-4 h-4" />
              <span>Recortar & Salvar</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

