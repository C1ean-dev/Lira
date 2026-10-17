import { MapData } from '../../types/map'
import { checkCollision } from './collision'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { getZoneDoorTarget } from '../../utils/doorKnockHelper'

export interface Point {
  x: number
  y: number
}

export function hasLineOfSight(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  map: MapData
): boolean {
  const dist = Math.hypot(x2 - x1, y2 - y1)
  if (dist === 0) return !checkCollision(x1, y1, map)

  const stepCount = Math.max(1, Math.ceil(dist / 0.1))
  for (let i = 0; i <= stepCount; i++) {
    const t = i / stepCount
    const sampleX = x1 + (x2 - x1) * t
    const sampleY = y1 + (y2 - y1) * t
    if (checkCollision(sampleX, sampleY, map)) {
      return false
    }
  }
  return true
}

function findNearestWalkableTile(
  targetX: number,
  targetY: number,
  originX: number,
  originY: number,
  map: MapData
): Point | null {
  if (!checkCollision(targetX, targetY, map)) {
    return { x: targetX, y: targetY }
  }

  let bestPoint: Point | null = null
  let bestDist = Infinity

  const maxRadius = 4
  for (let r = 1; r <= maxRadius; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
        const nx = targetX + dx
        const ny = targetY + dy

        if (nx >= 0 && nx < map.width && ny >= 0 && ny < map.height) {
          if (!checkCollision(nx, ny, map)) {
            const distFromOrigin = Math.hypot(nx - originX, ny - originY)
            const distFromTarget = Math.hypot(dx, dy)
            const score = distFromOrigin + distFromTarget * 0.5
            if (score < bestDist) {
              bestDist = score
              bestPoint = { x: nx, y: ny }
            }
          }
        }
      }
    }
    if (bestPoint) break
  }

  return bestPoint
}

class MinHeap<T> {
  private data: { item: T; priority: number }[] = []

  push(item: T, priority: number) {
    this.data.push({ item, priority })
    this.bubbleUp(this.data.length - 1)
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined
    const top = this.data[0].item
    const bottom = this.data.pop()!
    if (this.data.length > 0) {
      this.data[0] = bottom
      this.bubbleDown(0)
    }
    return top
  }

  get size(): number {
    return this.data.length
  }

  private bubbleUp(idx: number) {
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1
      if (this.data[idx].priority < this.data[parentIdx].priority) {
        const temp = this.data[idx]
        this.data[idx] = this.data[parentIdx]
        this.data[parentIdx] = temp
        idx = parentIdx
      } else {
        break
      }
    }
  }

  private bubbleDown(idx: number) {
    const len = this.data.length
    while (true) {
      const leftIdx = (idx << 1) + 1
      const rightIdx = leftIdx + 1
      let smallest = idx

      if (leftIdx < len && this.data[leftIdx].priority < this.data[smallest].priority) {
        smallest = leftIdx
      }
      if (rightIdx < len && this.data[rightIdx].priority < this.data[smallest].priority) {
        smallest = rightIdx
      }

      if (smallest !== idx) {
        const temp = this.data[idx]
        this.data[idx] = this.data[smallest]
        this.data[smallest] = temp
        idx = smallest
      } else {
        break
      }
    }
  }
}

export function findPath(
  startX: number,
  startY: number,
  targetX: number,
  targetY: number,
  map: MapData
): Point[] {
  let goalX = targetX
  let goalY = targetY

  const targetZone = map.zones?.find(
    (z) =>
      targetX >= z.x &&
      targetX < z.x + z.width &&
      targetY >= z.y &&
      targetY < z.y + z.height
  )

  if (targetZone && targetZone.isLocked) {
    const local = useGameStore?.getState?.()?.localPlayer
    const isPlayerInside =
      local?.currentZoneId === targetZone.id ||
      (startX >= targetZone.x &&
        startX < targetZone.x + targetZone.width &&
        startY >= targetZone.y &&
        startY < targetZone.y + targetZone.height)
    const isAuthorized =
      isPlayerInside ||
      !!useMapStore?.getState?.()?.isPeerAuthorizedForZone(
        targetZone.id,
        local?.id || '',
        local?.name || ''
      )

    if (!isAuthorized) {
      const door = getZoneDoorTarget(targetZone, map.width, map.height)
      goalX = door.x
      goalY = door.y
    }
  }

  if (hasLineOfSight(startX, startY, goalX, goalY, map)) {
    return [{ x: goalX, y: goalY }]
  }

  const walkableTarget = findNearestWalkableTile(
    Math.round(goalX),
    Math.round(goalY),
    startX,
    startY,
    map
  )
  if (!walkableTarget) {
    return []
  }

  const startGridX = Math.round(startX)
  const startGridY = Math.round(startY)
  const goalGridX = walkableTarget.x
  const goalGridY = walkableTarget.y

  if (startGridX === goalGridX && startGridY === goalGridY) {
    return [{ x: walkableTarget.x, y: walkableTarget.y }]
  }

  const key = (x: number, y: number) => `${x},${y}`
  const walkableCells = new Map<string, boolean>()
  const isWalkable = (x: number, y: number): boolean => {
    const cellKey = key(x, y)
    const cached = walkableCells.get(cellKey)
    if (cached !== undefined) return cached
    const walkable = !checkCollision(x, y, map)
    walkableCells.set(cellKey, walkable)
    return walkable
  }
  const openSet = new MinHeap<{ x: number; y: number }>()
  const cameFrom = new Map<string, Point>()
  const gScore = new Map<string, number>()
  const closedSet = new Set<string>()

  const heuristic = (x: number, y: number) => {
    const dx = Math.abs(x - goalGridX)
    const dy = Math.abs(y - goalGridY)
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
  }

  const startKey = key(startGridX, startGridY)
  gScore.set(startKey, 0)
  openSet.push({ x: startGridX, y: startGridY }, heuristic(startGridX, startGridY))

  const neighbors = [
    { dx: 0, dy: -1, cost: 1.0 },
    { dx: 0, dy: 1, cost: 1.0 },
    { dx: -1, dy: 0, cost: 1.0 },
    { dx: 1, dy: 0, cost: 1.0 },
    { dx: -1, dy: -1, cost: Math.SQRT2 },
    { dx: 1, dy: -1, cost: Math.SQRT2 },
    { dx: -1, dy: 1, cost: Math.SQRT2 },
    { dx: 1, dy: 1, cost: Math.SQRT2 },
  ]

  let iterations = 0
  const maxIterations = 3000
  let reachedGoal = false

  while (openSet.size > 0 && iterations < maxIterations) {
    iterations++
    const current = openSet.pop()!
    const currentKey = key(current.x, current.y)

    if (current.x === goalGridX && current.y === goalGridY) {
      reachedGoal = true
      break
    }

    if (closedSet.has(currentKey)) continue
    closedSet.add(currentKey)

    const currentG = gScore.get(currentKey) ?? Infinity

    for (const offset of neighbors) {
      const nx = current.x + offset.dx
      const ny = current.y + offset.dy
      const nKey = key(nx, ny)

      if (closedSet.has(nKey)) continue
      if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) continue

      const tentativeG = currentG + offset.cost
      const existingG = gScore.get(nKey) ?? Infinity
      if (tentativeG >= existingG) continue

      if (!isWalkable(nx, ny)) continue
      if (offset.dx !== 0 && offset.dy !== 0) {
        if (!isWalkable(current.x + offset.dx, current.y)) continue
        if (!isWalkable(current.x, current.y + offset.dy)) continue
      }

      // Keep sub-tile obstacle checks, but only for edges that can improve the path.
      if (!hasLineOfSight(current.x, current.y, nx, ny, map)) continue

      cameFrom.set(nKey, current)
      gScore.set(nKey, tentativeG)
      const fScore = tentativeG + heuristic(nx, ny)
      openSet.push({ x: nx, y: ny }, fScore)
    }
  }

  if (!reachedGoal) {
    return []
  }

  const rawPath: Point[] = []
  let curr: Point | undefined = { x: goalGridX, y: goalGridY }
  while (curr) {
    rawPath.push(curr)
    curr = cameFrom.get(key(curr.x, curr.y))
  }
  rawPath.reverse()

  rawPath[rawPath.length - 1] = { x: walkableTarget.x, y: walkableTarget.y }

  const smoothedPath: Point[] = []
  let currentIdx = 0
  let fromPoint: Point = { x: startX, y: startY }

  while (currentIdx < rawPath.length - 1) {
    let furthestIdx = -1

    for (let checkIdx = rawPath.length - 1; checkIdx > currentIdx; checkIdx--) {
      const toPoint = rawPath[checkIdx]

      if (hasLineOfSight(fromPoint.x, fromPoint.y, toPoint.x, toPoint.y, map)) {
        furthestIdx = checkIdx
        break
      }
    }

    if (furthestIdx === -1) {
      return []
    }

    smoothedPath.push(rawPath[furthestIdx])
    currentIdx = furthestIdx
    fromPoint = rawPath[furthestIdx]
  }

  return smoothedPath.length > 0 ? smoothedPath : [{ x: walkableTarget.x, y: walkableTarget.y }]
}
