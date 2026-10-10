import { useGameStore } from '../store/useGameStore'
import { useLiveWatchStore } from '../store/useLiveWatchStore'
import { LiveViewDeps, LiveViewReporter } from './liveViewReporter'

let deps: LiveViewDeps = { send: () => {} }

export const liveViewReporter = new LiveViewReporter({
  send: (sharerId, watch, h) => deps.send(sharerId, watch, h),
  stats: (sharerId) => deps.stats?.(sharerId),
})

export function connectLiveView(next: LiveViewDeps): void {
  deps = next
}

type GameState = ReturnType<typeof useGameStore.getState>

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

syncSharers(useGameStore.getState())
liveViewReporter.setWatching(Object.keys(useLiveWatchStore.getState().watching))

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

export function __resetLiveViewForTests(): void {
  liveViewReporter.reset()
  sharersKey = ''
  windowShown = true
  pageShown = true
}
