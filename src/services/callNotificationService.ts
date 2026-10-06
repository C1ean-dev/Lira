import { registerPlugin } from '@capacitor/core'
import { isAndroid } from '../utils/platform'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useMediaStore } from '../store/useMediaStore'
import { useChatStore } from '../store/useChatStore'
import { checkZonePresence, checkCollision } from '../engine/physics/collision'
import { PeerManager } from '../p2p/PeerManager'
import { MediaManager } from '../media/MediaManager'

export interface CallNotificationPluginInterface {
  checkNotificationPermission(): Promise<{
    granted: boolean
    notificationsEnabled: boolean
    needRuntimePermission: boolean
  }>

  requestNotificationPermission(): Promise<{ granted: boolean }>

  openNotificationSettings(): Promise<{ success: boolean }>

  checkPendingAction(): Promise<{ action: 'leaveRoom' | null }>

  setCallState(options: {
    inRoom?: boolean
    roomName?: string
    isMuted?: boolean
    isDeafened?: boolean
  }): Promise<{ success: boolean }>

  showCallNotification(options: {
    roomName: string
    isMuted: boolean
    isDeafened: boolean
  }): Promise<{ success: boolean }>

  updateCallState(options: {
    roomName?: string
    isMuted?: boolean
    isDeafened?: boolean
  }): Promise<{ success: boolean }>

  clearCallNotification(): Promise<{ success: boolean }>

  addListener(
    eventName: 'onNotificationAction',
    listenerFunc: (data: { action: 'toggleMute' | 'toggleDeafen' | 'leaveRoom' }) => void
  ): Promise<any>
}

export const CallNotification = registerPlugin<CallNotificationPluginInterface>('CallNotificationPlugin')

/**
 * Finds a safe walkable tile outside of any room/private zone.
 */
export function findOpenSpaceOutsideZones(mapData: any): { x: number; y: number } {
  const zones = mapData.zones || []
  const mapW = mapData.width || 30
  const mapH = mapData.height || 20

  const isInZone = (px: number, py: number) => {
    return zones.some(
      (z: any) => px >= z.x && px < z.x + z.width && py >= z.y && py < z.y + z.height
    )
  }

  const centerX = Math.floor(mapW / 2)
  const centerY = Math.floor(mapH / 2)

  for (let radius = 1; radius < Math.max(mapW, mapH); radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue
        const tx = centerX + dx
        const ty = centerY + dy
        if (tx >= 1 && tx < mapW - 1 && ty >= 1 && ty < mapH - 1) {
          if (!isInZone(tx, ty) && !checkCollision(tx, ty, mapData)) {
            return { x: tx, y: ty }
          }
        }
      }
    }
  }

  return { x: 2, y: 2 }
}

/**
 * Leaves the current room/zone and teleports the player to an open area
 * without zones, disconnecting all active zone audio/video calls.
 */
export function leaveRoomAndTeleportToOpenSpace() {
  const mapData = useMapStore.getState().mapData
  const localPlayer = useGameStore.getState().localPlayer

  // 1. Find open coordinates outside of any private room
  const freePos = findOpenSpaceOutsideZones(mapData)

  // 2. Stop screen share if active
  if (useMediaStore.getState().isScreenSharing) {
    MediaManager.getInstance().stopScreenShare()
  }
  useMediaStore.getState().setGridCallOpen(false)

  // 3. Immediately end all zone media calls (voice/video mesh)
  PeerManager.getInstance().endAllZoneMediaCalls()

  // 4. Teleport player to open space
  useGameStore.getState().setLocalPlayer({
    x: freePos.x,
    y: freePos.y,
    targetX: freePos.x,
    targetY: freePos.y,
    isMoving: false,
    currentZoneId: null,
  })
  useGameStore.getState().setCurrentZoneId(null)
  useChatStore.getState().updateZoneChannel('')

  // 5. Broadcast new position and zone exit to peers
  PeerManager.getInstance().sendPlayerUpdate({
    x: freePos.x,
    y: freePos.y,
    currentZoneId: null,
  })

  // 6. Update collision and zone detector in engine
  checkZonePresence(freePos.x, freePos.y, mapData)

  // 7. Dismiss Android call notification and sync native state
  if (isAndroid()) {
    CallNotification.setCallState({ inRoom: false }).catch(() => {})
    CallNotification.clearCallNotification().catch(() => {})
  }
}

class CallNotificationManager {
  private isInitialized = false
  private isShowingNotification = false

  public async init() {
    if (this.isInitialized) return
    this.isInitialized = true

    if (!isAndroid()) return

    // 1. Request notification permission proactively on Android (Android 13+ POST_NOTIFICATIONS)
    try {
      const perm = await CallNotification.checkNotificationPermission()
      console.log('[CallNotification] Initial permission status:', perm)
      if (!perm.granted) {
        const req = await CallNotification.requestNotificationPermission()
        console.log('[CallNotification] Requested permission result:', req)
      }
    } catch (err) {
      console.warn('[CallNotification] Error checking/requesting permission on startup:', err)
    }

    // 2. Check if a pending leave action was triggered while app was in background
    this.checkAndProcessPendingAction()

    // 3. Listen to notification action button clicks (Mute, Deafen, Leave)
    CallNotification.addListener('onNotificationAction', (data) => {
      console.log('[CallNotification] Action received from notification:', data.action)
      if (data.action === 'toggleMute') {
        useMediaStore.getState().toggleMute()
      } else if (data.action === 'toggleDeafen') {
        useMediaStore.getState().toggleDeafen()
      } else if (data.action === 'leaveRoom') {
        leaveRoomAndTeleportToOpenSpace()
        this.isShowingNotification = false
      }
    })

    // 4. Listen to media store changes (mute/deafen) to keep native state and notification updated
    useMediaStore.subscribe((mediaState, prevMediaState) => {
      if (
        mediaState.isMuted !== prevMediaState.isMuted ||
        mediaState.isDeafened !== prevMediaState.isDeafened
      ) {
        CallNotification.updateCallState({
          isMuted: mediaState.isMuted,
          isDeafened: mediaState.isDeafened,
        }).catch(() => {})
      }
    })

    // 5. Sync room/zone presence changes with native plugin immediately
    useGameStore.subscribe((gameState, prevGameState) => {
      const currentZoneId = gameState.localPlayer.currentZoneId
      const prevZoneId = prevGameState.localPlayer.currentZoneId

      if (currentZoneId !== prevZoneId) {
        if (currentZoneId) {
          const mapData = useMapStore.getState().mapData
          const currentZone = mapData.zones?.find((z: any) => z.id === currentZoneId)
          const roomName = currentZone?.name || 'Mesa Privada'
          const isMuted = useMediaStore.getState().isMuted
          const isDeafened = useMediaStore.getState().isDeafened

          // Inform native Java code so onPause() can immediately render notification
          CallNotification.setCallState({
            inRoom: true,
            roomName,
            isMuted,
            isDeafened,
          }).catch(() => {})

          // If permission wasn't granted yet, request again upon entering a room
          CallNotification.checkNotificationPermission()
            .then((p) => {
              if (!p.granted) {
                CallNotification.requestNotificationPermission().catch(() => {})
              }
            })
            .catch(() => {})
        } else {
          // Exited zone
          this.isShowingNotification = false
          CallNotification.setCallState({
            inRoom: false,
          }).catch(() => {})
          CallNotification.clearCallNotification().catch(() => {})
        }
      }
    })

    // 6. Listen to app background / visibility changes
    document.addEventListener('visibilitychange', () => {
      this.handleVisibilityChange(document.hidden)
    })
  }

  private handleVisibilityChange(isHidden: boolean) {
    if (!isAndroid()) return

    const localPlayer = useGameStore.getState().localPlayer
    const mapData = useMapStore.getState().mapData
    const currentZoneId = localPlayer.currentZoneId

    if (isHidden) {
      // App minimized / backgrounded: if inside a room/zone, show notification
      if (currentZoneId) {
        const currentZone = mapData.zones?.find((z: any) => z.id === currentZoneId)
        const roomName = currentZone?.name || 'Mesa Privada'
        const isMuted = useMediaStore.getState().isMuted
        const isDeafened = useMediaStore.getState().isDeafened

        CallNotification.showCallNotification({
          roomName,
          isMuted,
          isDeafened,
        })
          .then(() => {
            this.isShowingNotification = true
          })
          .catch((err) => {
            console.warn('[CallNotification] Failed to show notification:', err)
          })
      }
    } else {
      // App returned to foreground: process any action taken in background
      this.checkAndProcessPendingAction()
      if (!currentZoneId && this.isShowingNotification) {
        this.isShowingNotification = false
        CallNotification.clearCallNotification().catch(() => {})
      }
    }
  }

  private checkAndProcessPendingAction() {
    if (!isAndroid()) return
    CallNotification.checkPendingAction()
      .then((res) => {
        if (res && res.action === 'leaveRoom') {
          leaveRoomAndTeleportToOpenSpace()
        }
      })
      .catch(() => {})
  }

  public async requestPermission(): Promise<boolean> {
    if (!isAndroid()) return true
    try {
      const res = await CallNotification.requestNotificationPermission()
      return !!res.granted
    } catch {
      return false
    }
  }

  public async openSettings(): Promise<void> {
    if (!isAndroid()) return
    try {
      await CallNotification.openNotificationSettings()
    } catch {}
  }

  public clearNotification() {
    this.isShowingNotification = false
    if (isAndroid()) {
      CallNotification.setCallState({ inRoom: false }).catch(() => {})
      CallNotification.clearCallNotification().catch(() => {})
    }
  }
}

export const callNotificationService = new CallNotificationManager()
