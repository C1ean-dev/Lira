
import { useGameStore } from '../store/useGameStore'
import { PeerManager } from '../p2p/PeerManager'
import { PresenceInfo, sanitizePresence } from '../types/game'

export const IDLE_TIMEOUT_SECONDS = 300

class IdleManager {
  private static instance: IdleManager | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private lastDomActivityTime = Date.now()
  private isAutoAway = false
  private previousStatus: PresenceInfo | null = null
  private listenersAttached = false
  private storeSubscribed = false

  private constructor() {
    this.subscribeToStoreChanges()
  }

  public static getInstance(): IdleManager {
    if (!IdleManager.instance) {
      IdleManager.instance = new IdleManager()
    }
    return IdleManager.instance
  }

  private subscribeToStoreChanges() {
    if (this.storeSubscribed) return
    this.storeSubscribed = true

    useGameStore.subscribe((state) => {
      if (
        this.isAutoAway &&
        state.localPlayer.statusText !== 'Ausente (AFK)' &&
        state.localPlayer.statusEmoji !== '💤'
      ) {
        this.cancelAutoAway()
      }
    })
  }

  public start() {
    if (this.timer) return

    this.attachDomActivityListeners()

    this.timer = setInterval(async () => {
      await this.checkIdleStatus()
    }, 3000)
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  public resetForTesting() {
    this.isAutoAway = false
    this.previousStatus = null
    this.lastDomActivityTime = Date.now()
  }

  public cancelAutoAway() {
    this.isAutoAway = false
    this.previousStatus = null
  }

  public isAfk(): boolean {
    const { localPlayer } = useGameStore.getState()
    return (
      this.isAutoAway ||
      localPlayer.statusText === 'Ausente (AFK)' ||
      localPlayer.statusEmoji === '💤'
    )
  }

  public markUserActive() {
    this.lastDomActivityTime = Date.now()
    if (this.isAfk()) {
      this.restoreActiveStatus()
    }
  }

  private attachDomActivityListeners() {
    if (this.listenersAttached || typeof window === 'undefined') return
    this.listenersAttached = true

    const markActive = () => this.markUserActive()

    window.addEventListener('mousemove', markActive, { passive: true, capture: true })
    window.addEventListener('keydown', markActive, { passive: true, capture: true })
    window.addEventListener('pointerdown', markActive, { passive: true, capture: true })
    window.addEventListener('wheel', markActive, { passive: true, capture: true })
    window.addEventListener('focus', markActive, { passive: true, capture: true })
    window.addEventListener('touchstart', markActive, { passive: true, capture: true })
  }

  public async getIdleSeconds(): Promise<number> {
    const electronAPI = (window as any).electronAPI
    if (electronAPI?.getSystemIdleTime) {
      try {
        const osIdle = await electronAPI.getSystemIdleTime()
        if (typeof osIdle === 'number') {
          return osIdle
        }
      } catch (err) {
        console.debug('[IdleManager] Failed to get OS idle time:', err)
      }
    }

    return Math.floor((Date.now() - this.lastDomActivityTime) / 1000)
  }

  public async checkIdleStatus() {
    const idleSeconds = await this.getIdleSeconds()
    const { localPlayer, setLocalStatus } = useGameStore.getState()

    if (idleSeconds >= IDLE_TIMEOUT_SECONDS) {
      if (!this.isAutoAway && localPlayer.status !== 'away') {
        this.previousStatus = sanitizePresence(localPlayer)
        this.isAutoAway = true
        const awayPresence: PresenceInfo = {
          status: 'away',
          statusText: 'Ausente (AFK)',
          statusEmoji: '💤',
        }
        setLocalStatus(awayPresence, false)
        try {
          PeerManager.getInstance().sendPlayerUpdate(awayPresence)
        } catch {}
      }
    } else if (idleSeconds < IDLE_TIMEOUT_SECONDS) {
      if (this.isAfk()) {
        this.restoreActiveStatus()
      }
    }
  }

  public restoreActiveStatus() {
    this.isAutoAway = false

    const { setLocalStatus } = useGameStore.getState()
    const targetPresence = sanitizePresence(this.previousStatus)

    setLocalStatus(targetPresence, false)
    try {
      PeerManager.getInstance().sendPlayerUpdate(targetPresence)
    } catch {}

    this.previousStatus = null
  }
}

export const idleManager = IdleManager.getInstance()
