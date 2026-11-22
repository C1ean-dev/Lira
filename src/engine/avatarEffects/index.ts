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
