import { useEffect } from 'react'
import { useSpotifyJamStore } from '../store/useSpotifyJamStore'
import { useGameStore } from '../store/useGameStore'
import { refreshDjPlayback } from '../services/spotifyDjPlayback'

export function useSpotifyDjPlaybackSync() {
  const active = useSpotifyJamStore(s => s.isDjModeActive)
  const zoneId = useGameStore(s => s.localPlayer.currentZoneId)
  useEffect(() => {
    if (!active || !zoneId) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      await refreshDjPlayback(zoneId)
      if (!disposed) timer = setTimeout(poll, 1500)
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer) }
  }, [active, zoneId])
}
