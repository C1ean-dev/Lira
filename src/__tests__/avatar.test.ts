import { describe, it, expect } from 'vitest'
import { DEFAULT_AVATAR } from '../engine/Constants'
import { AvatarRenderer } from '../engine/AvatarRenderer'
import { Player } from '../types/game'

describe('Avatar Customizer & Pixel Art Renderer - Expected Behaviors', () => {
  it('should have complete DEFAULT_AVATAR with all neutral Gather layers', () => {
    expect(DEFAULT_AVATAR.skinTone).toBe('#ffd1a4')
    expect(DEFAULT_AVATAR.skinDetail).toBe('smooth')
    expect(DEFAULT_AVATAR.eyeType).toBe('normal')
    expect(DEFAULT_AVATAR.hairStyle).toBe('none')
    expect(DEFAULT_AVATAR.topType).toBe('none')
    expect(DEFAULT_AVATAR.bottomType).toBe('none')
    expect(DEFAULT_AVATAR.shoesType).toBe('none')
    expect(DEFAULT_AVATAR.hatType).toBe('none')
    expect(DEFAULT_AVATAR.glassesType).toBe('none')
    expect(DEFAULT_AVATAR.otherType).toBe('avatar_other_sliced_1788355059618_ozg3')
    expect(DEFAULT_AVATAR.customAvatarId).toBe('avatar_other_sliced_1788355059618_ozg3')
  })

  it('should render avatar to a 2D canvas context without errors in all 4 directions', () => {
    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      ellipse: () => {},
      arc: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      roundRect: () => {},
      fillText: () => {},
      measureText: () => ({ width: 40 }),
    } as unknown as CanvasRenderingContext2D

    const fakePlayer: Player = {
      id: 'test-player',
      name: 'clean',
      x: 10,
      y: 10,
      direction: 'down',
      isMoving: true,
      avatar: { ...DEFAULT_AVATAR },
      status: 'available',
      lastUpdated: Date.now(),
    }

    // Direction DOWN
    expect(() => AvatarRenderer.drawPlayer(mockCtx, fakePlayer, true, 100)).not.toThrow()

    // Direction UP
    fakePlayer.direction = 'up'
    expect(() => AvatarRenderer.drawPlayer(mockCtx, fakePlayer, true, 200)).not.toThrow()

    // Direction LEFT
    fakePlayer.direction = 'left'
    expect(() => AvatarRenderer.drawPlayer(mockCtx, fakePlayer, true, 300)).not.toThrow()

    // Direction RIGHT
    fakePlayer.direction = 'right'
    expect(() => AvatarRenderer.drawPlayer(mockCtx, fakePlayer, true, 400)).not.toThrow()
  })

  it('should support rendering different hairstyles and accessories cleanly', () => {
    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      ellipse: () => {},
      arc: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      roundRect: () => {},
      fillText: () => {},
      measureText: () => ({ width: 40 }),
    } as unknown as CanvasRenderingContext2D

    const fakePlayer: Player = {
      id: 'test-player-2',
      name: 'Aravon',
      x: 5,
      y: 5,
      direction: 'down',
      isMoving: false,
      avatar: {
        ...DEFAULT_AVATAR,
        skinDetail: 'freckles',
        hairStyle: 'long_bangs',
        hairColor: '#9c36b5',
        hatType: 'ribbon_bow',
        glassesType: 'round',
        jacketType: 'cardigan',
        facialHair: 'full_beard',
      },
      status: 'available',
      lastUpdated: Date.now(),
    }

    expect(() => AvatarRenderer.drawPlayer(mockCtx, fakePlayer, false, 0)).not.toThrow()
  })

  it('should render avatar layers from AvatarAtlasManager when atlas subtexture is present', async () => {
    const { AvatarAtlasManager } = await import('../engine/avatar/AvatarAtlasManager')
    AvatarAtlasManager.clearCache()

    const otherXml = `
      <TextureAtlas imagePath="characters.png">
        <SubTexture name="other_hero_down_0" x="10" y="20" width="32" height="32"/>
        <SubTexture name="other_hero_up_0" x="42" y="20" width="32" height="32"/>
        <SubTexture name="other_hero_right_0" x="74" y="20" width="32" height="32"/>
      </TextureAtlas>
    `
    AvatarAtlasManager.registerAtlasXml('other', otherXml)
    const mockImg = {
      complete: true,
      naturalWidth: 96,
      naturalHeight: 64,
    } as unknown as HTMLImageElement
    AvatarAtlasManager.setImage('other', mockImg)

    const drawCalls: any[] = []
    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      ellipse: () => {},
      arc: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      roundRect: () => {},
      fillText: () => {},
      translate: () => {},
      scale: () => {},
      drawImage: (...args: any[]) => {
        drawCalls.push(args)
      },
      measureText: () => ({ width: 40 }),
    } as unknown as CanvasRenderingContext2D

    const fakePlayer: Player = {
      id: 'test-atlas-player',
      name: 'AtlasTester',
      x: 0,
      y: 0,
      direction: 'down',
      isMoving: false,
      avatar: {
        ...DEFAULT_AVATAR,
        otherType: 'hero',
      },
      status: 'available',
      lastUpdated: Date.now(),
    }

    AvatarRenderer.drawPlayer(mockCtx, fakePlayer, false, 0)

    // Verify drawImage was invoked with the subtexture source coordinates (10, 20, 32, 32)
    const atlasDrawCall = drawCalls.find(
      (call) => call[1] === 10 && call[2] === 20 && call[3] === 32 && call[4] === 32
    )
    expect(atlasDrawCall).toBeDefined()
  })

  it('should synthesize left direction via horizontal flip (scale(-1, 1)) from right subtexture', async () => {
    const { AvatarAtlasManager } = await import('../engine/avatar/AvatarAtlasManager')
    AvatarAtlasManager.clearCache()

    const otherXml = `
      <TextureAtlas imagePath="characters.png">
        <SubTexture name="other_hero_right_0" x="74" y="20" width="32" height="32"/>
      </TextureAtlas>
    `
    AvatarAtlasManager.registerAtlasXml('other', otherXml)
    const mockImg = {
      complete: true,
      naturalWidth: 96,
      naturalHeight: 64,
    } as unknown as HTMLImageElement
    AvatarAtlasManager.setImage('other', mockImg)

    let scaledX = 1
    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      ellipse: () => {},
      arc: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      roundRect: () => {},
      fillText: () => {},
      translate: () => {},
      scale: (x: number) => {
        if (x === -1) scaledX = x
      },
      drawImage: () => {},
      measureText: () => ({ width: 40 }),
    } as unknown as CanvasRenderingContext2D

    const fakePlayer: Player = {
      id: 'test-atlas-player-left',
      name: 'AtlasTesterLeft',
      x: 0,
      y: 0,
      direction: 'left',
      isMoving: false,
      avatar: {
        ...DEFAULT_AVATAR,
        otherType: 'hero',
      },
      status: 'available',
      lastUpdated: Date.now(),
    }

    AvatarRenderer.drawPlayer(mockCtx, fakePlayer, false, 0)
    expect(scaledX).toBe(-1)
  })

  it('should fall back to procedural renderer if preset is not present in atlas', async () => {
    const { AvatarAtlasManager } = await import('../engine/avatar/AvatarAtlasManager')
    AvatarAtlasManager.clearCache()

    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      ellipse: () => {},
      arc: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      roundRect: () => {},
      fillText: () => {},
      translate: () => {},
      scale: () => {},
      drawImage: () => {},
      measureText: () => ({ width: 40 }),
    } as unknown as CanvasRenderingContext2D

    const fakePlayer: Player = {
      id: 'test-procedural-fallback',
      name: 'FallbackTester',
      x: 0,
      y: 0,
      direction: 'down',
      isMoving: false,
      avatar: {
        ...DEFAULT_AVATAR,
        hairStyle: 'messy',
        topType: 'kimono',
        glassesType: 'round',
      },
      status: 'available',
      lastUpdated: Date.now(),
    }

    expect(() => AvatarRenderer.drawPlayer(mockCtx, fakePlayer, false, 0)).not.toThrow()
  })

  it('should support rendering retro character in all 4 directions', () => {
    const mockCtx = {
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      ellipse: () => {},
      arc: () => {},
      moveTo: () => {},
      lineTo: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      roundRect: () => {},
      fillText: () => {},
      translate: () => {},
      scale: () => {},
      drawImage: () => {},
      measureText: () => ({ width: 40 }),
    } as unknown as CanvasRenderingContext2D

    for (const dir of ['down', 'left', 'right', 'up'] as const) {
      const testPlayer: Player = {
        id: 'test-retro-player',
        name: 'RetroTester',
        x: 0,
        y: 0,
        direction: dir,
        isMoving: true,
        avatar: { ...DEFAULT_AVATAR },
        status: 'available',
        lastUpdated: Date.now(),
      }
      expect(() => AvatarRenderer.drawPlayer(mockCtx, testPlayer, false, 0)).not.toThrow()
    }
  })
})

