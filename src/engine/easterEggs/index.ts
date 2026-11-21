export { EasterEggManager, createCoupleEasterEggEffects } from './EasterEggManager'
export { ARAVON_CLEAN_EASTER_EGG_CONFIG } from './config'
export { WalkingTrailEffect } from './effects/walkingTrailEffect'
export { EntryBurstEffect } from './effects/entryBurstEffect'
export { ProximityEffect } from './effects/proximityEffect'
export { ScreenHeartsBorderEffect } from './effects/screenHeartsBorderEffect'
export {
  normalizeNickname,
  matchesNickname,
  findPlayerPair,
  getSeatedFurnitureId,
  detectPairProximity,
} from './matchers'
export {
  drawPixelShape,
  renderEasterEggParticles,
  stepEasterEggParticles,
} from './pixelSprites'
export type {
  ParticleShape,
  EasterEggPalette,
  EasterEggParticle,
  EasterEggContext,
  EasterEggEffect,
  ProximityReason,
  ProximityMatch,
  WalkingTrailConfig,
  EntryBurstConfig,
  ProximityEffectConfig,
  ScreenHeartsBorderConfig,
  CoupleEasterEggConfig,
} from './types'
