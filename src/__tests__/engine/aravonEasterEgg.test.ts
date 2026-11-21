import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AVATAR } from '../../engine/Constants'
import {
  ARAVON_CLEAN_EASTER_EGG_CONFIG,
  EasterEggManager,
  EntryBurstEffect,
  ProximityEffect,
  ScreenHeartsBorderEffect,
  WalkingTrailEffect,
  createCoupleEasterEggEffects,
  detectPairProximity,
  findPlayerPair,
  matchesNickname,
} from '../../engine/easterEggs'
import type { EasterEggContext, EasterEggEffect } from '../../engine/easterEggs'
import type { CustomAsset } from '../../types/customAsset'
import type { Player } from '../../types/game'
import type { MapData } from '../../types/map'
import type { BedSession } from '../../store/useBedStore'

function makePlayer(overrides: Partial<Player> & { id: string; name: string }): Player {
  return {
    x: 10,
    y: 10,
    direction: 'down',
    isMoving: false,
    avatar: { ...DEFAULT_AVATAR },
    status: 'available',
    currentZoneId: null,
    lastUpdated: 0,
    ...overrides,
  }
}

function makeMap(overrides: Partial<MapData> = {}): MapData {
  return {
    id: 'test-map',
    name: 'Test Map',
    width: 40,
    height: 30,
    tileSize: 32,
    spawnPoint: { x: 10, y: 10 },
    floors: [],
    walls: [],
    furniture: [],
    zones: [],
    ...overrides,
  }
}

function makeContext(overrides: Partial<EasterEggContext> = {}): EasterEggContext {
  return {
    localPlayer: makePlayer({ id: 'local-default', name: 'Viewer' }),
    players: [],
    map: makeMap(),
    roomKey: 'room-1',
    bedSessions: {},
    getAssetById: () => undefined,
    now: 1000,
    ...overrides,
  }
}

function makeMockCanvasCtx() {
  const fillRect = vi.fn()
  const save = vi.fn()
  const restore = vi.fn()
  return {
    fillRect,
    save,
    restore,
    fillStyle: '',
    globalAlpha: 1,
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D & { fillRect: ReturnType<typeof vi.fn> }
}

describe('Aravon & Clean modular easter eggs', () => {
  it('matches aravon and clean nicknames case-insensitively and ignores other players', () => {
    const aravon = makePlayer({ id: 'p1', name: '  ArAvOn ' })
    const clean = makePlayer({ id: 'p2', name: 'CLEAN' })
    const stranger = makePlayer({ id: 'p3', name: 'Visitante' })

    expect(matchesNickname(aravon, ['aravon'])).toBe(true)
    expect(matchesNickname(stranger, ['aravon'])).toBe(false)

    const pair = findPlayerPair([stranger, aravon, clean], 'aravon', 'clean')
    expect(pair).not.toBeNull()
    expect(pair?.[0].id).toBe('p1')
    expect(pair?.[1].id).toBe('p2')

    expect(findPlayerPair([stranger, aravon], 'aravon', 'clean')).toBeNull()
  })

  it('spawns purple flower/star trail behind aravon when walking, but not on teleports or other players', () => {
    const trail = new WalkingTrailEffect(
      'trail',
      ARAVON_CLEAN_EASTER_EGG_CONFIG.walkingTrail,
      ARAVON_CLEAN_EASTER_EGG_CONFIG.palette,
      () => 0.5
    )

    const aravon = makePlayer({ id: 'a1', name: 'Aravon', x: 5, y: 5, direction: 'right', isMoving: true })
    const other = makePlayer({ id: 'o1', name: 'Outro', x: 12, y: 5, direction: 'right', isMoving: true })

    // First frame registers initial position
    trail.update(0.05, makeContext({ players: [aravon, other], now: 1000 }))
    expect(trail.getParticles()).toHaveLength(0)

    // Move only the other player -> still 0 particles
    other.x = 14
    trail.update(0.05, makeContext({ players: [aravon, other], now: 1050 }))
    expect(trail.getParticles()).toHaveLength(0)

    // Move aravon gradually -> spawns purple trail particles
    aravon.x = 5.5
    trail.update(0.05, makeContext({ players: [aravon, other], now: 1100 }))
    aravon.x = 6.0
    trail.update(0.05, makeContext({ players: [aravon, other], now: 1150 }))
    expect(trail.getParticles().length).toBeGreaterThanOrEqual(2)

    // Teleport aravon far away -> ignored without spawning a streak
    const countBeforeTeleport = trail.getParticles().length
    aravon.x = 25
    trail.update(0.01, makeContext({ players: [aravon, other], now: 1160 }))
    expect(trail.getParticles().length).toBe(countBeforeTeleport)

    // Renders crisp pixels onto ground canvas
    const ctx = makeMockCanvasCtx()
    trail.renderGround(ctx, 1200)
    expect(ctx.fillRect).toHaveBeenCalled()

    // Particles expire cleanly over time
    for (let i = 0; i < 30; i++) {
      trail.update(0.1, makeContext({ players: [aravon, other], now: 1200 + i * 100 }))
    }
    expect(trail.getParticles()).toHaveLength(0)
  })

  it('fires entry burst once when aravon appears, and again on room change or re-entry after grace period', () => {
    const burst = new EntryBurstEffect(
      'burst',
      ARAVON_CLEAN_EASTER_EGG_CONFIG.entryBurst,
      ARAVON_CLEAN_EASTER_EGG_CONFIG.palette,
      () => 0.4
    )

    const clean = makePlayer({ id: 'c1', name: 'clean', x: 8, y: 8 })
    const aravon = makePlayer({ id: 'a1', name: 'aravon', x: 10, y: 10 })

    // Only clean present -> no burst
    burst.update(0.05, makeContext({ players: [clean], roomKey: 'room-A', now: 1000 }))
    expect(burst.getParticles()).toHaveLength(0)

    // Aravon enters -> burst fires!
    burst.update(0.05, makeContext({ players: [clean, aravon], roomKey: 'room-A', now: 1100 }))
    const initialCount = burst.getParticles().length
    expect(initialCount).toBe(ARAVON_CLEAN_EASTER_EGG_CONFIG.entryBurst.particleCount)

    // Staying in the room does NOT re-trigger
    burst.update(0.05, makeContext({ players: [clean, aravon], roomKey: 'room-A', now: 1200 }))
    expect(burst.getParticles().length).toBe(initialCount)

    // Let particles expire while she leaves past reentryGraceMs
    for (let t = 0; t < 30; t++) {
      burst.update(0.1, makeContext({ players: [clean], roomKey: 'room-A', now: 1300 + t * 100 }))
    }
    expect(burst.getParticles()).toHaveLength(0)

    // She rejoins -> burst fires again!
    burst.update(0.05, makeContext({ players: [clean, aravon], roomKey: 'room-A', now: 5000 }))
    expect(burst.getParticles().length).toBe(ARAVON_CLEAN_EASTER_EGG_CONFIG.entryBurst.particleCount)

    // Switching room while present -> burst fires again!
    burst.reset()
    burst.update(0.05, makeContext({ players: [aravon], roomKey: 'room-A', now: 6000 }))
    for (let t = 0; t < 30; t++) {
      burst.update(0.1, makeContext({ players: [aravon], roomKey: 'room-A', now: 6100 + t * 100 }))
    }
    expect(burst.getParticles()).toHaveLength(0)

    burst.update(0.05, makeContext({ players: [aravon], roomKey: 'room-B', now: 9500 }))
    expect(burst.getParticles().length).toBe(ARAVON_CLEAN_EASTER_EGG_CONFIG.entryBurst.particleCount)
  })

  it('triggers proximity hearts only between aravon and clean when close, on same bed/seat, or at same table', () => {
    const aravon = makePlayer({ id: 'a1', name: 'aravon', x: 10, y: 10 })
    const clean = makePlayer({ id: 'c1', name: 'Clean', x: 11.5, y: 10 })
    const stranger = makePlayer({ id: 's1', name: 'Amigo', x: 10.5, y: 10 })

    // Close together (1.5 tiles) -> proximity match
    const closeMatch = detectPairProximity(aravon, clean, makeMap(), {}, () => undefined, 2.15, 1.25)
    expect(closeMatch?.reason).toBe('proximity')

    // Different zones -> no match
    const diffZoneMatch = detectPairProximity(
      { ...aravon, currentZoneId: 'z1' },
      { ...clean, currentZoneId: 'z2' },
      makeMap(),
      {},
      () => undefined,
      2.15,
      1.25
    )
    expect(diffZoneMatch).toBeNull()

    // Far apart -> no match
    const farClean = { ...clean, x: 20, y: 10 }
    expect(detectPairProximity(aravon, farClean, makeMap(), {}, () => undefined, 2.15, 1.25)).toBeNull()

    // Same furniture seat (e.g. wide bed or sofa > 2 tiles apart) -> seat match
    const sameSeatMatch = detectPairProximity(
      { ...aravon, x: 10, y: 10, seatedOn: 'bed-1:0:0' },
      { ...clean, x: 13, y: 10, seatedOn: 'bed-1:0:2' },
      makeMap(),
      {},
      () => undefined,
      2.15,
      1.25
    )
    expect(sameSeatMatch?.reason).toBe('seat')

    // Active bed session -> bed match
    const bedSession: BedSession = {
      id: 'bs-1',
      roomId: 'room-1',
      furnitureId: 'bed-99',
      initiatorId: 'a1',
      targetId: 'c1',
      createdAt: 1000,
      stage: 'active',
      acceptedAt: 1050,
    }
    const bedMatch = detectPairProximity(
      aravon,
      farClean,
      makeMap({ furniture: [{ id: 'bed-99', defId: 'bed-asset', x: 10, y: 10 }] }),
      { 'bed-99': bedSession },
      () => undefined,
      2.15,
      1.25
    )
    expect(bedMatch?.reason).toBe('bed')

    // Same table (sitting on opposite sides of a 3-tile desk) -> table match
    const tableAsset: CustomAsset = {
      id: 'mesa-1',
      name: 'Mesa de Jantar',
      type: 'furniture',
      category: 'desks',
      width: 3,
      height: 2,
      isObstacle: true,
      frames: ['data:image/png;base64,AA=='],
      createdAt: 0,
    }
    const tableMap = makeMap({
      furniture: [{ id: 'f-table', defId: 'mesa-1', x: 10, y: 10 }],
    })
    const tableMatch = detectPairProximity(
      { ...aravon, x: 9, y: 10.5 },
      { ...clean, x: 13, y: 10.5 },
      tableMap,
      {},
      (id) => (id === 'mesa-1' ? tableAsset : undefined),
      2.15,
      1.25
    )
    expect(tableMatch?.reason).toBe('table')

    // ProximityEffect only emits when aravon + clean are close, never for aravon + stranger
    const proximity = new ProximityEffect(
      'prox',
      ARAVON_CLEAN_EASTER_EGG_CONFIG.proximity,
      ARAVON_CLEAN_EASTER_EGG_CONFIG.palette,
      () => 0.2
    )

    proximity.update(0.05, makeContext({ players: [aravon, stranger], now: 1000 }))
    expect(proximity.getParticles()).toHaveLength(0)

    proximity.update(0.05, makeContext({ players: [aravon, clean, stranger], now: 1100 }))
    expect(proximity.getParticles().length).toBeGreaterThanOrEqual(2)
    expect(proximity.getParticles().some((p) => p.shape === 'heart')).toBe(true)
  })

  it('supports modular registration, toggling, and rendering via EasterEggManager', () => {
    const manager = new EasterEggManager(createCoupleEasterEggEffects(ARAVON_CLEAN_EASTER_EGG_CONFIG, () => 0.3))
    expect(manager.listEffects().map((e) => e.id)).toEqual([
      'aravon-clean:walking-trail',
      'aravon-clean:entry-burst',
      'aravon-clean:proximity',
      'aravon-clean:screen-hearts-border',
    ])

    const customSpy = vi.fn()
    const customEffect: EasterEggEffect = {
      id: 'custom:test',
      enabled: true,
      update: customSpy,
    }
    manager.registerEffect(customEffect)
    manager.update(0.05, makeContext({ now: 1000 }))
    expect(customSpy).toHaveBeenCalledTimes(1)

    expect(manager.setEffectEnabled('aravon-clean:walking-trail', false)).toBe(true)
    expect(manager.getEffect('aravon-clean:walking-trail')?.enabled).toBe(false)

    manager.setEnabled(false)
    manager.update(0.05, makeContext({ now: 1100 }))
    expect(customSpy).toHaveBeenCalledTimes(1)

    expect(manager.unregisterEffect('custom:test')).toBe(true)
    expect(manager.getEffect('custom:test')).toBeUndefined()
  })

  it('renders screen-border hearts ONLY on aravon local screen and never on clean or others', () => {
    const border = new ScreenHeartsBorderEffect(
      'border',
      ARAVON_CLEAN_EASTER_EGG_CONFIG.screenHeartsBorder,
      ARAVON_CLEAN_EASTER_EGG_CONFIG.palette,
      () => 0.4
    )

    const aravon = makePlayer({ id: 'a1', name: 'Aravon', x: 10, y: 10 })
    const clean = makePlayer({ id: 'c1', name: 'clean', x: 11, y: 10 })

    // On clean's screen (even with aravon in the room) -> nothing drawn
    border.update(0.05, makeContext({ localPlayer: clean, players: [clean, aravon], now: 1000 }))
    expect(border.isActiveForLocalViewer()).toBe(false)
    const cleanCtx = makeMockCanvasCtx()
    border.renderScreenOverlay(cleanCtx, 1280, 720, 1000)
    expect(cleanCtx.fillRect).not.toHaveBeenCalled()

    // On aravon's screen -> draws purple pixel hearts around the viewport border
    border.update(0.05, makeContext({ localPlayer: aravon, players: [aravon, clean], now: 1050 }))
    expect(border.isActiveForLocalViewer()).toBe(true)
    const aravonCtx = makeMockCanvasCtx()
    border.renderScreenOverlay(aravonCtx, 1280, 720, 1050)
    expect(aravonCtx.fillRect).toHaveBeenCalled()

    // When disabled -> stops drawing
    border.enabled = false
    const disabledCtx = makeMockCanvasCtx()
    border.renderScreenOverlay(disabledCtx, 1280, 720, 1100)
    expect(disabledCtx.fillRect).not.toHaveBeenCalled()
  })
})
