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
    <div className="flex-1 flex flex-col bg-[#12151d] rounded-2xl border border-[#2b2d31] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#2b2d31] bg-[#18191c]/80 shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow transition-all flex items-center gap-1.5"
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
            <span className="text-[11px] font-mono text-slate-400">
              {sourceImage.width}x{sourceImage.height}px
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[#12151d] p-1 rounded-xl border border-[#2b2d31]">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.1, Math.round((z - 0.25) * 100) / 100))}
              className="p-1 rounded text-slate-300 hover:text-white hover:bg-[#2b2d31]"
              title="Reduzir Zoom"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono font-bold text-slate-300 px-1 min-w-[32px] text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(6, Math.round((z + 0.25) * 100) / 100))}
              className="p-1 rounded text-slate-300 hover:text-white hover:bg-[#2b2d31]"
              title="Aumentar Zoom"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="px-1.5 py-0.5 rounded text-[10px] font-bold text-slate-300 hover:text-white hover:bg-[#2b2d31]"
              title="Restaurar 100%"
            >
              100%
            </button>
            {sourceImage && (
              <button
                type="button"
                onClick={handleFitToScreen}
                className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-600/30 text-indigo-200 hover:bg-indigo-600/50 hover:text-white border border-indigo-500/40"
                title="Ajustar zoom para caber a imagem inteira na tela"
              >
                Ajustar Tela
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 bg-[#12151d] p-1 rounded-xl border border-[#2b2d31]">
            <span className="text-[10px] text-slate-400 font-semibold px-1 flex items-center gap-1">
              <Grid className="w-3 h-3 text-indigo-400" />
              <span>Modo:</span>
            </span>

            <button
              type="button"
              onClick={() => {
                setSnapToGrid(false)
                setGridSnapSize?.(1)
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                !snapToGrid || gridSnapSize === 1
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-[#2b2d31]'
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
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
                snapToGrid && gridSnapSize === 8
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-[#2b2d31]'
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
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
                snapToGrid && gridSnapSize === 16
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-[#2b2d31]'
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
              className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                snapToGrid && gridSnapSize === 32
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-[#2b2d31]'
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
              className="px-2.5 py-1 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 font-bold text-[11px] flex items-center gap-1.5 transition-all active:scale-95"
              title="Ajustar automaticamente os 4 cantos da seleção ao contorno real do desenho"
            >
              <Wand2 className="w-3.5 h-3.5 text-amber-400" />
              <span>Ajustar ao Desenho</span>
            </button>
          )}

          {sourceImage && (
            <button
              type="button"
              onClick={() => {
                setSelection({ x: 0, y: 0, w: sourceImage.naturalWidth, h: sourceImage.naturalHeight })
              }}
              className="px-2 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 border border-[#2b2d31] text-slate-300 font-bold text-[11px] flex items-center gap-1 transition-all"
              title="Selecionar toda a área da imagem carregada"
            >
              <CheckSquare className="w-3.5 h-3.5 text-slate-400" />
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
              className="px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 border border-[#2b2d31] text-slate-300 font-medium text-[11px] flex items-center gap-1.5 transition-all"
              title="Ajustar largura e altura da seleção para o tamanho final configurado da mobília"
            >
              <Maximize2 className="w-3.5 h-3.5 text-slate-400" />
              <span>Tam. Final ({pixelWidth}×{pixelHeight})</span>
            </button>
          )}
        </div>
      </div>

      <div
        ref={stageRef}
        className="flex-1 overflow-auto p-4 relative bg-[#0e1015] flex"
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {sourceImageSrc ? (
          <div
            className={`m-auto relative border-2 rounded-lg shadow-2xl overflow-hidden bg-[#18191c] transition-colors shrink-0 ${
              isDragOverFile
                ? 'border-indigo-400 ring-2 ring-indigo-400/40'
                : 'border-[#2b2d31]'
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
              <div className="absolute inset-0 flex items-center justify-center bg-indigo-500/15 pointer-events-none">
                <div className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold shadow-lg">
                  Solte para substituir a imagem
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            onClick={() => fileInputRef.current?.click()}
            className={`m-auto border-2 border-dashed rounded-3xl p-10 text-center cursor-pointer space-y-3 transition-colors ${
              isDragOverFile
                ? 'border-indigo-400 bg-indigo-500/10'
                : 'border-slate-700 hover:border-indigo-500 bg-[#18191c]/50'
            }`}
          >
            <div
              className={`w-14 h-14 rounded-2xl mx-auto flex items-center justify-center transition-colors ${
                isDragOverFile
                  ? 'bg-indigo-500/30 border border-indigo-400 text-indigo-200'
                  : 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-400'
              }`}
            >
              <Upload className="w-7 h-7" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-200">
                {isDragOverFile
                  ? 'Solte a imagem aqui'
                  : 'Arraste uma imagem ou clique para selecionar'}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Suporta PNG, JPEG, Spritesheets de jogos, LPC assets e GIFs
              </div>
            </div>
          </div>
        )}
      </div>

      {sourceImageSrc && (
        <div className="p-3 bg-[#18191c] border-t border-[#2b2d31] flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center flex-wrap gap-2.5 text-xs text-slate-300">
            <div className="flex items-center gap-1.5 bg-[#12151d] px-2.5 py-1 rounded-xl border border-[#2b2d31]">
              <span className="text-[11px] font-semibold text-slate-400">Posição:</span>
              <span className="text-[10px] text-slate-500">X</span>
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
                className="w-12 bg-[#18191c] border border-[#2b2d31] rounded px-1.5 py-0.5 text-xs font-mono font-bold text-center text-white focus:outline-none focus:border-indigo-500"
                title="Posição X inicial em pixels"
              />
              <span className="text-[10px] text-slate-500">Y</span>
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
                className="w-12 bg-[#18191c] border border-[#2b2d31] rounded px-1.5 py-0.5 text-xs font-mono font-bold text-center text-white focus:outline-none focus:border-indigo-500"
                title="Posição Y inicial em pixels"
              />
            </div>

            <div className="flex items-center gap-1.5 bg-[#12151d] px-2.5 py-1 rounded-xl border border-[#2b2d31]">
              <span className="text-[11px] font-semibold text-slate-400">Recorte:</span>
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
                className="w-14 bg-[#18191c] border border-[#2b2d31] rounded px-1.5 py-0.5 text-xs font-mono font-bold text-center text-cyan-400 focus:outline-none focus:border-indigo-500"
                title="Largura do recorte em pixels (dinâmico livre)"
              />
              <span className="text-slate-500 text-xs font-bold">×</span>
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
                className="w-14 bg-[#18191c] border border-[#2b2d31] rounded px-1.5 py-0.5 text-xs font-mono font-bold text-center text-cyan-400 focus:outline-none focus:border-indigo-500"
                title="Altura do recorte em pixels (dinâmico livre)"
              />
              <span className="text-[10px] text-slate-500">px</span>
            </div>

            {onSetPixelSize && (
              <button
                type="button"
                onClick={() => onSetPixelSize(selection.w, selection.h)}
                className="px-2.5 py-1 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 font-semibold text-[11px] transition-all flex items-center gap-1.5"
                title="Ajusta o tamanho final do elemento para corresponder exatamente às dimensões deste recorte"
              >
                <span>Definir como Tamanho Final ({selection.w}×{selection.h}px)</span>
              </button>
            )}

            {(pixelWidth || (tileWidth && tileHeight)) && (
              <div className="flex items-center gap-1.5 bg-[#12151d] px-2.5 py-1 rounded-xl border border-[#2b2d31]">
                <span className="text-[11px] font-semibold text-slate-400">Mobília Final:</span>
                <strong className="font-mono text-emerald-400 text-xs">
                  {pixelWidth || (tileWidth ? tileWidth * 32 : 32)}×{pixelHeight || (tileHeight ? tileHeight * 32 : 32)}px
                </strong>
                {tileWidth && tileHeight && (
                  <span className="text-[10px] text-slate-400 font-mono">({tileWidth}×{tileHeight}t)</span>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCropAndSaveClip}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/20 flex items-center gap-2 transition-all active:scale-95"
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

