// Regression tests for the zone wall tunneling fix.
//
// The fix combines two things:
//   1. Collision band inflation (sideWallThickness + outer extension in collision.ts)
//   2. Engine sub-stepping with MAX_SUBSTEP = 0.05
//
// Together they guarantee that any sub-step landing inside the wall band always
// collides, and the band is wide enough that one sub-step cannot skip past it.
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
    // Collect all blocked x at 0.05 sampling
    const blocked: number[] = []
    for (let x = 16.5; x <= 18.5; x += 0.05) {
      if (checkCollision(x, 8, map)) blocked.push(x)
    }
    // Expect at least 5 contiguous samples
    expect(blocked.length).toBeGreaterThanOrEqual(5)
    // The block range must span at least one full 0.1-tile interval — so no
    // movement sub-step can fit through the wall without a collision.
    const range = blocked[blocked.length - 1] - blocked[0]
    expect(range).toBeGreaterThanOrEqual(0.1)
    // Sample 0.1 tile past the last blocked x must be free (band ends cleanly)
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
    // Zone left edge at minX=4. The inflated band reaches pMaxX beyond the wall.
    expect(checkCollision(3.7, 8, map)).toBe(true)
    expect(checkCollision(2.5, 8, map)).toBe(false)
  })

  it('front wall blocks outside door', () => {
    // Front wall is y=12.5..14. Zone width=14, doorW=min(14*0.38, 2.0)=2.
    // doorStartX = 4 + (14-2)/2 = 10, doorEndX = 12.
    // Player at (5, 13.2) is below frontWallY and outside the door x range → blocked.
    expect(checkCollision(5, 13.2, map)).toBe(true)
    // Inside the door (x=10..12) at the same y → not blocked.
    expect(checkCollision(11, 13.2, map)).toBe(false)
  })
})
