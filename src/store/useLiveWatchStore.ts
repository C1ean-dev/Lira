import { create } from 'zustand'
import { Player } from '../types/game'
import { diagLog } from '../utils/diagnosticLogger'
import { useGameStore } from './useGameStore'

/**
 * The lives this user asked to watch.
 *
 * A live does not play on its own: who is in the call sees that somebody is
 * live and clicks to watch. Until then the app of who is live sends this
 * viewer no video, and not the sound of the live (see videoSendPolicy). The
 * click is for one live: it ends with it, with the call, or with a click to
 * stop, and the next live asks again.
 */

interface LiveWatchState {
  /** Who is being watched, with the time of the click. */
  watching: Record<string, number>
  watch: (sharerId: string) => void
  stop: (sharerId: string) => void
}

/** A live that can be watched: it is running, in the call this user is in. */
export function isWatchable(sharer: Player | undefined, localZoneId: string | null | undefined): boolean {
  return (
    !!sharer &&
    sharer.isScreenSharing === true &&
    localZoneId !== null &&
    localZoneId !== undefined &&
    sharer.currentZoneId === localZoneId
  )
}

export const useLiveWatchStore = create<LiveWatchState>((set, get) => ({
  watching: {},

  watch: (sharerId) => {
    if (!sharerId || get().watching[sharerId]) return
    const game = useGameStore.getState()
    if (!isWatchable(game.remotePlayers[sharerId], game.localPlayer.currentZoneId)) return
    set({ watching: { ...get().watching, [sharerId]: Date.now() } })
    diagLog('screenshare', 'watch', { sharer: sharerId, on: true }, `${sharerId}:on`)
  },

  stop: (sharerId) => {
    if (!get().watching[sharerId]) return
    const next = { ...get().watching }
    delete next[sharerId]
    set({ watching: next })
    diagLog('screenshare', 'watch', { sharer: sharerId, on: false, why: 'click' }, `${sharerId}:off`)
  },
}))

// One "first frame" per click, however many places show the live.
const firstFrames = new Map<string, number>()

/**
 * A place that shows a live being watched got its first frame: records how
 * long that took from the click. It is the wait the click costs.
 */
export function noteFirstFrame(sharerId: string): void {
  const clickedAt = useLiveWatchStore.getState().watching[sharerId]
  if (!clickedAt || firstFrames.get(sharerId) === clickedAt) return
  firstFrames.set(sharerId, clickedAt)
  diagLog('screenshare', 'watch-first-frame', { sharer: sharerId, ms: Date.now() - clickedAt })
}

// A live that ended, or a call this user is no longer in, is no longer
// watched. The game store changes many times a second (people walking), so
// with nothing being watched this does nothing at all.
useGameStore.subscribe((state) => {
  const { watching } = useLiveWatchStore.getState()
  let next: Record<string, number> | null = null
  for (const sharerId in watching) {
    if (isWatchable(state.remotePlayers[sharerId], state.localPlayer.currentZoneId)) continue
    next = next ?? { ...watching }
    delete next[sharerId]
    diagLog('screenshare', 'watch', { sharer: sharerId, on: false, why: 'ended' }, `${sharerId}:off`)
  }
  if (next) useLiveWatchStore.setState({ watching: next })
})
