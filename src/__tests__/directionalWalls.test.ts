import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WallRenderer } from '../engine/rendering/wallRenderer'
import * as customAssetsStore from '../store/useCustomAssetsStore'
import { CustomAsset } from '../types/customAsset'
import { PrivateZone } from '../types/map'

describe('Custom Directional Walls (Estúdio Pixel Art: Parede)', () => {
  const customWallId = 'custom_wall_multicolor'

  beforeEach(() => {
    customAssetsStore.useCustomAssetsStore.setState({
      customAssets: [],
    })
    vi.spyOn(customAssetsStore, 'getCustomAssetImage').mockImplementation((dataUrl: string) => {
      return {
        src: dataUrl,
        complete: true,
        naturalWidth: 128,
        naturalHeight: 192,
      } as any
    })
  })

  const createMockCtx = () => {
    const patterns: string[] = []
    const drawn: string[] = []

    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      closePath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      bezierCurveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
      createPattern: vi.fn().mockImplementation((img: any) => {
        patterns.push(img.src)
        return { setTransform: vi.fn() }
      }),
      drawImage: vi.fn().mockImplementation((img: any) => {
        drawn.push(img.src)
      }),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
    }

    return { ctx: ctx as unknown as CanvasRenderingContext2D, patterns, drawn }
  }

  it('drawGatherRoom uses directional frames for back (up), left (left), right (right), and front (down)', () => {
    const customWallAsset: CustomAsset = {
      id: customWallId,
      name: 'Parede Multicolorida',
      type: 'wall',
      category: 'Geral',
      width: 1,
      height: 1,
      isObstacle: true,
      frames: ['data:image/png;base64,mockBlueFront'],
      directionalFrames: {
        down: 'data:image/png;base64,mockBlueFront', // Frente (Blue)
        up: 'data:image/png;base64,mockBlackBack', // Costas (Black)
        left: 'data:image/png;base64,mockRedLeft', // Esquerda (Red)
        right: 'data:image/png;base64,mockGreenRight', // Direita (Green)
      },
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    customAssetsStore.useCustomAssetsStore.getState().addCustomAsset(customWallAsset)

    const { ctx, patterns } = createMockCtx()

    const zone: PrivateZone = {
      id: 'private_room_1',
      name: 'Nova Sala Privada',
      color: '#4f46e5',
      x: 2,
      y: 2,
      width: 10,
      height: 10,
      hasWalls: true,
      wallType: customWallId,
    }

    // Call drawGatherRoom
    WallRenderer.drawGatherRoom(ctx, zone, [zone])

    // Verify patterns were created from all 4 directional frames
    expect(patterns).toContain('data:image/png;base64,mockBlackBack')
    expect(patterns).toContain('data:image/png;base64,mockRedLeft')
    expect(patterns).toContain('data:image/png;base64,mockGreenRight')
    expect(patterns).toContain('data:image/png;base64,mockBlueFront')
  })

  it('drawWall resolves the correct directional frame when passed a direction', () => {
    const customWallAsset: CustomAsset = {
      id: customWallId,
      name: 'Parede Multicolorida',
      type: 'wall',
      category: 'Geral',
      width: 1,
      height: 1,
      isObstacle: true,
      frames: ['data:image/png;base64,mockBlueFront'],
      directionalFrames: {
        down: 'data:image/png;base64,mockBlueFront',
        up: 'data:image/png;base64,mockBlackBack',
        left: 'data:image/png;base64,mockRedLeft',
        right: 'data:image/png;base64,mockGreenRight',
      },
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    customAssetsStore.useCustomAssetsStore.getState().addCustomAsset(customWallAsset)

    const { ctx, drawn } = createMockCtx()

    // Draw wall for 'left' direction
    WallRenderer.drawWall(ctx, customWallId, 0, 0, 32, 'left')
    expect(drawn).toContain('data:image/png;base64,mockRedLeft')

    // Draw wall for 'up' direction
    drawn.length = 0
    WallRenderer.drawWall(ctx, customWallId, 0, 0, 32, 'up')
    expect(drawn).toContain('data:image/png;base64,mockBlackBack')

    // Draw wall for 'right' direction
    drawn.length = 0
    WallRenderer.drawWall(ctx, customWallId, 0, 0, 32, 'right')
    expect(drawn).toContain('data:image/png;base64,mockGreenRight')

    // Draw wall for 'down' direction
    drawn.length = 0
    WallRenderer.drawWall(ctx, customWallId, 0, 0, 32, 'down')
    expect(drawn).toContain('data:image/png;base64,mockBlueFront')
  })

  it('falls back to default frames if directionalFrames are missing for a direction', () => {
    const singleDirWall: CustomAsset = {
      id: 'custom_wall_single',
      name: 'Parede Simples',
      type: 'wall',
      category: 'Geral',
      width: 1,
      height: 1,
      isObstacle: true,
      frames: ['data:image/png;base64,mockDefaultWall'],
      frameRateMs: 160,
      createdAt: Date.now(),
    }

    customAssetsStore.useCustomAssetsStore.getState().addCustomAsset(singleDirWall)

    const { ctx, drawn } = createMockCtx()

    WallRenderer.drawWall(ctx, 'custom_wall_single', 0, 0, 32, 'up')
    expect(drawn).toContain('data:image/png;base64,mockDefaultWall')
  })
})
