import { FurnitureDefinition } from '../types/map'
import { AvatarConfig } from '../types/game'

export const TILE_SIZE = 32

export const DEFAULT_AVATAR: AvatarConfig = {
  skinTone: '#ffd1a4',
  skinDetail: 'smooth',
  eyeType: 'normal',
  eyeColor: '#111111',
  hairStyle: 'none',
  hairColor: '#000000',
  facialHair: 'none',
  facialHairColor: '#000000',
  topType: 'none',
  topColor: '#000000',
  jacketType: 'none',
  jacketColor: '#000000',
  bottomType: 'none',
  bottomColor: '#000000',
  shoesType: 'none',
  shoesColor: '#000000',
  hatType: 'none',
  hatColor: '#000000',
  glassesType: 'none',
  glassesColor: '#000000',
  otherType: 'avatar_other_sliced_1788355059618_ozg3',
  customAvatarId: 'avatar_other_sliced_1788355059618_ozg3',
  otherColor: '#000000',
  pet: { type: 'none' },
}

export const FURNITURE_CATALOG: FurnitureDefinition[] = []

export const ZONE_COLOR_PALETTE = [
  '#4c6ef5',
  '#20c997',
  '#fab005',
  '#ff6b6b',
  '#be4bdb',
  '#339af0',
  '#ff922b',
  '#51cf66',
  '#f06595',
  '#845ef7',
  '#22b8cf',
  '#94d82d',
  '#e8590c',
  '#cc5de8',
  '#12b886',
  '#e64980',
  '#7048e8',
  '#15aabf',
]

function hslToHex(h: number, s: number, l: number): string {
  l /= 100
  const a = (s * Math.min(l, 1 - l)) / 100
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function getNextAvailableZoneColor(existingZones: { color?: string }[] = []): string {
  const usedColors = new Set(
    existingZones
      .map((z) => (z.color || '').toLowerCase().trim())
      .filter(Boolean)
  )

  for (const c of ZONE_COLOR_PALETTE) {
    if (!usedColors.has(c.toLowerCase())) {
      return c
    }
  }

  const count = existingZones.length
  for (let i = 0; i < 360; i += 20) {
    const hue = Math.floor((count * 137.508 + i) % 360)
    const generatedHex = hslToHex(hue, 75, 55)
    if (!usedColors.has(generatedHex.toLowerCase())) {
      return generatedHex
    }
  }

  return ZONE_COLOR_PALETTE[count % ZONE_COLOR_PALETTE.length]
}

