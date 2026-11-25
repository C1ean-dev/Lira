import type { AvatarEffectPalette, EffectColorPreset } from './types'

export const DEFAULT_AVATAR_EFFECT_COLOR = '#a855f7'

export const AVATAR_EFFECT_COLOR_PRESETS: readonly EffectColorPreset[] = [
  { label: 'Roxo', hex: '#a855f7' },
  { label: 'Lavanda', hex: '#c084fc' },
  { label: 'Rosa', hex: '#ec4899' },
  { label: 'Fogo', hex: '#f97316' },
  { label: 'Solar', hex: '#facc15' },
  { label: 'Azul', hex: '#3b82f6' },
  { label: 'Gelo', hex: '#38bdf8' },
  { label: 'Verde', hex: '#22c55e' },
  { label: 'Vermelho', hex: '#ef4444' },
  { label: 'Branco', hex: '#e2e8f0' },
]

function parseHex(hex: string): [number, number, number] | null {
  const cleaned = hex.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(cleaned)) {
    return [
      parseInt(cleaned[0] + cleaned[0], 16),
      parseInt(cleaned[1] + cleaned[1], 16),
      parseInt(cleaned[2] + cleaned[2], 16),
    ]
  }
  if (/^[0-9a-f]{6}$/i.test(cleaned)) {
    return [
      parseInt(cleaned.slice(0, 2), 16),
      parseInt(cleaned.slice(2, 4), 16),
      parseInt(cleaned.slice(4, 6), 16),
    ]
  }
  return null
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `#${clamp(r).toString(16).padStart(2, '0')}${clamp(g).toString(16).padStart(2, '0')}${clamp(b).toString(16).padStart(2, '0')}`
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  weightB: number
): string {
  const w = Math.max(0, Math.min(1, weightB))
  return rgbToHex(
    a[0] * (1 - w) + b[0] * w,
    a[1] * (1 - w) + b[1] * w,
    a[2] * (1 - w) + b[2] * w
  )
}

export function hexToRgba(hex: string, alpha: number): string {
  const rgb = parseHex(hex) || parseHex(DEFAULT_AVATAR_EFFECT_COLOR)!
  const clampedAlpha = Math.max(0, Math.min(1, alpha))
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clampedAlpha.toFixed(3)})`
}

const paletteCache = new Map<string, AvatarEffectPalette>()

export function deriveEffectPalette(hexColor?: string): AvatarEffectPalette {
  const key = (hexColor || DEFAULT_AVATAR_EFFECT_COLOR).trim().toLowerCase()
  const cached = paletteCache.get(key)
  if (cached) return cached

  const rgb = parseHex(key) || parseHex(DEFAULT_AVATAR_EFFECT_COLOR)!
  const white: [number, number, number] = [255, 255, 255]
  const dark: [number, number, number] = [24, 14, 34]
  const warmYellow: [number, number, number] = [254, 240, 138]
  const warmRed: [number, number, number] = [239, 68, 68]
  const magentaTint: [number, number, number] = [232, 121, 249]

  const primary = rgbToHex(rgb[0], rgb[1], rgb[2])
  const softLight = mixRgb(rgb, white, 0.32)
  const pastel = mixRgb(rgb, white, 0.62)
  const highlight = mixRgb(rgb, white, 0.88)
  const outline = mixRgb(rgb, dark, 0.56)
  const warmAccent = mixRgb(rgb, magentaTint, 0.22)
  const hotCore = mixRgb(rgb, warmYellow, 0.55)
  const emberDeep = mixRgb(rgb, warmRed, 0.35)

  const palette: AvatarEffectPalette = {
    flowerPrimary: primary,
    flowerSecondary: softLight,
    flowerCenter: '#fef08a',
    petals: [softLight, pastel, primary, warmAccent],
    stars: [highlight, pastel, softLight, primary],
    hearts: [softLight, primary, warmAccent, pastel],
    flames: [primary, hotCore, emberDeep, softLight],
    highlight,
    outline,
  }

  if (paletteCache.size > 128) paletteCache.clear()
  paletteCache.set(key, palette)
  return palette
}
