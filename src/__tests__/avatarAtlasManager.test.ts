import { describe, it, expect, beforeEach } from 'vitest'
import { AvatarAtlasManager, SubTexture } from '../engine/avatar/AvatarAtlasManager'

describe('AvatarAtlasManager - Sparrow XML Parsing and Caching', () => {
  beforeEach(() => {
    AvatarAtlasManager.clearCache()
  })

  it('should parse valid Sparrow / TexturePacker XML and return subtextures with coordinates', () => {
    const validXml = `
      <TextureAtlas imagePath="hair.png">
        <SubTexture name="hair_anime_down_0" x="0" y="0" width="32" height="32" frameX="0" frameY="0" frameWidth="32" frameHeight="32"/>
        <SubTexture name="hair_anime_up_0" x="32" y="0" width="32" height="32"/>
        <SubTexture name="hair_anime_right_0" x="64" y="0" width="32" height="32"/>
      </TextureAtlas>
    `

    const atlas = AvatarAtlasManager.parseAtlasXml(validXml)

    expect(atlas).toBeDefined()
    expect(atlas.imagePath).toBe('hair.png')
    expect(atlas.subTextures.size).toBe(3)

    const down0 = atlas.subTextures.get('hair_anime_down_0')
    expect(down0).toEqual<SubTexture>({
      name: 'hair_anime_down_0',
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      frameX: 0,
      frameY: 0,
      frameWidth: 32,
      frameHeight: 32,
    })

    const up0 = atlas.subTextures.get('hair_anime_up_0')
    expect(up0).toEqual<SubTexture>({
      name: 'hair_anime_up_0',
      x: 32,
      y: 0,
      width: 32,
      height: 32,
    })
  })

  it('should gracefully handle malformed or empty XML without throwing', () => {
    const invalidXml = `<UnclosedTag<`
    const atlas = AvatarAtlasManager.parseAtlasXml(invalidXml)
    expect(atlas).toBeDefined()
    expect(atlas.subTextures.size).toBe(0)

    const emptyXml = ``
    const emptyAtlas = AvatarAtlasManager.parseAtlasXml(emptyXml)
    expect(emptyAtlas.subTextures.size).toBe(0)
  })

  it('should skip subtextures with missing or invalid numeric coordinates', () => {
    const xmlWithInvalidAttrs = `
      <TextureAtlas imagePath="test.png">
        <SubTexture name="valid" x="10" y="20" width="30" height="40"/>
        <SubTexture name="no_x" y="20" width="30" height="40"/>
        <SubTexture name="nan_coord" x="abc" y="20" width="30" height="40"/>
      </TextureAtlas>
    `

    const atlas = AvatarAtlasManager.parseAtlasXml(xmlWithInvalidAttrs)
    expect(atlas.subTextures.size).toBe(1)
    expect(atlas.subTextures.has('valid')).toBe(true)
    expect(atlas.subTextures.has('no_x')).toBe(false)
    expect(atlas.subTextures.has('nan_coord')).toBe(false)
  })

  it('should register and look up subtextures by category in O(1)', () => {
    const hairXml = `
      <TextureAtlas imagePath="hair.png">
        <SubTexture name="hair_messy_down_0" x="0" y="0" width="32" height="32"/>
      </TextureAtlas>
    `

    AvatarAtlasManager.registerAtlasXml('hair', hairXml)

    expect(AvatarAtlasManager.hasSubTexture('hair', 'hair_messy_down_0')).toBe(true)
    expect(AvatarAtlasManager.hasSubTexture('hair', 'non_existent')).toBe(false)

    const sub = AvatarAtlasManager.getSubTexture('hair', 'hair_messy_down_0')
    expect(sub).toBeDefined()
    expect(sub?.x).toBe(0)
    expect(sub?.width).toBe(32)
  })

  it('should clear cache cleanly when requested', () => {
    const hairXml = `
      <TextureAtlas imagePath="hair.png">
        <SubTexture name="hair_messy_down_0" x="0" y="0" width="32" height="32"/>
      </TextureAtlas>
    `
    AvatarAtlasManager.registerAtlasXml('hair', hairXml)
    expect(AvatarAtlasManager.hasSubTexture('hair', 'hair_messy_down_0')).toBe(true)

    AvatarAtlasManager.clearCache()
    expect(AvatarAtlasManager.hasSubTexture('hair', 'hair_messy_down_0')).toBe(false)
  })

  it('should successfully parse the actual sample hair.xml atlas file from disk', async () => {
    // Vite raw import loads the file content directly without node fs shim issues
    const { default: xmlContent } = await import('../../public/assets/avatar/hair.xml?raw')

    const atlas = AvatarAtlasManager.parseAtlasXml(xmlContent)
    expect(atlas.imagePath).toBe('hair.png')
    expect(atlas.subTextures.size).toBe(6)
    expect(atlas.subTextures.has('hair_messy_down_0')).toBe(true)
    expect(atlas.subTextures.has('hair_anime_right_0')).toBe(true)
  })
})

