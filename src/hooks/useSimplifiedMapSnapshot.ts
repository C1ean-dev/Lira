import React from 'react'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'

function readSnapshot() {
  const { localPlayer, remotePlayers } = useGameStore.getState()
  const { width, height, zones } = useMapStore.getState().mapData
  return { localPlayer, remotePlayers, width, height, zones }
}

type Snapshot = ReturnType<typeof readSnapshot>
let snapshot: Snapshot | null = null
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

function sample() {
  const next = readSnapshot()
  if (snapshot && snapshot.localPlayer === next.localPlayer &&
      snapshot.remotePlayers === next.remotePlayers && snapshot.zones === next.zones &&
      snapshot.width === next.width && snapshot.height === next.height) return
  snapshot = next
  listeners.forEach(listener => listener())
}

function getSnapshot() {
  if (!snapshot) snapshot = readSnapshot()
  return snapshot
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    snapshot = readSnapshot()
    // Poll instead of processing every movement packet from the immersive world.
    timer = setInterval(sample, 1000)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      if (timer !== null) clearInterval(timer)
      timer = null
      snapshot = null
    }
  }
}

export function useSimplifiedMapSnapshot() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
