import { afterEach, expect, it, vi } from 'vitest'
import { AvatarRenderer } from '../../engine/AvatarRenderer'
import { TILE_SIZE } from '../../engine/Constants'
import { CameraManager } from '../../engine/camera/CameraManager'
import { DoorRenderer } from '../../engine/rendering/doorRenderer'
import { invalidateStaticLayer } from '../../engine/rendering/staticLayerCache'
import { WorldRenderer } from '../../engine/rendering/worldRenderer'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useMapStore } from '../../store/useMapStore'
import type { CustomAsset } from '../../types/customAsset'
import type { MapData } from '../../types/map'

const originalAssets = useCustomAssetsStore.getState()
const originalMap = useMapStore.getState()
const size = 8 * TILE_SIZE
const sampleX = 4 * TILE_SIZE + 2
const sampleY = 7 * TILE_SIZE - 4

// Track the last paint at one point on the doorstep through each canvas layer.
function canvasAtDoorstep() {
  let color: string | undefined
  function paint(value: string | undefined, x: number, y: number, width: number, height: number) {
    if (value && sampleX >= x && sampleX < x + width && sampleY >= y && sampleY < y + height) {
      color = value
    }
  }
  const ctx = {
    fillStyle: '',
    save() {},
    restore() {},
    scale() {},
    translate() {},
    clearRect() { color = undefined },
    fillRect(x: number, y: number, width: number, height: number) {
      paint(this.fillStyle, x, y, width, height)
    },
    drawImage(image: { color?: string }, x: number, y: number, width = size, height = size) {
      paint(image.color, x, y, width, height)
    },
    strokeRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    stroke() {},
    fill() {},
    createLinearGradient() { return { addColorStop() {} } },
  }
  return { width: size, height: size, get color() { return color }, getContext: () => ctx }
}

afterEach(() => {
  invalidateStaticLayer()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  useCustomAssetsStore.setState(originalAssets)
  useMapStore.setState(originalMap)
})

it.each([
  { frames: 1, useCache: true },
  { frames: 2, useCache: true },
  { frames: 2, useCache: false },
])('keeps the doorstep visible with $frames floor frame(s) and cache=$useCache', ({ frames, useCache }) => {
  const floor: CustomAsset = {
    id: 'carpet_gray', type: 'floor', name: 'Test floor', width: 1, height: 1,
    frames: ['floor-frame-1', 'floor-frame-2'].slice(0, frames), createdAt: 0,
  }
  const floors: MapData['floors'] = Array.from({ length: 8 }, () => Array(8).fill('wood_parquet'))
  floors[6][4] = 'carpet_gray'
  useCustomAssetsStore.setState({ customAssets: [floor] })
  useMapStore.setState({
    isEditorOpen: false,
    mapData: {
      ...originalMap.mapData, width: 8, height: 8, floors, furniture: [],
      zones: [{ id: 'room', name: 'Room', x: 1, y: 1, width: 6, height: 6, color: '#4c6ef5', hasWalls: true }],
    },
  })
  vi.stubGlobal('document', useCache ? { createElement: canvasAtDoorstep } : undefined)
  vi.stubGlobal('Image', class {
    complete = true
    naturalWidth = TILE_SIZE
    color = '#101010'
  })
  vi.spyOn(AvatarRenderer, 'drawPlayer').mockImplementation(() => {})
  const drawDoor = vi.spyOn(DoorRenderer, 'drawFrontDoor')

  const canvas = canvasAtDoorstep()
  const camera = Object.assign(new CameraManager(), { x: size / 2, y: size / 2, zoom: 1 })
  WorldRenderer.render(
    canvas.getContext() as unknown as CanvasRenderingContext2D,
    canvas as unknown as HTMLCanvasElement,
    camera, null, null, null, 0, 60,
  )

  expect(drawDoor).toHaveBeenCalledOnce()
  expect(canvas.color).toBe('#1c1917')
})
