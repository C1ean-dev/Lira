import { useGameStore } from '../store/useGameStore'
import { useLiveWatchStore } from '../store/useLiveWatchStore'
import { LiveViewDeps, LiveViewReporter } from './liveViewReporter'

/**
 * The reporter of this app (see liveViewReporter), fed by what the stores and
 * the window say. The places on screen that show a live register their size on
 * it (useLiveViewBox), and PeerManager gives it the way to send.
 */

let deps: LiveViewDeps = { send: () => {} }

export const liveViewReporter = new LiveViewReporter({
  send: (sharerId, watch, h) => deps.send(sharerId, watch, h),
  stats: (sharerId) => deps.stats?.(sharerId),
})

/** PeerManager has the room to send through, and the calls. */
export function connectLiveView(next: LiveViewDeps): void {
  deps = next
}

type GameState = ReturnType<typeof useGameStore.getState>

/**
 * The lives this viewer is asked before being sent: running, in the call this
 * user is in, from an app that waits for the click. A live from a version
 * without the click is sent whole whatever is said to it.
 */
export function liveSharers(state: Pick<GameState, 'remotePlayers' | 'localPlayer'>): string[] {
  const zoneId = state.localPlayer.currentZoneId
  if (zoneId === null || zoneId === undefined) return []
  const ids: string[] = []
  for (const id in state.remotePlayers) {
    const player = state.remotePlayers[id]
    if (player.isScreenSharing === true && player.liveOptIn === true && player.currentZoneId === zoneId) ids.push(id)
  }
  return ids
}

// The game store changes many times a second (people walking): the list is
// only handed over when it is another list.
let sharersKey = ''
const syncSharers = (state: GameState) => {
  const ids = liveSharers(state)
  const key = ids.join('\n')
  if (key === sharersKey) return
  sharersKey = key
  liveViewReporter.setSharers(ids)
}
useGameStore.subscribe((state, previous) => {
  if (
    state.remotePlayers === previous.remotePlayers &&
    state.localPlayer.currentZoneId === previous.localPlayer.currentZoneId
  ) {
    return
  }
  syncSharers(state)
})

useLiveWatchStore.subscribe((state, previous) => {
  if (state.watching !== previous.watching) liveViewReporter.setWatching(Object.keys(state.watching))
})

// What the stores already hold when this module loads (the page reloaded in development).
syncSharers(useGameStore.getState())
liveViewReporter.setWatching(Object.keys(useLiveWatchStore.getState().watching))

// The app is never throttled in the background (see electron/main.ts), so the
// page cannot tell on its own that its window is minimized or in the tray: the
// main process says it. In a browser the page does know.
let windowShown = true
let pageShown = true
const tellVisibility = () => liveViewReporter.setWindowVisible(windowShown && pageShown)

try {
  if (typeof window !== 'undefined' && window) {
    ;(window as any).electronAPI?.onWindowVisibility?.((visible: boolean) => {
      windowShown = visible !== false
      tellVisibility()
    })
    if (typeof document !== 'undefined' && document && typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', () => {
        pageShown = document.visibilityState !== 'hidden'
        tellVisibility()
      })
    }
  }
} catch {}

/** Test-only reset. */
export function __resetLiveViewForTests(): void {
  liveViewReporter.reset()
  sharersKey = ''
  windowShown = true
  pageShown = true
}
