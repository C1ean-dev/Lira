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
  '#4c6ef5', // Indigo
  '#20c997', // Teal / Mint
  '#fab005', // Gold / Amber
  '#ff6b6b', // Coral / Red
  '#be4bdb', // Purple / Orchid
  '#339af0', // Sky Blue
  '#ff922b', // Orange
  '#51cf66', // Emerald
  '#f06595', // Rose / Pink
  '#845ef7', // Violet
  '#22b8cf', // Cyan
  '#94d82d', // Lime
  '#e8590c', // Rust
  '#cc5de8', // Magenta
  '#12b886', // Aquamarine
  '#e64980', // Ruby
  '#7048e8', // Deep Violet
  '#15aabf', // Ocean
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

/**
 * Generate a distinct room identification color that is NOT in use by any existing room.
 */
export function getNextAvailableZoneColor(existingZones: { color?: string }[] = []): string {
  const usedColors = new Set(
    existingZones
      .map((z) => (z.color || '').toLowerCase().trim())
      .filter(Boolean)
  )

  // 1. Pick the first preset color not yet taken
  for (const c of ZONE_COLOR_PALETTE) {
    if (!usedColors.has(c.toLowerCase())) {
      return c
    }
  }

  // 2. If all presets are in use, generate a distinct golden-angle HSL hue not in use
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


