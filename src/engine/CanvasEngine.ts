import { consumeTabletopAt } from '../services/tabletopConsumption'
import { enterHouse, exitHouse } from '../services/houseNavigation'
import { CameraManager } from './camera/CameraManager'
import { InputHandler } from './input/InputHandler'
import { checkCollision, checkZonePresence } from './physics/collision'
import { findPath, hasLineOfSight } from './physics/pathfinding'
import { PixiWorldRenderer } from './pixi/PixiWorldRenderer'
import { PetManager } from './pet/PetManager'
import { AvatarEffectsManager } from './avatarEffects'
import { useGameStore } from '../store/useGameStore'
import { selectActiveMapData, useMapStore } from '../store/useMapStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { PeerManager } from '../p2p/PeerManager'
import { getZoneDoorTarget } from '../utils/doorKnockHelper'
import { findFurnitureSeatAt } from './physics/seating'
import type { CustomAsset } from '../types/customAsset'
import type { MapData } from '../types/map'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { findSafePlayerPosition } from './physics/safePlayerPosition'
import {
  findHouseAtTile,
  findTriggeredHouseEntry,
  isPlayerOnHouseExit,
  resolveHouseWorldDoorTiles,
} from './houseInterior'
import { isPlayerInCorridor } from './proximityCall'

export class CanvasEngine {
  private viewportWidth: number = 800
  private viewportHeight: number = 600
  private pixiRenderer: PixiWorldRenderer | null = null
  private isRunning: boolean = false
  private animationFrameId: number | null = null
  private unsubscribeViewMode: (() => void) | null = null
  private unsubscribeMap: (() => void) | null = null
  private unsubscribeAssets: (() => void) | null = null
  private repairingPosition = false
  private portalCooldownUntil: number = 0
  private lastProximityCheckAt: number = 0

  public camera: CameraManager
  public input: InputHandler

  private lastTime: number = performance.now()
  private lastRenderTime: number = performance.now()
  private frameCount: number = 0
  private lastFpsUpdate: number = performance.now()
  private fps: number = 60
  private stuckCounter: number = 0
  private seatedMovementIntent: number = 0
  private ignoredSeat: string | null = null

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

  constructor(viewportHost: HTMLElement | null, onRenderError?: (message: string) => void) {
    this.viewportWidth = Math.max(2, viewportHost?.clientWidth || 800)
    this.viewportHeight = Math.max(2, viewportHost?.clientHeight || 600)

    this.camera = new CameraManager()
    this.input = new InputHandler()

    if (viewportHost && typeof document !== 'undefined') {
      this.pixiRenderer = new PixiWorldRenderer(viewportHost, onRenderError)
      void this.pixiRenderer.init()
    }
  }

  public syncViewportSize(width: number, height: number) {
    this.viewportWidth = Math.max(2, Math.floor(width))
    this.viewportHeight = Math.max(2, Math.floor(height))
    this.pixiRenderer?.syncSize(this.viewportWidth, this.viewportHeight)
  }

  public getViewportSize(): { width: number; height: number } {
    return { width: this.viewportWidth, height: this.viewportHeight }
  }

  private setupInputs() {
    this.input.setup()
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  public setClickTarget(tileX: number, tileY: number) {
    if (consumeTabletopAt(tileX, tileY)) { this.input.clearPath(); return }
    const local = useGameStore.getState().localPlayer
    const mapStore = useMapStore.getState()
    const map = mapStore.getActiveMapData()

    let targetX = Math.floor(tileX)
    let targetY = Math.floor(tileY)

    if (!mapStore.isEditorOpen && mapStore.activeHouseId) {
      const interior = mapStore.getActiveHouseInterior()
      if (
        interior &&
        targetX >= interior.exitDoor.x &&
        targetX < interior.exitDoor.x + interior.exitDoor.width &&
        targetY >= interior.exitDoor.y
      ) {
        targetY = interior.exitDoor.y
      }
    }

    if (!mapStore.isEditorOpen && !mapStore.activeHouseId) {
      const assetById = new Map<string, CustomAsset>()
      for (const a of useCustomAssetsStore.getState().customAssets) assetById.set(a.id, a)
      const clickedHouse = findHouseAtTile(map, targetX, targetY, assetById)
      if (clickedHouse && !clickedHouse.isDoorTile) {
        const doors = resolveHouseWorldDoorTiles(
          clickedHouse.house,
          clickedHouse.asset.width,
          clickedHouse.asset.height,
          clickedHouse.asset.houseShell
        )
        let bestDoor = doors[0]
        let bestDist = Infinity
        for (const d of doors) {
          const dist = Math.hypot(d.x - local.x, d.y - local.y)
          if (dist < bestDist) {
            bestDist = dist
            bestDoor = d
          }
        }
        if (bestDoor) {
          targetX = bestDoor.x
          targetY = bestDoor.y
        }
      }
    }

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

    const seat = !mapStore.isEditorOpen && targetX === Math.floor(tileX) && targetY === Math.floor(tileY)
      ? findFurnitureSeatAt(tileX, tileY, map)
      : null
    if (seat && local.seatedOn === seat.id) return
    if (seat) {
      targetX = seat.x
      targetY = seat.y
    }

    const path = findPath(local.x, local.y, targetX, targetY, map)
    if (path.length > 0) {
      this.input.setPath(path)
      this.stuckCounter = 0
    } else {
      this.input.clearPath()
      this.stuckCounter = 0
    }
  }

  public fitToScreen(percentage: number = 0.95) {
    this.camera.fitToScreen({ width: this.viewportWidth, height: this.viewportHeight }, percentage)
  }

  public start() {
    if (this.isRunning) return
    this.isRunning = true
    this.unsubscribeViewMode = useGameStore.subscribe((state, previous) => {
      if (state.mapViewMode === previous.mapViewMode) return
      if (state.mapViewMode === 'simplified') this.suspend()
      else this.resume()
    })
    this.unsubscribeMap = useMapStore.subscribe((state, previous) => {
      if (state.activeHouseId !== previous.activeHouseId) {
        this.portalCooldownUntil = performance.now() + 450
        this.input.clearPath()
        this.stuckCounter = 0
        this.camera.resetPan()
      }
      const map = selectActiveMapData(state)
      const before = selectActiveMapData(previous)
      if (map.id !== before.id || map.furniture !== before.furniture || map.walls !== before.walls ||
          map.zones !== before.zones || map.width !== before.width || map.height !== before.height ||
          (previous.isEditorOpen && !state.isEditorOpen)) this.repairPlayerPosition()
    })
    this.unsubscribeAssets = useCustomAssetsStore.subscribe((state, previous) => {
      if (state.customAssets !== previous.customAssets) this.repairPlayerPosition()
    })
    this.repairPlayerPosition()
    if (useGameStore.getState().mapViewMode === 'simplified') this.suspend()
    else this.resume()
  }

  private resume() {
    this.repairPlayerPosition()
    this.setupInputs()
    this.lastTime = performance.now()
    this.lastRenderTime = performance.now()
    this.lastFpsUpdate = performance.now()
    this.frameCount = 0
    this.loop(performance.now())
  }

  private repairPlayerPosition() {
    const mapStore = useMapStore.getState()
    const map = mapStore.getActiveMapData()
    const isEditorOpen = mapStore.isEditorOpen
    const local = useGameStore.getState().localPlayer
    if (this.repairingPosition || isEditorOpen || !checkCollision(local.x, local.y, map)) return
    this.repairingPosition = true
    try {
      const destination = (local.currentZoneId
        ? findSafePlayerPosition(local.x, local.y, map, local.currentZoneId) : null) ||
        findSafePlayerPosition(local.x, local.y, map)
      if (!destination) return
      this.input.clearPath()
      this.stuckCounter = 0
      useGameStore.getState().setLocalPlayer({ x: destination.x, y: destination.y, isMoving: false, seatedOn: null })
      checkZonePresence(destination.x, destination.y, map)
      PeerManager.getInstance().sendPlayerUpdate({
        ...destination,
        currentZoneId: useGameStore.getState().localPlayer.currentZoneId,
        isMoving: false,
        seatedOn: null,
      })
    } finally {
      this.repairingPosition = false
    }
  }

  private suspend() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
    this.input.dispose()
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    this.input.keysPressed.clear()
    this.input.clearPath()
    this.isShiftPressed = false

    const { localPlayer, setLocalPosition } = useGameStore.getState()
    if (localPlayer.isMoving) {
      setLocalPosition(localPlayer.x, localPlayer.y, localPlayer.direction, false)
      PeerManager.getInstance().sendMovement(localPlayer.x, localPlayer.y, localPlayer.direction, false)
    }
  }

  public stop() {
    this.isRunning = false
    this.unsubscribeViewMode?.()
    this.unsubscribeViewMode = null
    this.unsubscribeMap?.()
    this.unsubscribeMap = null
    this.unsubscribeAssets?.()
    this.unsubscribeAssets = null
    this.suspend()
  }

  public dispose() {
    this.stop()
    this.pixiRenderer?.dispose()
    this.pixiRenderer = null
  }

  private loop = (currentTime: number) => {
    this.animationFrameId = null
    if (!this.isRunning || useGameStore.getState().mapViewMode === 'simplified') return

    const settings = useSettingsStore.getState()
    const targetFps = settings.targetFps

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

    this.frameCount++
    if (currentTime - this.lastFpsUpdate >= 500) {
      const liveFps = Math.round((this.frameCount * 1000) / (currentTime - this.lastFpsUpdate))
      this.fps = liveFps
      this.frameCount = 0
      this.lastFpsUpdate = currentTime
      settings.setCurrentFps(liveFps)
    }

    this.update(deltaTime)
    this.updateAvatarEffects(deltaTime)
    this.render(currentTime)

    if (this.isRunning && useGameStore.getState().mapViewMode === 'immersive') {
      this.animationFrameId = requestAnimationFrame(this.loop)
    }
  }

  private lastMovementBroadcast: number = 0

  private standUp() {
    const store = useGameStore.getState()
    const local = store.localPlayer
    const seat = findFurnitureSeatAt(local.x + 0.5, local.y + 0.5, useMapStore.getState().getActiveMapData())
    this.ignoredSeat = seat?.id || null
    store.setLocalPlayer({ seatedOn: null })
    PeerManager.getInstance().sendPlayerUpdate({ seatedOn: null })
  }

  private trySitAt(x: number, y: number, map: MapData): boolean {
    if (useMapStore.getState().isEditorOpen) return false
    const seat = findFurnitureSeatAt(x + 0.5, y + 0.5, map)
    if (!seat || seat.id === this.ignoredSeat || checkCollision(seat.x, seat.y, map) ||
        !hasLineOfSight(x, y, seat.x, seat.y, map)) return false
    const seated = { x: seat.x, y: seat.y, direction: seat.direction, isMoving: false, seatedOn: seat.id }
    useGameStore.getState().setLocalPlayer(seated)
    this.input.clearPath()
    this.seatedMovementIntent = this.input.movementIntent
    this.stuckCounter = 0
    PeerManager.getInstance().sendPlayerUpdate(seated)
    PeerManager.getInstance().sendMovement(seat.x, seat.y, seat.direction, false)
    checkZonePresence(seat.x, seat.y, map)
    return true
  }

  private update(deltaTime: number) {
    const gameStore = useGameStore.getState()
    const mapStore = useMapStore.getState()
    const local = gameStore.localPlayer
    const map = mapStore.getActiveMapData()
    const moveSpeed = useSettingsStore.getState().moveSpeed || 8.0

    const currentSeat = findFurnitureSeatAt(local.x + 0.5, local.y + 0.5, map)
    if (this.ignoredSeat && currentSeat?.id !== this.ignoredSeat) {
      this.ignoredSeat = null
    }
    const validSeat = local.seatedOn && currentSeat?.id === local.seatedOn && !mapStore.isEditorOpen
    const holdingSeat = validSeat && this.input.movementIntent === this.seatedMovementIntent
    if (local.seatedOn && !holdingSeat) this.standUp()
    if (!local.seatedOn && !mapStore.isEditorOpen && this.trySitAt(local.x, local.y, map)) {
      this.camera.followPlayer(useGameStore.getState().localPlayer.x, useGameStore.getState().localPlayer.y, deltaTime)
      return
    }

    const { dx, dy, nextDirection } = holdingSeat
      ? { dx: 0, dy: 0, nextDirection: local.direction }
      : this.input.computeMovement(local.x, local.y, local.direction)

    if (dx !== 0 || dy !== 0) {
      const requestedStep = moveSpeed * deltaTime
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

        const canMoveTogether =
          !checkCollision(tryX, tryY, map) &&
          !checkCollision((finalX + tryX) / 2, (finalY + tryY) / 2, map)

        if (canMoveTogether) {
          finalX = tryX
          finalY = tryY
          if (this.trySitAt(finalX, finalY, map)) {
            const seated = useGameStore.getState().localPlayer
            this.camera.isManualPan = false
            this.camera.followPlayer(seated.x, seated.y, deltaTime)
            return
          }
          continue
        }

        const canMoveX =
          !checkCollision(tryX, finalY, map) &&
          !checkCollision((finalX + tryX) / 2, finalY, map)
        const canMoveY =
          !checkCollision(finalX, tryY, map) &&
          !checkCollision(finalX, (finalY + tryY) / 2, map)

        if (canMoveX && canMoveY) {
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
          break
        }
        if (this.trySitAt(finalX, finalY, map)) {
          const seated = useGameStore.getState().localPlayer
          this.camera.followPlayer(seated.x, seated.y, deltaTime)
          return
        }
      }

      if (this.input.path.length > 0) {
        if (finalX === local.x && finalY === local.y) {
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

      const now = performance.now()
      if (!local.isMoving || now - this.lastMovementBroadcast >= 40) {
        this.lastMovementBroadcast = now
        PeerManager.getInstance().sendMovement(finalX, finalY, nextDirection, true)
      }

      if (this.camera.isManualPan) {
        this.camera.isManualPan = false
      }
      this.camera.followPlayer(finalX, finalY, deltaTime)

      if (!mapStore.isEditorOpen && now >= this.portalCooldownUntil) {
        if (!mapStore.activeHouseId) {
          const assetById = new Map<string, CustomAsset>()
          for (const a of useCustomAssetsStore.getState().customAssets) assetById.set(a.id, a)
          const entry = findTriggeredHouseEntry(map, finalX, finalY, assetById)
          if (entry && enterHouse(entry.house.id)) {
            this.portalCooldownUntil = now + 450
            this.input.clearPath()
            this.stuckCounter = 0
            this.camera.resetPan()
            return
          }
        } else {
          const interior = mapStore.getActiveHouseInterior()
          if (interior && isPlayerOnHouseExit(finalX, finalY, interior.exitDoor) && exitHouse()) {
            this.portalCooldownUntil = now + 450
            this.input.clearPath()
            this.stuckCounter = 0
            this.camera.resetPan()
            return
          }
        }
      }

      checkZonePresence(finalX, finalY, map)
      if (isPlayerInCorridor(useGameStore.getState().localPlayer) && now - this.lastProximityCheckAt >= 120) {
        this.lastProximityCheckAt = now
        PeerManager.getInstance().scheduleProximitySync?.()
      }
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
        if (isPlayerInCorridor(useGameStore.getState().localPlayer)) {
          PeerManager.getInstance().syncProximityCalls?.()
        }
      }

      this.camera.followPlayer(local.x, local.y, deltaTime)
      checkZonePresence(local.x, local.y, map)
    }

    const allActivePlayers = [local, ...Object.values(gameStore.remotePlayers)]
    PetManager.getInstance().update(deltaTime, allActivePlayers)
  }

  private updateAvatarEffects(deltaTime: number) {
    const gameStore = useGameStore.getState()
    const local = gameStore.localPlayer
    const localHouseId = local.currentHouseId ?? null
    const players = [local]
    for (const remote of Object.values(gameStore.remotePlayers)) {
      if (remote.isDjBot || remote.id.startsWith('dj-')) continue
      if (remote.id === local.id || (remote.gameId && remote.gameId === local.id)) continue
      if ((remote.currentHouseId ?? null) !== localHouseId) continue
      players.push(remote)
    }

    AvatarEffectsManager.getInstance().update(deltaTime, {
      players,
      roomKey: `${gameStore.roomId || '__local__'}:${localHouseId ?? 'root'}`,
      now: Date.now(),
    })
  }

  private render(currentTime: number) {
    this.pixiRenderer?.renderFrame(this.camera, currentTime, {
      hoverTile: this.hoverTile,
      zoneDragStart: this.zoneDragStart,
      zoneDragCurrent: this.zoneDragCurrent,
      fps: this.fps,
      destination: this.input.finalDestination,
      isShiftPressed: this.isShiftPressed,
    })
  }

  public screenToTile(screenX: number, screenY: number, snapStep?: number): { x: number; y: number } {
    return this.camera.screenToTile({ width: this.viewportWidth, height: this.viewportHeight }, screenX, screenY, snapStep)
  }

  public screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return this.camera.screenToWorld({ width: this.viewportWidth, height: this.viewportHeight }, screenX, screenY)
  }
}

