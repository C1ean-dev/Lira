import { expect, it } from 'vitest'
import { characterAnimationTabs, editCharacterAnimation, activityTextureName } from '../../utils/characterAnimations'
import { parseSubTextureIdentifier, parseSparrowAtlasAndSlice } from '../../engine/avatar/avatarAtlasImporter'
import { generateSparrowXml } from '../../engine/avatar/avatarAtlasExporter'
import { avatarAnimationOptions } from '../../utils/avatarAnimationOptions'
import { convertAssetToSlicedPresets, convertXmlToSlicedPresets } from '../../utils/avatarAssetOrigin'
import type { SlicedPreset } from '../../components/avatar-customizer/AvatarSpritesheetSlicerModal'
import type { CustomAsset } from '../../types/customAsset'
const walk = { x: 0, y: 0, w: 16, h: 32, dataUrl: 'walking' }
const dance = { x: 32, y: 0, w: 16, h: 32, dataUrl: 'dance', sheetId: 'second' }
const base: SlicedPreset = { id: 'hero', name: 'Hero', directions: { down: [walk], up: [], left: [], right: [] }, animations: { yawn: [walk] } }
it('creates, renames and removes only the chosen activity, retaining stable IDs and every frame', () => {
  const created = editCharacterAnimation(base, { type: 'create', id: 'custom-one', name: '  Minha dança! 💃  ' })
  expect(characterAnimationTabs(created).at(-1)).toEqual({ id: 'custom-one', label: 'Minha dança! 💃' })
  created.animations!['custom-one'] = [dance, dance]
  const renamed = editCharacterAnimation(created, { type: 'rename', id: 'custom-one', name: 'Dançar & celebrar <3' })
  expect(renamed.animations!['custom-one']).toBe(created.animations!['custom-one'])
  expect(renamed.animationNames!['custom-one']).toBe('Dançar & celebrar <3')
  expect(renamed.directions).toBe(base.directions)
  expect(renamed.animations!.yawn).toBe(base.animations!.yawn)
  const removed = editCharacterAnimation(renamed, { type: 'delete', id: 'custom-one' })
  expect(removed.animations!['custom-one']).toBeUndefined()
  expect(removed.animationNames!['custom-one']).toBeUndefined()
  expect(base.animations).toEqual({ yawn: [walk] })
})
it('rejects empty or duplicate display names and preserves built-in activities', () => {
  for (const name of ['', '   ', 'Caminhar', ' dormir ', 'BOCEJAR']) expect(() => editCharacterAnimation(base, { type: 'create', id: 'custom', name })).toThrow()
  const created = editCharacterAnimation(base, { type: 'create', id: 'custom', name: 'Meu nome' })
  expect(() => editCharacterAnimation(created, { type: 'create', id: 'other', name: 'meu NOME' })).toThrow()
  expect(() => editCharacterAnimation(base, { type: 'delete', id: 'walk' })).toThrow()
  expect(editCharacterAnimation(base, { type: 'create', id: 'custom', name: '__proto__' }).animationNames!.custom).toBe('__proto__')
})
it('shows the exact user name in the mini display and when reopening editor presets', () => {
  const asset = { id: 'hero', name: 'Hero', frames: ['walking'], width: 1, height: 1, activityAnimations: { custom: ['dance'] }, activityAnimationNames: { custom: 'mEu Nome_🎉!' } } as CustomAsset
  expect(avatarAnimationOptions({ customAvatarId: 'hero' } as any, [asset])).toEqual([{ id: 'custom', label: 'mEu Nome_🎉!', emoji: '🎭' }])
  const preset = convertAssetToSlicedPresets(asset)[0]
  expect(preset.animationNames).toEqual(asset.activityAnimationNames)
  expect(preset.animations!.custom.map(frame => frame.dataUrl)).toEqual(['dance'])
})
it('keeps the existing Sparrow names for automatic yawning and sleeping', () => {
  expect(activityTextureName('other', 'hero', 'yawn', 'Bocejar', 0)).toBe('other_hero_yawn_0')
  expect(activityTextureName('other', 'hero', 'sleep', 'Dormir', 1)).toBe('other_hero_sleep_1')
})
it('round trips custom activity IDs and free names through Sparrow export and import', async () => {
  const name = 'Acenar "oi" & dançar <3 🎉'
  const texture = activityTextureName('other', 'hero', 'custom-one', name, 0)
  expect(parseSubTextureIdentifier(texture, 'other')).toEqual({ presetKey: 'hero', direction: 'down', animation: 'custom-one', animationName: name })
  const xml = generateSparrowXml('hero.png', [
    { name: 'other_hero_down_0', x: 0, y: 0, width: 16, height: 32 },
    { name: texture, x: 16, y: 0, width: 16, height: 32 },
  ])
  const [parsed] = await parseSparrowAtlasAndSlice(xml, { width: 32, height: 32 } as HTMLCanvasElement, 'other')
  expect(parsed.activityAnimationNames).toEqual({ 'custom-one': name })
  expect(parsed.activityAnimations!['custom-one']).toHaveLength(1)
  expect(parsed.slicerPresets![0].animationNames).toEqual({ 'custom-one': name })
  const preset = convertXmlToSlicedPresets({ id: 'hero', name: 'Hero', avatarSlot: 'other', frames: ['walking'], activityAnimations: { 'custom-one': ['dance'] } } as CustomAsset, xml)[0]
  expect(preset.directions.down.map(frame => frame.dataUrl)).toEqual(['walking'])
  expect(preset.animations!['custom-one'][0]).toMatchObject({ x: 16, y: 0, dataUrl: 'dance' })
  expect(preset.animationNames!['custom-one']).toBe(name)
})
