import React, { useEffect, useRef } from 'react'
import { PixelArtRenderer } from '../engine/PixelArtRenderer'
import { FURNITURE_CATALOG, TILE_SIZE } from '../engine/Constants'
import { FloorType, WallType, PlacedFurniture } from '../types/map'
import { useCustomAssetsStore, getCustomAssetImage } from '../store/useCustomAssetsStore'

interface PixelArtThumbnailProps {
  type: 'furniture' | 'floor' | 'wall'
  id: string
  size?: number
  className?: string
}

export const PixelArtThumbnail: React.FC<PixelArtThumbnailProps> = ({
  type,
  id,
  size = 48,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let animationFrameId: number
    const render = () => {
      try {
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, canvas.width, canvas.height)

        if (type === 'furniture') {
          const customAsset = useCustomAssetsStore.getState().getAssetById(id)
          const def = customAsset || FURNITURE_CATALOG.find((f) => f.id === id)
          if (!def) return

          const furnWidthPx = (customAsset && customAsset.pixelWidth) ? customAsset.pixelWidth : def.width * TILE_SIZE
          const furnHeightPx = (customAsset && customAsset.pixelHeight) ? customAsset.pixelHeight : def.height * TILE_SIZE

          // Scale to fit within thumbnail box (padding 4px)
          const maxDim = Math.max(furnWidthPx, furnHeightPx)
          const availableSize = size - 8
          const scale = availableSize / maxDim

          ctx.save()
          // Center in canvas
          const offsetX = (size - furnWidthPx * scale) / 2
          const offsetY = (size - furnHeightPx * scale) / 2

          ctx.translate(offsetX, offsetY)
          ctx.scale(scale, scale)

          const mockFurn: PlacedFurniture = {
            id: 'thumb',
            defId: def.id,
            x: 0,
            y: 0,
          }

          PixelArtRenderer.drawFurniture(ctx, mockFurn)
          ctx.restore()
        } else if (type === 'floor') {
          ctx.save()
          const customAsset = useCustomAssetsStore.getState().getAssetById(id)
          if (customAsset && ((customAsset.width && customAsset.width > 1) || (customAsset.height && customAsset.height > 1))) {
            const wTiles = Math.max(1, Math.round(customAsset.width || 1))
            const hTiles = Math.max(1, Math.round(customAsset.height || 1))
            const maxDim = Math.max(wTiles, hTiles)
            const availableSize = size - 8
            const scale = availableSize / (maxDim * TILE_SIZE)
            const drawW = wTiles * TILE_SIZE * scale
            const drawH = hTiles * TILE_SIZE * scale
            const offsetX = (size - drawW) / 2
            const offsetY = (size - drawH) / 2
            ctx.translate(offsetX, offsetY)
            const img = customAsset.frames?.[0] ? getCustomAssetImage(customAsset.frames[0]) : null
            if (img && img.complete && img.naturalWidth > 0) {
              ctx.drawImage(img, 0, 0, drawW, drawH)
            } else {
              PixelArtRenderer.drawFloor(ctx, id as FloorType, 0, 0, size)
            }
          } else {
            PixelArtRenderer.drawFloor(ctx, id as FloorType, 0, 0, size)
          }
          ctx.restore()
        } else if (type === 'wall') {
          ctx.save()
          PixelArtRenderer.drawWall(ctx, id as WallType, 0, 0, size)
          ctx.restore()
        }
      } catch (e) {
        console.error('Error in thumbnail render:', e)
      }
    }

    render()
    // Trigger follow-up renders in case sprites finish loading
    const timer = setTimeout(render, 100)
    const timer2 = setTimeout(render, 300)

    return () => {
      clearTimeout(timer)
      clearTimeout(timer2)
    }
  }, [type, id, size])

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className={`pixelated block rounded-lg shrink-0 ${className}`}
      style={{
        imageRendering: 'pixelated',
        width: `${size}px`,
        height: `${size}px`,
      }}
    />
  )
}
