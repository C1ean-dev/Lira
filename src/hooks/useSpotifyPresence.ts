import { useEffect } from 'react'
import { useGameStore } from '../store/useGameStore'
import { PeerManager } from '../p2p/PeerManager'

export function useSpotifyPresence() {
  useEffect(() => {
    const electronAPI = typeof window !== 'undefined' ? (window as any).electronAPI : null
    if (!electronAPI?.onSpotifyTrackChanged) return

    const handleTrackUpdate = (info: {
      isPlaying: boolean
      track?: string
      artist?: string
      rawTitle?: string
    }) => {
      const state = useGameStore.getState()
      const currentActivity = state.localPlayer.spotifyActivity

      if (info.isPlaying && info.track) {
        if (
          currentActivity?.isPlaying &&
          currentActivity.track === info.track &&
          currentActivity.artist === (info.artist || '')
        ) {
          return // No change
        }

        const newActivity = {
          track: info.track,
          artist: info.artist || '',
          isPlaying: true,
          startedAt: Date.now(),
        }

        state.setLocalPlayer({ spotifyActivity: newActivity })
        try {
          const pm = PeerManager.getInstance()
          pm.sendPlayerUpdate({ spotifyActivity: newActivity })
          const djBotId = pm.getDjBotId()
          if (djBotId && pm.isDjBotRunning()) {
            const djPlayer = state.remotePlayers[djBotId]
            if (djPlayer) {
              const updatedDj = {
                ...djPlayer,
                statusText: `${info.track}${info.artist ? ` - ${info.artist}` : ''}`,
                spotifyActivity: newActivity,
              }
              state.setRemotePlayer(updatedDj)
              pm.broadcast({
                type: 'PLAYER_UPDATE',
                senderId: djBotId,
                payload: { player: updatedDj },
                timestamp: Date.now(),
              })
            }
          }
        } catch {}
      } else if (currentActivity?.isPlaying) {
        state.setLocalPlayer({ spotifyActivity: undefined })
        try {
          const pm = PeerManager.getInstance()
          pm.sendPlayerUpdate({ spotifyActivity: undefined })
          const djBotId = pm.getDjBotId()
          if (djBotId && pm.isDjBotRunning()) {
            const djPlayer = state.remotePlayers[djBotId]
            if (djPlayer) {
              const updatedDj = {
                ...djPlayer,
                statusText: 'Tocando para a sala',
                spotifyActivity: undefined,
              }
              state.setRemotePlayer(updatedDj)
              pm.broadcast({
                type: 'PLAYER_UPDATE',
                senderId: djBotId,
                payload: { player: updatedDj },
                timestamp: Date.now(),
              })
            }
          }
        } catch {}
      }
    }

    // Initial check
    if (electronAPI.getSpotifyCurrentTrack) {
      electronAPI.getSpotifyCurrentTrack().then(handleTrackUpdate).catch(() => {})
    }

    // Subscribe to changes
    const unsubscribe = electronAPI.onSpotifyTrackChanged(handleTrackUpdate)
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe()
      }
    }
  }, [])
}
