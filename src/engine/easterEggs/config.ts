import type { CoupleEasterEggConfig } from './types'

export const ARAVON_CLEAN_EASTER_EGG_CONFIG: CoupleEasterEggConfig = {
  id: 'aravon-clean',
  palette: {
    flowerPrimary: '#a855f7',
    flowerSecondary: '#c084fc',
    flowerCenter: '#fef08a',
    petals: ['#c084fc', '#d8b4fe', '#a855f7', '#e879f9'],
    stars: ['#f3e8ff', '#d8b4fe', '#c084fc', '#e9d5ff'],
    hearts: ['#c084fc', '#a855f7', '#e879f9', '#d946ef'],
    highlight: '#faf5ff',
    outline: '#581c87',
  },
  walkingTrail: {
    enabled: true,
    targets: ['aravon'],
    stepDistanceTiles: 0.34,
    teleportThresholdTiles: 3.5,
    maxParticles: 80,
  },
  entryBurst: {
    enabled: true,
    targets: ['aravon'],
    reentryGraceMs: 1500,
    particleCount: 26,
    maxParticles: 96,
  },
  proximity: {
    enabled: true,
    pairs: [['aravon', 'clean']],
    maxDistanceTiles: 2.15,
    tableProximityPaddingTiles: 1.25,
    emitIntervalSec: 0.44,
    maxParticles: 64,
  },
  screenHeartsBorder: {
    enabled: true,
    targets: ['aravon'],
    heartCount: 24,
    accentSparkleCount: 12,
    marginPx: 38,
  },
}
