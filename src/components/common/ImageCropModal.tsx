import React, { useState, useRef, useEffect, useCallback } from 'react'
import { ZoomIn, ZoomOut, RotateCcw, Check, X, Crop, Move } from 'lucide-react'
import { cropImageToSquare } from '../../utils/avatarUtils'

export interface ImageCropModalProps {
  isOpen: boolean
  imageSrc: string | null
  onCropComplete: (croppedDataUrl: string) => void
  onCancel: () => void
}

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  isOpen,
  imageSrc,
  onCropComplete,
  onCancel,
}) => {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const panStartRef = useRef({ x: 0, y: 0 })

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const VIEWPORT_SIZE = 280
  const CROP_DIAMETER = 220

  const baseScale = imageSize
    ? Math.max(CROP_DIAMETER / imageSize.width, CROP_DIAMETER / imageSize.height)
    : 1

  const currentScale = baseScale * zoom

  const clampPan = useCallback(
    (x: number, y: number, currentZ: number) => {
      if (!imageSize) return { x: 0, y: 0 }
      const scale = baseScale * currentZ
      const renderedW = imageSize.width * scale
      const renderedH = imageSize.height * scale

      const maxPanX = Math.max(0, (renderedW - CROP_DIAMETER) / 2)
      const maxPanY = Math.max(0, (renderedH - CROP_DIAMETER) / 2)

      return {
        x: Math.min(maxPanX, Math.max(-maxPanX, x)),
        y: Math.min(maxPanY, Math.max(-maxPanY, y)),
      }
    },
    [imageSize, baseScale]
  )

  useEffect(() => {
    if (isOpen && imageSrc) {
      setZoom(1)
      setPan({ x: 0, y: 0 })
      setIsDragging(false)

      const img = new Image()
      img.onload = () => {
        setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
      }
      img.src = imageSrc
    } else {
      setImageSize(null)
    }
  }, [isOpen, imageSrc])

  if (!isOpen || !imageSrc) return null

  const handlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    panStartRef.current = { ...pan }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    e.preventDefault()
    const dx = e.clientX - dragStartRef.current.x
    const dy = e.clientY - dragStartRef.current.y
    const nextPan = clampPan(panStartRef.current.x + dx, panStartRef.current.y + dy, zoom)
    setPan(nextPan)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDragging) {
      setIsDragging(false)
      try {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
      } catch {}
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const zoomDelta = e.deltaY < 0 ? 0.1 : -0.1
    const nextZoom = Math.min(3.5, Math.max(1, zoom + zoomDelta))
    setZoom(nextZoom)
    setPan((prev) => clampPan(prev.x, prev.y, nextZoom))
  }

  const handleZoomChange = (newZoom: number) => {
    const clampedZoom = Math.min(3.5, Math.max(1, newZoom))
    setZoom(clampedZoom)
    setPan((prev) => clampPan(prev.x, prev.y, clampedZoom))
  }

  const handleReset = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const handleConfirm = () => {
    if (!imgRef.current || !imageSize) return

    const centerX = imageSize.width / 2 - pan.x / currentScale
    const centerY = imageSize.height / 2 - pan.y / currentScale
    const cropSourceDim = CROP_DIAMETER / currentScale

    const sourceX = Math.max(0, centerX - cropSourceDim / 2)
    const sourceY = Math.max(0, centerY - cropSourceDim / 2)

    try {
      const cropped = cropImageToSquare(imgRef.current, sourceX, sourceY, cropSourceDim, 256)
      if (cropped) {
        onCropComplete(cropped)
      } else {
        onCancel()
      }
    } catch (err) {
      console.error('Falha ao processar recorte:', err)
      onCancel()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-lira-ground/80 select-none"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-lira-panel border border-dashed border-lira-rule rounded-[12px] w-full max-w-sm sm:max-w-md p-5 flex flex-col gap-4 text-lira-ink font-mono">
        <div className="flex items-center justify-between pb-3 border-b border-dashed border-lira-quiet">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[8px] bg-lira-surface text-lira-accent flex items-center justify-center border border-lira-rule">
              <Crop className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-lira-accent">
                Recortar Foto de Perfil
              </h3>
              <p className="text-[11px] text-lira-muted">
                Arraste a imagem e ajuste o zoom para centralizar
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-1.5 rounded-[8px] border border-lira-rule bg-lira-surface text-lira-muted hover:text-lira-ink hover:border-lira-accent transition-colors"
            title="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col items-center justify-center">
          <div
            ref={containerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
            style={{ width: VIEWPORT_SIZE, height: VIEWPORT_SIZE }}
            className="relative overflow-hidden rounded-[12px] bg-lira-ground border border-lira-quiet cursor-grab active:cursor-grabbing touch-none flex items-center justify-center"
          >
            <img
              ref={imgRef}
              src={imageSrc}
              alt="Crop Source"
              draggable={false}
              className="max-w-none pointer-events-none transition-transform duration-75 select-none"
              style={{
                width: imageSize ? imageSize.width * currentScale : 'auto',
                height: imageSize ? imageSize.height * currentScale : 'auto',
                transform: `translate(${pan.x}px, ${pan.y}px)`,
              }}
            />

            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                style={{ width: CROP_DIAMETER, height: CROP_DIAMETER }}
                className="rounded-full border-2 border-lira-accent shadow-[0_0_0_9999px_rgba(16,12,24,0.75)] flex items-center justify-center"
              >
                <div className="w-full h-[1px] bg-lira-accent/20" />
                <div className="h-full w-[1px] bg-lira-accent/20 absolute" />
              </div>
            </div>

            <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1 text-[10px] text-lira-muted bg-lira-ground/80 border border-lira-quiet px-2 py-0.5 rounded-[6px]">
              <Move className="w-3 h-3" />
              <span>Arraste para mover</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-lira-surface p-3 rounded-[8px] border border-lira-rule">
          <button
            type="button"
            onClick={() => handleZoomChange(zoom - 0.2)}
            className="p-1 rounded-[6px] text-lira-muted hover:text-lira-ink hover:bg-lira-ground transition-colors"
            title="Diminuir Zoom"
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          <input
            type="range"
            min="1"
            max="3.5"
            step="0.05"
            value={zoom}
            onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
            className="flex-1 accent-[#d1b5ff] h-1.5 bg-lira-ground rounded-lg cursor-pointer"
          />

          <button
            type="button"
            onClick={() => handleZoomChange(zoom + 0.2)}
            className="p-1 rounded-[6px] text-lira-muted hover:text-lira-ink hover:bg-lira-ground transition-colors"
            title="Aumentar Zoom"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleReset}
            className="px-2 py-1 rounded-[6px] text-[11px] font-semibold text-lira-muted hover:text-lira-ink hover:border-lira-accent border border-lira-rule flex items-center gap-1 transition-colors"
            title="Centralizar"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset</span>
          </button>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-dashed border-lira-quiet">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-[8px] text-xs font-semibold border border-lira-rule bg-lira-surface text-lira-muted hover:border-lira-accent hover:text-lira-ink transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-2 rounded-[8px] text-xs font-bold bg-lira-accent hover:bg-lira-ink text-lira-ground border-2 border-lira-accent hover:border-lira-ink transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>Confirmar Recorte</span>
          </button>
        </div>
      </div>
    </div>
  )
}
