import { CameraManager } from './camera/CameraManager'
import { InputHandler } from './input/InputHandler'
import { checkCollision, checkZonePresence } from './physics/collision'
import { findPath, hasLineOfSight } from './physics/pathfinding'
import { WorldRenderer } from './rendering/worldRenderer'
import { PetManager } from './pet/PetManager'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { PeerManager } from '../p2p/PeerManager'
import { getZoneDoorTarget } from '../utils/doorKnockHelper'

export class CanvasEngine {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private isRunning: boolean = false
  private animationFrameId: number | null = null

  // Subsystems
  public camera: CameraManager
  public input: InputHandler

  private lastTime: number = performance.now()
  private lastRenderTime: number = performance.now()
  private frameCount: number = 0
  private lastFpsUpdate: number = performance.now()
  private fps: number = 60
  private stuckCounter: number = 0

  // Editor hover preview & Drag-to-Draw Zone
  public hoverTile: { x: number; y: number } | null = null
  public zoneDragStart: { x: number; y: number } | null = null
  public zoneDragCurrent: { x: number; y: number } | null = null
  public isShiftPressed: boolean = false

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Shift') this.isShiftPressed = true
  }
  private onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Shift') this.isShiftPressed = false
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('Could not get Canvas 2D context')
    this.ctx = context
    this.ctx.imageSmoothingEnabled = false

    this.camera = new CameraManager()
    this.input = new InputHandler()

    this.setupInputs()
  }

  private setupInputs() {
    this.input.setup()
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    // NOTE: wheel zoom is handled once by MapViewport's wrapper onWheel
    // (which also owns the immersive/simplified mode switch). Attaching a
    // second native wheel listener here used to apply every scroll tick 2-3×.
  }

  /**
   * Calculates intelligent collision-avoidance path from current player position to target tile
   */
  public setClickTarget(tileX: number, tileY: number) {
    const local = useGameStore.getState().localPlayer
    const mapStore = useMapStore.getState()
    const map = mapStore.mapData

    let targetX = tileX
    let targetY = tileY

    // If destination is inside a locked room and player is not authorized, route to door
    const targetZone = map.zones?.find(
      (z) =>
        tileX >= z.x &&
        tileX < z.x + z.width &&
        tileY >= z.y &&
        tileY < z.y + z.height
    )

    if (targetZone && targetZone.isLocked) {
      const isPlayerInside =
        local.currentZoneId === targetZone.id ||
        (local.x >= targetZone.x &&
          local.x < targetZone.x + targetZone.width &&
          local.y >= targetZone.y &&
          local.y < targetZone.y + targetZone.height)
      const isAuthorized =
        isPlayerInside ||
        mapStore.isPeerAuthorizedForZone(targetZone.id, local.id, local.name)

      if (!isAuthorized) {
        const door = getZoneDoorTarget(targetZone, map.width, map.height)
        targetX = door.x
        targetY = door.y
      }
    }

    const path = findPath(local.x, local.y, targetX, targetY, map)
    if (path.length > 0) {
      this.input.setPath(path)
      this.stuckCounter = 0
    } else {
      // Do not keep following a previous route when the new destination is
      // unreachable (for example, a closed room with no valid doorway).
      this.input.clearPath()
      this.stuckCounter = 0
    }
  }

  /**
   * Auto-fit camera zoom to occupy 95%+ of screen viewport
   */
  public fitToScreen(percentage: number = 0.95) {
    this.camera.fitToScreen(this.canvas, percentage)
  }

  public start() {
    if (this.isRunning) return
    this.isRunning = true
    this.lastTime = performance.now()
    this.lastRenderTime = performance.now()
    this.lastFpsUpdate = performance.now()
    this.frameCount = 0
    this.loop(performance.now())
  }

  public stop() {
    this.isRunning = false
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId)
    }
  }

  public dispose() {
    this.stop()
    this.input.dispose()
  }

  private loop = (currentTime: number) => {
    if (!this.isRunning) return

    // The immersive canvas is hidden (display:none) in simplified map mode —
    // skip all update/render work and just keep the clock fresh so there's
    // no delta-time jump when switching back.
    if (useGameStore.getState().mapViewMode === 'simplified') {
      this.lastTime = currentTime
      this.lastRenderTime = currentTime
      this.animationFrameId = requestAnimationFrame(this.loop)
      return
    }

    const settings = useSettingsStore.getState()
    const targetFps = settings.targetFps

    // FPS Limiter (if targetFps > 0)
    if (targetFps > 0) {
      const minInterval = 1000 / targetFps
      const elapsed = currentTime - this.lastRenderTime
      if (elapsed < minInterval - 1.0) {
        this.animationFrameId = requestAnimationFrame(this.loop)
        return
      }
    }

    const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.1)
    this.lastTime = currentTime
    this.lastRenderTime = currentTime

    // Compute live FPS
    this.frameCount++
    if (currentTime - this.lastFpsUpdate >= 500) {
      const liveFps = Math.round((this.frameCount * 1000) / (currentTime - this.lastFpsUpdate))
      this.fps = liveFps
      this.frameCount = 0
      this.lastFpsUpdate = currentTime
      settings.setCurrentFps(liveFps)
    }

    this.update(deltaTime)
    this.render(currentTime)

    this.animationFrameId = requestAnimationFrame(this.loop)
  }

  private lastMovementBroadcast: number = 0

  /**
   * Physics, Input, Collision, and Zone update
   */
  private update(deltaTime: number) {
    const gameStore = useGameStore.getState()
    const mapStore = useMapStore.getState()
    const local = gameStore.localPlayer
    const map = mapStore.mapData
    const moveSpeed = useSettingsStore.getState().moveSpeed || 8.0

    const { dx, dy, nextDirection } = this.input.computeMovement(local.x, local.y, local.direction)

    // Collision Detection & Step Validation
    // Sub-stepping (MAX_SUBSTEP = 0.05 < player radius 0.22) keeps every sample
    // inside any wall band the player could be crossing. If a sub-step would
    // tunnel through, the midpoint between current and target is also checked
    // so we never miss a sample inside the wall band.
    if (dx !== 0 || dy !== 0) {
      const requestedStep = moveSpeed * deltaTime
      // Never step past the active waypoint. This matters when a frame is
      // delayed: the old movement could overshoot a corner waypoint and then
      // oscillate forever on the opposite side of it.
      const followingPath = this.input.keysPressed.size === 0 && this.input.path.length > 0
      const waypointDistance = followingPath
        ? this.input.distanceToActiveWaypoint(local.x, local.y)
        : Infinity
      const stepDist = Math.min(requestedStep, waypointDistance)
      const MAX_SUBSTEP = 0.05
      const subSteps = Math.max(1, Math.ceil(stepDist / MAX_SUBSTEP))
      const subStepDist = stepDist / subSteps

      let finalX = local.x
      let finalY = local.y

      for (let i = 0; i < subSteps; i++) {
        const tryX = finalX + dx * subStepDist
        const tryY = finalY + dy * subStepDist

        // Check both the endpoint and the midpoint. The midpoint protects
        // against crossing a thin wall when a sub-step starts and ends just
        // outside its collision band.
        const canMoveTogether =
          !checkCollision(tryX, tryY, map) &&
          !checkCollision((finalX + tryX) / 2, (finalY + tryY) / 2, map)

        if (canMoveTogether) {
          finalX = tryX
          finalY = tryY
          continue
        }

        // If the diagonal move hits a corner, preserve wall sliding by testing
        // each axis independently. A candidate also gets a midpoint check so
        // neither slide can tunnel through a thin wall.
        const canMoveX =
          !checkCollision(tryX, finalY, map) &&
          !checkCollision((finalX + tryX) / 2, finalY, map)
        const canMoveY =
          !checkCollision(finalX, tryY, map) &&
          !checkCollision(finalX, (finalY + tryY) / 2, map)

        if (canMoveX && canMoveY) {
          // Both slides are possible but the combined corner is not. Pick the
          // axis that advances farther in the requested direction; the next
          // sub-step can then use the other axis once the corner is cleared.
          const xProgress = dx * (tryX - finalX)
          const yProgress = dy * (tryY - finalY)
          if (xProgress >= yProgress) {
            finalX = tryX
          } else {
            finalY = tryY
          }
        } else if (canMoveX) {
          finalX = tryX
        } else if (canMoveY) {
          finalY = tryY
        } else {
          // Stop if both axes are blocked — no point continuing to integrate.
          break
        }
      }

      // Check if character got stuck against an obstacle while following a path
      if (this.input.path.length > 0) {
        if (finalX === local.x && finalY === local.y) {
          // If the active waypoint is an unreachable corner but the following
          // waypoint is directly reachable, safely skip only that waypoint.
          // Blindly dropping a waypoint can make the player cut through a wall.
          const nextWaypoint = this.input.path[1]
          if (
            nextWaypoint &&
            !checkCollision(nextWaypoint.x, nextWaypoint.y, map) &&
            hasLineOfSight(local.x, local.y, nextWaypoint.x, nextWaypoint.y, map)
          ) {
            this.input.advanceWaypoint()
            this.stuckCounter = 0
          } else {
            this.stuckCounter++
            if (this.stuckCounter > 15) {
              // Re-calculate path around obstacle or abort
              const dest = this.input.finalDestination
              if (dest) {
                const newPath = findPath(local.x, local.y, dest.x, dest.y, map)
                if (newPath.length > 0) {
                  this.input.setPath(newPath)
                } else {
                  this.input.clearPath()
                }
              } else {
                this.input.clearPath()
              }
              this.stuckCounter = 0
            }
          }
        } else {
          this.stuckCounter = 0
        }
      }

      gameStore.setLocalPosition(finalX, finalY, nextDirection, true)

      // Throttled Broadcast Movement (25Hz) to prevent WebRTC DataChannel congestion
      const now = performance.now()
      if (!local.isMoving || now - this.lastMovementBroadcast >= 40) {
        this.lastMovementBroadcast = now
        PeerManager.getInstance().sendMovement(finalX, finalY, nextDirection, true)
      }

      // Smooth Camera Following synchronized with new position
      this.camera.followPlayer(finalX, finalY, deltaTime)

      // Zone Detection
      checkZonePresence(finalX, finalY, map)
    } else {
      if (local.isMoving) {
        let finalDirection = local.direction
        const lockedZone = map.zones?.find((z) => {
          if (!z.isLocked) return false
          const door = getZoneDoorTarget(z, map.width, map.height)
          return Math.abs(local.x - door.x) <= 1.0 && Math.abs(local.y - door.y) <= 1.2
        })
        if (lockedZone) {
          finalDirection = 'up'
        }

        gameStore.setLocalPosition(local.x, local.y, finalDirection, false)
        PeerManager.getInstance().sendMovement(local.x, local.y, finalDirection, false)
        this.lastMovementBroadcast = performance.now()
      }

      // Keep camera smoothly aligned even when standing still
      this.camera.followPlayer(local.x, local.y, deltaTime)
      checkZonePresence(local.x, local.y, map)
    }

    // Update companion pets following players
    const allActivePlayers = [local, ...Object.values(gameStore.remotePlayers)]
    PetManager.getInstance().update(deltaTime, allActivePlayers)
  }

  /**
   * 2D Render Loop
   */
  private render(currentTime: number) {
    WorldRenderer.render(
      this.ctx,
      this.canvas,
      this.camera,
      this.hoverTile,
      this.zoneDragStart,
      this.zoneDragCurrent,
      currentTime,
      this.fps,
      this.input.finalDestination,
      this.isShiftPressed
    )
  }

  public screenToTile(screenX: number, screenY: number, snapStep?: number): { x: number; y: number } {
    return this.camera.screenToTile(this.canvas, screenX, screenY, snapStep)
  }

  public screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return this.camera.screenToWorld(this.canvas, screenX, screenY)
  }
}

