import { useCallback, useEffect, useState } from 'react'
import { noteFirstFrame, useLiveWatchStore } from '../store/useLiveWatchStore'

export interface LiveGate {
  /** The live is there and this user has not clicked to watch it: show the button, not the video. */
  needsClick: boolean
  /** This user is watching a live that waited for the click. */
  watching: boolean
  /** Watching, and this place has not shown a frame of it yet. */
  connecting: boolean
  watch: () => void
  stop: () => void
  /** For the <video> of the live: a frame arrived. */
  onFrame: () => void
}

/**
 * The click to watch, for one place that shows the live of `sharerId`.
 *
 * `asksFirst` says the live is of somebody else and comes from an app that
 * waits for the click; `watching` says this user clicked. A live from a
 * version without the click is not gated: it is already being sent, the
 * button would change nothing.
 */
export function useLiveGate(sharerId: string | undefined, asksFirst: boolean, watching: boolean): LiveGate {
  const [hasFrame, setHasFrame] = useState(false)
  const active = asksFirst && watching

  // Each watch starts with an empty <video>.
  useEffect(() => {
    if (!active) setHasFrame(false)
  }, [active])

  const watch = useCallback(() => {
    if (sharerId) useLiveWatchStore.getState().watch(sharerId)
  }, [sharerId])

  const stop = useCallback(() => {
    if (sharerId) useLiveWatchStore.getState().stop(sharerId)
  }, [sharerId])

  const onFrame = useCallback(() => {
    setHasFrame(true)
    if (sharerId) noteFirstFrame(sharerId)
  }, [sharerId])

  return {
    needsClick: asksFirst && !watching,
    watching: active,
    connecting: active && !hasFrame,
    watch,
    stop,
    onFrame,
  }
}
