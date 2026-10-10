import { create } from 'zustand'
import { Player } from '../types/game'
import { diagLog } from '../utils/diagnosticLogger'
import { useGameStore } from './useGameStore'

interface LiveWatchState {
  watching: Record<string, number>
  watch: (sharerId: string) => void
  stop: (sharerId: string) => void
}

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

const firstFrames = new Map<string, number>()

export function noteFirstFrame(sharerId: string): void {
  const clickedAt = useLiveWatchStore.getState().watching[sharerId]
  if (!clickedAt || firstFrames.get(sharerId) === clickedAt) return
  firstFrames.set(sharerId, clickedAt)
  diagLog('screenshare', 'watch-first-frame', { sharer: sharerId, ms: Date.now() - clickedAt })
}

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
