import { useCallback, useEffect, useState } from 'react'
import { noteFirstFrame, useLiveWatchStore } from '../store/useLiveWatchStore'

export interface LiveGate {
  needsClick: boolean
  watching: boolean
  connecting: boolean
  watch: () => void
  stop: () => void
  onFrame: () => void
}

export function useLiveGate(sharerId: string | undefined, asksFirst: boolean, watching: boolean): LiveGate {
  const [hasFrame, setHasFrame] = useState(false)
  const active = asksFirst && watching

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
