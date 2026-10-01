import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseSubTextureIdentifier,
  formatPresetLabel,
  parseSparrowAtlasAndSlice,
  importPresetsIntoStore,
} from '../engine/avatar/avatarAtlasImporter'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'

describe('avatarAtlasImporter', () => {
  beforeEach(() => {
    useCustomAssetsStore.setState({ customAssets: [] })
  })

  it('should correctly parse subtexture identifiers and direction', () => {
    const p1 = parseSubTextureIdentifier('hair_curly_afro_down_0', 'hair')
    expect(p1.presetKey).toBe('curly_afro')
    expect(p1.direction).toBe('down')

    const p2 = parseSubTextureIdentifier('hair_curly_afro_up_0', 'hair')
    expect(p2.presetKey).toBe('curly_afro')
    expect(p2.direction).toBe('up')

    const p3 = parseSubTextureIdentifier('jacket_bomber_left_1', 'jacket')
    expect(p3.presetKey).toBe('bomber')
    expect(p3.direction).toBe('left')

    const p4 = parseSubTextureIdentifier('jacket_bomber_right_0', 'jacket')
    expect(p4.presetKey).toBe('bomber')
    expect(p4.direction).toBe('right')

    const p5 = parseSubTextureIdentifier('top_tshirt_down', 'top')
    expect(p5.presetKey).toBe('tshirt')
    expect(p5.direction).toBe('down')

    const p6 = parseSubTextureIdentifier('simple_preset', 'hat')
    expect(p6.presetKey).toBe('simple_preset')
    expect(p6.direction).toBe('down')
  })

  it('should format preset labels with title casing', () => {
    expect(formatPresetLabel('curly_afro')).toBe('Curly Afro')
    expect(formatPresetLabel('blush-rosado')).toBe('Blush Rosado')
    expect(formatPresetLabel('jacket_leather_cool')).toBe('Jacket Leather Cool')
  })

  it('should parse Sparrow XML and slice directional frames from an image canvas', async () => {
    const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<TextureAtlas imagePath="hair.png">
  <SubTexture name="hair_cool_cut_down_0" x="0" y="0" width="32" height="32"/>
  <SubTexture name="hair_cool_cut_up_0" x="32" y="0" width="32" height="32"/>
  <SubTexture name="hair_cool_cut_left_0" x="64" y="0" width="32" height="32"/>
  <SubTexture name="hair_cool_cut_right_0" x="96" y="0" width="32" height="32"/>
</TextureAtlas>`

    const mockImage = { width: 128, height: 32 } as any
    const presets = await parseSparrowAtlasAndSlice(sampleXml, mockImage, 'hair')
    expect(presets).toHaveLength(1)
    expect(presets[0].presetKey).toBe('cool_cut')
    expect(presets[0].name).toBe('Cool Cut')
    expect(presets[0].directionalFrames.down).toBeDefined()
    expect(presets[0].directionalFrames.up).toBeDefined()
    expect(presets[0].directionalFrames.left).toBeDefined()
    expect(presets[0].directionalFrames.right).toBeDefined()

    // Test import into store
    const created = importPresetsIntoStore('hair', presets)
    expect(created).toHaveLength(1)
    expect(created[0].avatarSlot).toBe('hair')
    expect(created[0].directionalFrames?.down).toBeDefined()
    expect(useCustomAssetsStore.getState().customAssets).toHaveLength(1)
  })
})
