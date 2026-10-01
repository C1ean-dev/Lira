import { describe, it, expect } from 'vitest'
import { generateSparrowXml, packSpritesheet } from '../engine/avatar/avatarAtlasExporter'
import { AvatarAtlasManager } from '../engine/avatar/AvatarAtlasManager'

describe('avatarAtlasExporter - Spritesheet & Sparrow XML Packager', () => {
  it('should generate valid Sparrow XML string matching TexturePacker specification', () => {
    const subTextures = [
      { name: 'hair_messy_down_0', x: 0, y: 0, width: 32, height: 32 },
      { name: 'hair_messy_up_0', x: 32, y: 0, width: 32, height: 32 },
      { name: 'hair_messy_right_0', x: 64, y: 0, width: 32, height: 32 },
    ]

    const xml = generateSparrowXml('hair.png', subTextures)
    expect(xml).toContain('<TextureAtlas imagePath="hair.png">')
    expect(xml).toContain('<SubTexture name="hair_messy_down_0" x="0" y="0" width="32" height="32"')
    expect(xml).toContain('</TextureAtlas>')

    // Must be directly parseable by AvatarAtlasManager without errors
    const parsed = AvatarAtlasManager.parseAtlasXml(xml)
    expect(parsed.imagePath).toBe('hair.png')
    expect(parsed.subTextures.size).toBe(3)
    expect(parsed.subTextures.get('hair_messy_up_0')).toEqual({
      name: 'hair_messy_up_0',
      x: 32,
      y: 0,
      width: 32,
      height: 32,
      frameX: undefined,
      frameY: undefined,
      frameWidth: undefined,
      frameHeight: undefined,
    })
  })

  it('should pack multiple sprite tiles into a compact grid layout', () => {
    const sprites = [
      { name: 'top_kimono_down_0', width: 32, height: 32 },
      { name: 'top_kimono_up_0', width: 32, height: 32 },
      { name: 'top_kimono_right_0', width: 32, height: 32 },
      { name: 'top_hoodie_down_0', width: 32, height: 32 },
    ]

    const packed = packSpritesheet(sprites, { columns: 3 })
    expect(packed.subTextures.length).toBe(4)
    expect(packed.sheetWidth).toBe(96) // 3 cols * 32
    expect(packed.sheetHeight).toBe(64) // 2 rows * 32

    // Check positions
    expect(packed.subTextures[0]).toMatchObject({ name: 'top_kimono_down_0', x: 0, y: 0, width: 32, height: 32 })
    expect(packed.subTextures[1]).toMatchObject({ name: 'top_kimono_up_0', x: 32, y: 0, width: 32, height: 32 })
    expect(packed.subTextures[2]).toMatchObject({ name: 'top_kimono_right_0', x: 64, y: 0, width: 32, height: 32 })
    expect(packed.subTextures[3]).toMatchObject({ name: 'top_hoodie_down_0', x: 0, y: 32, width: 32, height: 32 })
  })

  it('should export and register atlas into AvatarAtlasManager cleanly', () => {
    const sprites = [
      { name: 'hair_punk_down_0', width: 32, height: 32 },
      { name: 'hair_punk_up_0', width: 32, height: 32 },
      { name: 'hair_punk_right_0', width: 32, height: 32 },
    ]

    const { xmlString } = packSpritesheet(sprites, { imagePath: 'test_hair.png' })
    AvatarAtlasManager.registerAtlasXml('test_hair', xmlString)

    expect(AvatarAtlasManager.hasSubTexture('test_hair', 'hair_punk_down_0')).toBe(true)
    expect(AvatarAtlasManager.hasSubTexture('test_hair', 'hair_punk_up_0')).toBe(true)
    expect(AvatarAtlasManager.hasSubTexture('test_hair', 'hair_punk_right_0')).toBe(true)
  })
})
