import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createRomanticBedAsset, addBuiltInFurniture } from '../../assets/builtInFurniture'
import { readSpriteFrame } from '../../assets/spriteFrame'
import { encodeValue, decodeValue } from '../../assets/atlasFormat'
import { spriteXml } from '../../assets/sourceSprites'
it('ships a transparent sheet with an idle pose, covered animation and two usable seats', () => {
  const bed = createRomanticBedAsset('./')
  expect(bed).toMatchObject({ name: 'Cama do Amor', type: 'furniture', category: 'Quarto', width: 3, height: 3, seatGrid: [[false, false, false], [true, false, true], [false, false, false]] })
  const png = readFileSync(path.resolve('public/assets/furniture/romantic-bed.png'))
  expect(png.subarray(1, 4).toString()).toBe('PNG')
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20)
  expect(png[25]).toBe(6) // RGBA: preserve the generated transparency.
  const frames = [bed.frames[0], ...bed.bedAnimation!.frames].map(src => readSpriteFrame(src)!)
  expect(frames).toHaveLength(4)
  for (const frame of frames) {
    expect(frame.source).toBe('./assets/furniture/romantic-bed.png')
    expect(frame.width * 2).toBe(width)
    expect(frame.height * 2).toBe(height)
    expect(frame.x + frame.width).toBeLessThanOrEqual(width)
    expect(frame.y + frame.height).toBeLessThanOrEqual(height)
  }
  expect(new Set(frames.map(f => `${f.x}:${f.y}`)).size).toBe(4)
  expect(bed.bedAnimation!.frameRateMs).toBeLessThanOrEqual(200)
})
it('adds the bed without overwriting local edits or restoring a deleted asset, preserving animation metadata through XML', () => {
  const bed = createRomanticBedAsset()
  expect(addBuiltInFurniture([])).toContainEqual(bed)
  const edited = { ...bed, name: 'Minha cama' }
  expect(addBuiltInFurniture([edited]).find(asset => asset.id === bed.id)).toBe(edited)
  expect(addBuiltInFurniture([], [bed.id]).some(asset => asset.id === bed.id)).toBe(false)
  expect(decodeValue(encodeValue(bed, new Map()), name => name)).toEqual(bed)
  const xml = spriteXml(bed, 'romantic-bed.png')
  expect(xml).toContain(`${bed.id}_down_0`)
  expect(xml).toContain(`${bed.id}_bed_0`)
  expect(xml).toContain(`${bed.id}_bed_2`)
})
