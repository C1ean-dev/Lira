import { Direction } from '../../types/game'
import { Point } from '../physics/pathfinding'

export class InputHandler {
  public keysPressed: Set<string> = new Set()
  public path: Point[] = []
  public finalDestination: Point | null = null

  public setup() {
    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
  }

  public dispose() {
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
      return
    }

    const key = e.key.toLowerCase()
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
      this.keysPressed.add(key)
      this.clearPath()
    }
  }

  private handleKeyUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase()
    this.keysPressed.delete(key)
  }

  public simulateKey = (key: string, pressed: boolean) => {
    const k = key.toLowerCase()
    if (pressed) {
      this.keysPressed.add(k)
      this.clearPath()
    } else {
      this.keysPressed.delete(k)
    }
  }

  public setPath(path: Point[]) {
    this.path = [...path]
    this.finalDestination = path.length > 0 ? path[path.length - 1] : null
  }

  public clearPath() {
    this.path = []
    this.finalDestination = null
  }

  public advanceWaypoint(): boolean {
    if (this.path.length === 0) return false
    this.path.shift()
    if (this.path.length === 0) {
      this.finalDestination = null
    }
    return true
  }

  public distanceToActiveWaypoint(localX: number, localY: number): number {
    if (this.path.length === 0) return Infinity
    const wp = this.path[0]
    return Math.hypot(wp.x - localX, wp.y - localY)
  }

  public computeMovement(localX: number, localY: number, currentDirection: Direction): {
    dx: number
    dy: number
    nextDirection: Direction
  } {
    let dx = 0
    let dy = 0
    let nextDirection: Direction = currentDirection

    if (this.keysPressed.has('w') || this.keysPressed.has('arrowup')) {
      dy -= 1
      nextDirection = 'up'
    }
    if (this.keysPressed.has('s') || this.keysPressed.has('arrowdown')) {
      dy += 1
      nextDirection = 'down'
    }
    if (this.keysPressed.has('a') || this.keysPressed.has('arrowleft')) {
      dx -= 1
      nextDirection = 'left'
    }
    if (this.keysPressed.has('d') || this.keysPressed.has('arrowright')) {
      dx += 1
      nextDirection = 'right'
    }

    if (dx === 0 && dy === 0 && this.path.length > 0) {
      while (this.path.length > 0) {
        const nextWaypoint = this.path[0]
        const diffX = nextWaypoint.x - localX
        const diffY = nextWaypoint.y - localY
        const dist = Math.hypot(diffX, diffY)

        if (dist < 0.16) {
          this.path.shift()
          if (this.path.length === 0) {
            this.finalDestination = null
            break
          }
          continue
        }

        dx = diffX / dist
        dy = diffY / dist

        if (Math.abs(diffX) > Math.abs(diffY)) {
          nextDirection = diffX > 0 ? 'right' : 'left'
        } else {
          nextDirection = diffY > 0 ? 'down' : 'up'
        }
        break
      }
    }

    if (dx !== 0 && dy !== 0 && this.keysPressed.size > 0) {
      const length = Math.hypot(dx, dy)
      dx /= length
      dy /= length
    }

    return { dx, dy, nextDirection }
  }
}