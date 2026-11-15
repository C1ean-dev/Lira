import type { SlicedPreset } from '../components/avatar-customizer/AvatarSpritesheetSlicerModal'

export const DEFAULT_CHARACTER_ANIMATIONS = [
  { id: 'walk', label: 'Caminhar' }, { id: 'yawn', label: 'Bocejar' }, { id: 'sleep', label: 'Dormir' },
]
export function characterAnimationTabs(preset: Pick<SlicedPreset, 'animations' | 'animationNames'>) {
  return [...DEFAULT_CHARACTER_ANIMATIONS, ...Object.keys(preset.animations || {})
    .filter(id => id !== 'none' && !DEFAULT_CHARACTER_ANIMATIONS.some(item => item.id === id))
    .map(id => ({ id, label: preset.animationNames?.[id] || id }))]
}
type AnimationChange = { type: 'create' | 'rename'; id: string; name: string } | { type: 'delete'; id: string }
export function editCharacterAnimation(preset: SlicedPreset, action: AnimationChange): SlicedPreset {
  if (DEFAULT_CHARACTER_ANIMATIONS.some(item => item.id === action.id) || action.id === 'none') throw new Error('Esta animação padrão é reservada.')
  if (action.type === 'delete') return { ...preset,
    animations: Object.fromEntries(Object.entries(preset.animations || {}).filter(([id]) => id !== action.id)),
    animationNames: Object.fromEntries(Object.entries(preset.animationNames || {}).filter(([id]) => id !== action.id)),
  }
  const name = action.name.trim()
  if (!name || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Digite um nome para a animação, sem caracteres de controle.')
  const fold = (value: string) => value.normalize('NFKC').toLocaleLowerCase('pt-BR')
  if (characterAnimationTabs(preset).some(item => item.id !== (action.type === 'rename' ? action.id : '') && (fold(item.label) === fold(name) || fold(item.id) === fold(name)))) throw new Error('Já existe uma animação com esse nome.')
  if (action.type === 'create' && Object.prototype.hasOwnProperty.call(preset.animations || {}, action.id)) throw new Error('Esta animação já existe.')
  return { ...preset, animations: action.type === 'create' ? { ...preset.animations, [action.id]: [] } : preset.animations,
    animationNames: { ...preset.animationNames, [action.id]: name } }
}

// Encode both ID and display name in an unambiguous, XML-safe subtexture suffix.
export function activityTextureName(category: string, preset: string, id: string, label: string, index: number): string {
  if (id === 'yawn' || id === 'sleep') return `${category}_${preset}_${id}_${index}`
  const encoded = Array.from(new TextEncoder().encode(JSON.stringify([id, label])), byte => byte.toString(16).padStart(2, '0')).join('')
  return `${category}_${preset}_activity_${encoded}_${index}`
}
export function parseActivityTextureName(name: string): { presetKey: string; animation: string; animationName: string } | undefined {
  const match = name.match(/^(.*)_activity_([a-f0-9]+)_\d+$/i)
  if (!match || match[2].length % 2) return undefined
  try {
    const bytes = Uint8Array.from(match[2].match(/../g)!, hex => parseInt(hex, 16))
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!Array.isArray(value) || value.length !== 2 || value.some(item => typeof item !== 'string' || !item) || ['walk', 'none', '__proto__', 'constructor', 'prototype'].includes(value[0])) return undefined
    return { presetKey: match[1], animation: value[0], animationName: value[1] }
  } catch { return undefined }
}
