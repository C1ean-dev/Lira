import type {
  AvatarAuraConfig,
  AvatarEffectDensity,
  AvatarEffectMotion,
  AvatarStepsConfig,
} from '../../types/game'
import { DEFAULT_AVATAR_EFFECT_COLOR } from './palette'
import type {
  AuraOptionMeta,
  ParticleShape,
  ResolvedEffectSpec,
  ShapeOptionMeta,
  StepsOptionMeta,
} from './types'

export const SHAPE_OPTIONS: readonly ShapeOptionMeta[] = [
  { id: 'flower', label: 'Flor' },
  { id: 'petal', label: 'Pétala' },
  { id: 'star', label: 'Estrela' },
  { id: 'sparkle', label: 'Brilho' },
  { id: 'heart', label: 'Coração' },
  { id: 'flame', label: 'Fogo' },
  { id: 'ember', label: 'Brasa' },
  { id: 'sunray', label: 'Luz Solar' },
  { id: 'lightning', label: 'Raio' },
  { id: 'snowflake', label: 'Neve' },
  { id: 'leaf', label: 'Folha' },
  { id: 'bubble', label: 'Bolha' },
  { id: 'music', label: 'Música' },
]

export const MOTION_OPTIONS: readonly { id: AvatarEffectMotion; label: string; description: string }[] = [
  { id: 'float', label: 'Flutuar', description: 'Sobe leve balançando' },
  { id: 'rise', label: 'Subir / Chamas', description: 'Sobe rápido como fogo ou bolhas' },
  { id: 'fall', label: 'Cair suave', description: 'Cai devagar como neve ou folhas' },
  { id: 'orbit', label: 'Radiante', description: 'Brilha e irradia ao redor' },
  { id: 'spark', label: 'Faísca', description: 'Estala rápido como energia' },
]

export const DENSITY_OPTIONS: readonly { id: AvatarEffectDensity; label: string }[] = [
  { id: 'subtle', label: 'Sutil' },
  { id: 'normal', label: 'Normal' },
  { id: 'intense', label: 'Intenso' },
]

export const AURA_OPTIONS: readonly AuraOptionMeta[] = [
  {
    id: 'none',
    label: 'Nenhuma',
    description: 'Sem aura ao redor do avatar',
    defaultColor: DEFAULT_AVATAR_EFFECT_COLOR,
    motion: 'float',
    density: 'normal',
    previewShapes: [],
  },
  {
    id: 'floral_stars',
    label: 'Flores e Estrelas',
    description: 'Flores, pétalas e estrelas cintilantes em volta do avatar',
    defaultColor: '#a855f7',
    motion: 'float',
    density: 'normal',
    previewShapes: ['flower', 'star', 'petal'],
  },
  {
    id: 'fire',
    label: 'Fogo',
    description: 'Chamas ardentes e brasas subindo ao redor do avatar',
    defaultColor: '#f97316',
    motion: 'rise',
    density: 'intense',
    glowHalo: true,
    previewShapes: ['flame', 'ember', 'flame'],
  },
  {
    id: 'sunlight',
    label: 'Luz Solar',
    description: 'Halo dourado e raios solares radiantes ao redor do avatar',
    defaultColor: '#facc15',
    motion: 'orbit',
    density: 'normal',
    glowHalo: true,
    previewShapes: ['sunray', 'sparkle', 'star'],
  },
  {
    id: 'lightning',
    label: 'Raio / Energia',
    description: 'Descargas elétricas e faíscas crepitantes',
    defaultColor: '#38bdf8',
    motion: 'spark',
    density: 'intense',
    glowHalo: true,
    previewShapes: ['lightning', 'sparkle'],
  },
  {
    id: 'frost',
    label: 'Gelo / Neve',
    description: 'Flocos de neve e cristais caindo suavemente',
    defaultColor: '#67e8f9',
    motion: 'fall',
    density: 'normal',
    previewShapes: ['snowflake', 'sparkle'],
  },
  {
    id: 'nature',
    label: 'Natureza',
    description: 'Folhas e flores leves flutuando ao vento',
    defaultColor: '#22c55e',
    motion: 'fall',
    density: 'normal',
    previewShapes: ['leaf', 'flower'],
  },
  {
    id: 'hearts',
    label: 'Corações',
    description: 'Corações sutis com brilhos flutuando ao redor',
    defaultColor: '#ec4899',
    motion: 'float',
    density: 'normal',
    previewShapes: ['heart', 'sparkle'],
  },
  {
    id: 'stardust',
    label: 'Poeira Estelar',
    description: 'Estrelas e cintilações orbitando suavemente',
    defaultColor: '#c084fc',
    motion: 'orbit',
    density: 'normal',
    previewShapes: ['star', 'sparkle'],
  },
  {
    id: 'petals',
    label: 'Pétalas',
    description: 'Pétalas delicadas flutuando em volta do avatar',
    defaultColor: '#f472b6',
    motion: 'fall',
    density: 'normal',
    previewShapes: ['petal', 'flower'],
  },
  {
    id: 'bubbles',
    label: 'Bolhas',
    description: 'Bolhas brilhantes subindo suavemente',
    defaultColor: '#38bdf8',
    motion: 'rise',
    density: 'normal',
    previewShapes: ['bubble', 'sparkle'],
  },
  {
    id: 'music',
    label: 'Notas Musicais',
    description: 'Notas musicais flutuando no ritmo ao redor do avatar',
    defaultColor: '#a855f7',
    motion: 'float',
    density: 'normal',
    previewShapes: ['music', 'sparkle'],
  },
]

export const STEPS_OPTIONS: readonly StepsOptionMeta[] = [
  {
    id: 'none',
    label: 'Nenhum',
    description: 'Sem rastro ao caminhar',
    defaultColor: DEFAULT_AVATAR_EFFECT_COLOR,
    motion: 'float',
    density: 'normal',
    previewShapes: [],
  },
  {
    id: 'floral_stars',
    label: 'Flores e Estrelas',
    description: 'Pétalas, flores e estrelinhas acompanhando seus passos',
    defaultColor: '#a855f7',
    motion: 'float',
    density: 'normal',
    previewShapes: ['petal', 'flower', 'star'],
  },
  {
    id: 'fire',
    label: 'Passos de Fogo',
    description: 'Chamas e brasas ardentes atrás dos seus passos',
    defaultColor: '#f97316',
    motion: 'rise',
    density: 'intense',
    previewShapes: ['flame', 'ember'],
  },
  {
    id: 'sunlight',
    label: 'Luz Solar',
    description: 'Raios dourados e brilhos solares pelo caminho',
    defaultColor: '#facc15',
    motion: 'orbit',
    density: 'normal',
    previewShapes: ['sunray', 'sparkle'],
  },
  {
    id: 'lightning',
    label: 'Raios',
    description: 'Faíscas elétricas rápidas a cada passo',
    defaultColor: '#38bdf8',
    motion: 'spark',
    density: 'intense',
    previewShapes: ['lightning', 'sparkle'],
  },
  {
    id: 'frost',
    label: 'Neve / Gelo',
    description: 'Flocos de neve e cristais gelados pelo chão',
    defaultColor: '#67e8f9',
    motion: 'fall',
    density: 'normal',
    previewShapes: ['snowflake', 'sparkle'],
  },
  {
    id: 'nature',
    label: 'Folhas',
    description: 'Folhinhas e flores leves atrás dos passos',
    defaultColor: '#22c55e',
    motion: 'fall',
    density: 'normal',
    previewShapes: ['leaf', 'flower'],
  },
  {
    id: 'petals',
    label: 'Pétalas',
    description: 'Pétalas delicadas que somem suavemente atrás dos passos',
    defaultColor: '#f472b6',
    motion: 'fall',
    density: 'normal',
    previewShapes: ['petal', 'flower'],
  },
  {
    id: 'stars',
    label: 'Estrelas',
    description: 'Brilhos e estrelas cintilantes pelo caminho',
    defaultColor: '#c084fc',
    motion: 'orbit',
    density: 'normal',
    previewShapes: ['star', 'sparkle'],
  },
  {
    id: 'hearts',
    label: 'Corações',
    description: 'Coraçõezinhos pixelados atrás dos passos',
    defaultColor: '#ec4899',
    motion: 'float',
    density: 'normal',
    previewShapes: ['heart', 'sparkle'],
  },
  {
    id: 'bubbles',
    label: 'Bolhas',
    description: 'Bolhas leves subindo de onde você passou',
    defaultColor: '#38bdf8',
    motion: 'rise',
    density: 'normal',
    previewShapes: ['bubble', 'sparkle'],
  },
  {
    id: 'music',
    label: 'Notas Musicais',
    description: 'Notas musicais deixando um rastro melódico',
    defaultColor: '#a855f7',
    motion: 'float',
    density: 'normal',
    previewShapes: ['music', 'sparkle'],
  },
]

const AURA_MAP = new Map(AURA_OPTIONS.map((opt) => [opt.id, opt]))
const STEPS_MAP = new Map(STEPS_OPTIONS.map((opt) => [opt.id, opt]))

export const MIN_AURA_GROUND_CIRCLE_SIZE = 24
export const MAX_AURA_GROUND_CIRCLE_SIZE = 128
export const DEFAULT_AURA_GROUND_CIRCLE_SIZE = 56

export function clampAuraGroundCircleSize(size?: number): number {
  if (typeof size !== 'number' || !Number.isFinite(size)) return DEFAULT_AURA_GROUND_CIRCLE_SIZE
  return Math.max(MIN_AURA_GROUND_CIRCLE_SIZE, Math.min(MAX_AURA_GROUND_CIRCLE_SIZE, Math.round(size)))
}

export function hasNonEmptyPixelMatrix(matrix?: readonly string[]): boolean {
  if (!matrix || matrix.length === 0) return false
  return matrix.some((row) => /[123]/.test(row))
}

export function resolveAuraSpec(config?: AvatarAuraConfig): ResolvedEffectSpec | null {
  if (!config || config.style === 'none') return null

  if (config.style === 'custom') {
    const custom = config.custom
    if (!custom) return null
    const hasMatrix = hasNonEmptyPixelMatrix(custom.pixelMatrix)
    const groundCircle = config.groundCircle ?? custom.groundCircle ?? false
    const groundCircleSize = clampAuraGroundCircleSize(config.groundCircleSize ?? custom.groundCircleSize)
    const shapes: readonly ParticleShape[] =
      custom.shapes.length > 0 ? custom.shapes : (hasMatrix || groundCircle ? [] : ['sparkle'])
    return {
      shapes,
      pixelMatrix: hasMatrix ? custom.pixelMatrix : undefined,
      color: config.color || custom.color || DEFAULT_AVATAR_EFFECT_COLOR,
      motion: custom.motion || 'float',
      density: custom.density || 'normal',
      glowHalo: groundCircle,
      groundCircle,
      groundCircleSize,
    }
  }

  const preset = AURA_MAP.get(config.style)
  if (!preset || preset.previewShapes.length === 0) return null
  const groundCircle = config.groundCircle ?? Boolean(preset.glowHalo)
  const groundCircleSize = clampAuraGroundCircleSize(config.groundCircleSize ?? preset.groundCircleSize)
  return {
    shapes: preset.previewShapes,
    color: config.color || preset.defaultColor,
    motion: preset.motion,
    density: preset.density,
    glowHalo: groundCircle,
    groundCircle,
    groundCircleSize,
  }
}

export function resolveStepsSpec(config?: AvatarStepsConfig): ResolvedEffectSpec | null {
  if (!config || config.style === 'none') return null

  if (config.style === 'custom') {
    const custom = config.custom
    if (!custom) return null
    const hasMatrix = hasNonEmptyPixelMatrix(custom.pixelMatrix)
    const shapes: readonly ParticleShape[] =
      custom.shapes.length > 0 ? custom.shapes : ['sparkle']
    return {
      shapes,
      pixelMatrix: hasMatrix ? custom.pixelMatrix : undefined,
      color: config.color || custom.color || DEFAULT_AVATAR_EFFECT_COLOR,
      motion: custom.motion || 'float',
      density: custom.density || 'normal',
    }
  }

  const preset = STEPS_MAP.get(config.style)
  if (!preset || preset.previewShapes.length === 0) return null
  return {
    shapes: preset.previewShapes,
    color: config.color || preset.defaultColor,
    motion: preset.motion,
    density: preset.density,
  }
}
