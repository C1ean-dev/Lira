import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { shallow } from 'zustand/vanilla/shallow'
import { useGameStore } from '../store/useGameStore'
import { Player } from '../types/game'

export type PlayerDetails = Omit<Player, 'x' | 'y' | 'targetX' | 'targetY' | 'direction' | 'isMoving' | 'seatedOn' | 'lastUpdated'>

function playerDetails(player: Player): PlayerDetails {
  const { x, y, targetX, targetY, direction, isMoving, seatedOn, lastUpdated, ...details } = player
  return details
}

// Call/profile UI needs player details, not a new snapshot on every animation frame.
export function useLocalPlayerDetails(): PlayerDetails {
  return useGameStore(useShallow((state) => playerDetails(state.localPlayer)))
}

export function useRemotePlayerDetails(onlyCurrentZone = false): PlayerDetails[] {
  const selectPeers = useMemo(() => {
    let previous: PlayerDetails[] = []
    let previousPlayers: Record<string, Player> | undefined
    let previousZone: string | null | undefined
    return (state: ReturnType<typeof useGameStore.getState>) => {
      const zoneId = onlyCurrentZone ? state.localPlayer.currentZoneId : undefined
      if (state.remotePlayers === previousPlayers && zoneId === previousZone) return previous
      previousPlayers = state.remotePlayers
      previousZone = zoneId
      const byId = new Map(previous.map((peer) => [peer.id, peer]))
      const next: PlayerDetails[] = []
      for (const peer of Object.values(state.remotePlayers)) {
        if (onlyCurrentZone && peer.currentZoneId !== zoneId) continue
        const details = playerDetails(peer)
        const old = byId.get(peer.id)
        next.push(old && shallow(old, details) ? old : details)
      }
      if (!shallow(previous, next)) previous = next
      return previous
    }
  }, [onlyCurrentZone])
  return useGameStore(selectPeers)
}

export function useZonePeerDetails(): PlayerDetails[] {
  return useRemotePlayerDetails(true)
}
