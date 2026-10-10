import { describe, it, expect } from 'vitest'
import { checkCollision } from '../engine/physics/collision'
import { MapData, PrivateZone } from '../types/map'

function zoneMap(zone: PrivateZone): MapData {
  return {
    id: 't', name: 'T', width: 30, height: 20, tileSize: 32,
    spawnPoint: { x: 1, y: 1 },
    floors: Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => 'wood_light' as const)),
    walls: Array.from({ length: 20 }, () => Array.from({ length: 30 }, () => null)),
    furniture: [],
    zones: [zone],
  }
}

describe('zone wall — no tunneling when combined with sub-stepping', () => {
  const zone: PrivateZone = {
    id: 'r', name: 'R', color: '#000',
    x: 4, y: 2, width: 14, height: 12, hasWalls: true,
  }
  const map = zoneMap(zone)

  it('wall block range is contiguous for sub-step granularity (0.1)', () => {
    const blocked: number[] = []
    for (let x = 16.5; x <= 18.5; x += 0.05) {
      if (checkCollision(x, 8, map)) blocked.push(x)
    }
    expect(blocked.length).toBeGreaterThanOrEqual(5)
    const range = blocked[blocked.length - 1] - blocked[0]
    expect(range).toBeGreaterThanOrEqual(0.1)
    const lastBlocked = blocked[blocked.length - 1]
    expect(checkCollision(lastBlocked + 0.1, 8, map)).toBe(false)
  })

  it('player fully past the wall is free', () => {
    expect(checkCollision(19, 8, map)).toBe(false)
    expect(checkCollision(20, 8, map)).toBe(false)
  })

  it('player inside the zone is free', () => {
    expect(checkCollision(5, 8, map)).toBe(false)
    expect(checkCollision(10, 8, map)).toBe(false)
    expect(checkCollision(15, 8, map)).toBe(false)
  })

  it('left side wall symmetrically blocks', () => {
    expect(checkCollision(3.7, 8, map)).toBe(true)
    expect(checkCollision(2.5, 8, map)).toBe(false)
  })

  it('front wall blocks outside door', () => {
    expect(checkCollision(5, 13.2, map)).toBe(true)
    expect(checkCollision(11, 13.2, map)).toBe(false)
  })
})
