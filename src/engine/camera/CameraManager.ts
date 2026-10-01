import { TILE_SIZE } from '../Constants'
import { useMapStore } from '../../store/useMapStore'
import { useGameStore } from '../../store/useGameStore'

export class CameraManager {
  public x: number = 34 * TILE_SIZE
  public y: number = 20 * TILE_SIZE
  public zoom: number = 1.6

  constructor() {
    const local = useGameStore.getState().localPlayer
    this.x = (local?.x ?? 34) * TILE_SIZE
    this.y = (local?.y ?? 20) * TILE_SIZE
  }

  public handleWheel = (e: WheelEvent) => {
    e.preventDefault()
    const zoomDelta = e.deltaY < 0 ? 0.15 : -0.15
    const store = useGameStore.getState()

    // Se já estiver no modo simplificado:
    if (store.mapViewMode === 'simplified') {
      // Se adicionar zoom (scroll para cima) e o usuário NÃO ativou pelo botão manual:
      if (zoomDelta > 0 && !store.isManualSimplified) {
        this.zoom = 0.6
        store.setMapViewMode('immersive', false)
      }
      return
    }

    this.zoom = Math.max(0.4, Math.min(4.0, Number((this.zoom + zoomDelta).toFixed(2))))

    // Quando o usuário der zoom no mínimo (<= 0.4), altera de imersivo para simplificado (automático via zoom)
    if (this.zoom <= 0.4 && store.mapViewMode === 'immersive') {
      store.setMapViewMode('simplified', false)
    }
  }

  /**
   * Smooth, jitter-free Camera Following of Local Player with exponential decay
   */
  public followPlayer(localX: number, localY: number, deltaTime: number = 0.016) {
    const targetX = localX * TILE_SIZE
    const targetY = localY * TILE_SIZE
    const clampedDelta = Math.max(0.001, Math.min(deltaTime, 0.1))
    const factor = 1 - Math.exp(-14 * clampedDelta)
    this.x += (targetX - this.x) * factor
    this.y += (targetY - this.y) * factor
  }

  /**
   * Auto-fit camera zoom to occupy 95%+ of screen viewport
   */
  public fitToScreen(canvas: HTMLCanvasElement, percentage: number = 0.95) {
    const map = useMapStore.getState().mapData
    const mapPixelWidth = (map.width || 68) * TILE_SIZE
    const mapPixelHeight = (map.height || 40) * TILE_SIZE

    if (mapPixelWidth === 0 || mapPixelHeight === 0 || canvas.width === 0 || canvas.height === 0) return

    const targetZoomX = (canvas.width * percentage) / mapPixelWidth
    const targetZoomY = (canvas.height * percentage) / mapPixelHeight
    const optimalZoom = Math.min(targetZoomX, targetZoomY)

    this.zoom = Math.max(0.4, Math.min(3.2, optimalZoom))
    const local = useGameStore.getState().localPlayer
    this.x = (local?.x ?? 34) * TILE_SIZE
    this.y = (local?.y ?? 20) * TILE_SIZE
  }

  public screenToTile(
    canvas: HTMLCanvasElement,
    screenX: number,
    screenY: number,
    snapStep: number = 1
  ): { x: number; y: number } {
    const viewWidth = canvas.width / this.zoom
    const viewHeight = canvas.height / this.zoom
    const offsetX = viewWidth / 2 - this.x
    const offsetY = viewHeight / 2 - this.y

    const worldX = screenX / this.zoom - offsetX
    const worldY = screenY / this.zoom - offsetY

    const tileX = worldX / TILE_SIZE
    const tileY = worldY / TILE_SIZE

    if (snapStep <= 0) {
      return { x: tileX, y: tileY }
    }

    if (snapStep === 1) {
      return {
        x: Math.floor(tileX),
        y: Math.floor(tileY),
      }
    }

    return {
      x: Math.round(tileX / snapStep) * snapStep,
      y: Math.round(tileY / snapStep) * snapStep,
    }
  }

  public screenToWorld(
    canvas: HTMLCanvasElement,
    screenX: number,
    screenY: number
  ): { x: number; y: number } {
    const viewWidth = canvas.width / this.zoom
    const viewHeight = canvas.height / this.zoom
    const offsetX = viewWidth / 2 - this.x
    const offsetY = viewHeight / 2 - this.y

    return {
      x: screenX / this.zoom - offsetX,
      y: screenY / this.zoom - offsetY,
    }
  }
}

