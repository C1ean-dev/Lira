export { AvatarEffectsManager, createDefaultAvatarEffects } from './AvatarEffectsManager'
export { AuraEffect } from './effects/auraEffect'
export { StepsTrailEffect } from './effects/stepsTrailEffect'
export {
  DEFAULT_AVATAR_EFFECT_COLOR,
  AVATAR_EFFECT_COLOR_PRESETS,
  deriveEffectPalette,
  hexToRgba,
} from './palette'
export {
  AURA_OPTIONS,
  STEPS_OPTIONS,
  SHAPE_OPTIONS,
  MOTION_OPTIONS,
  DENSITY_OPTIONS,
  MIN_AURA_GROUND_CIRCLE_SIZE,
  MAX_AURA_GROUND_CIRCLE_SIZE,
  DEFAULT_AURA_GROUND_CIRCLE_SIZE,
  clampAuraGroundCircleSize,
  resolveAuraSpec,
  resolveStepsSpec,
  hasNonEmptyPixelMatrix,
} from './presets'
export {
  SHAPE_MATRICES,
  drawPixelMatrix,
  drawPixelShape,
  resolveParticleColors,
  renderEffectParticles,
  stepEffectParticles,
} from './pixelSprites'
export {
  drawAuraGroundCircle,
  drawAvatarAuraPreview,
  drawAvatarStepsPreview,
  drawEffectPresetIcon,
} from './previewRenderer'
export {
  loadCustomAvatarEffects,
  saveCustomAvatarEffect,
  deleteCustomAvatarEffect,
} from './customEffectStorage'
export type {
  ParticleShape,
  AvatarEffectPalette,
  AvatarEffectParticle,
  AvatarEffectContext,
  AvatarEffectModule,
  ResolvedEffectSpec,
  AuraOptionMeta,
  StepsOptionMeta,
  ShapeOptionMeta,
  EffectColorPreset,
} from './types'
