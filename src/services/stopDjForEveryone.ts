import { useGameStore } from '../store/useGameStore'
import { useSpotifyJamStore } from '../store/useSpotifyJamStore'
import { PeerManager } from '../p2p/PeerManager'
import { MediaManager } from '../media/MediaManager'
import type { NetworkMessage } from '../types/p2p'
import type { SpotifyDjState } from '../types/spotifyJam'

const stoppedSessions = new Set<string>()
const sessionKey = (zoneId: string, ownerId: string, startedAt?: number) =>
  JSON.stringify([useGameStore.getState().roomId, zoneId, ownerId, startedAt])

export function isStoppedDjSession(zoneId: string, dj: SpotifyDjState): boolean {
  return stoppedSessions.has(sessionKey(zoneId, dj.djPeerId, dj.startedAt))
}

export function receiveDjStopMessage(msg: NetworkMessage): boolean {
  const { zoneId, ownerId, startedAt } = msg.payload || {}
  const game = useGameStore.getState()
  const sender = msg.senderId === game.localPlayer.id ? game.localPlayer : game.remotePlayers[msg.senderId]
  const dj = useSpotifyJamStore.getState().djStateByZone[zoneId]
  if (!sender || sender.isDjBot || sender.currentZoneId !== zoneId || !dj?.isDjActive ||
    dj.djPeerId !== ownerId || dj.startedAt !== startedAt) return false

  stoppedSessions.add(sessionKey(zoneId, ownerId, startedAt))
  if (stoppedSessions.size > 128) stoppedSessions.delete(stoppedSessions.values().next().value!)
  useSpotifyJamStore.getState().syncDjStateFromPeer(zoneId, null)
  const manager = PeerManager.getInstance()
  if (game.localPlayer.id === ownerId && useSpotifyJamStore.getState().isDjModeActive) {
    void MediaManager.getInstance().stopDjAudio().catch(error => console.warn('[DJ] Não foi possível fechar o Spotify:', error))
  } else {
    for (const bot of Object.values(game.remotePlayers)) {
      if (!bot.isDjBot || bot.djOwnerId !== ownerId) continue
      useGameStore.getState().removeRemotePlayer(bot.id)
      manager.endMediaCallWithPeer(bot.id)
    }
  }
  return true
}

export function stopDjForEveryone(zoneId: string): void {
  const game = useGameStore.getState()
  const dj = useSpotifyJamStore.getState().djStateByZone[zoneId]
  if (!dj?.isDjActive || game.localPlayer.currentZoneId !== zoneId) throw new Error('O DJ não está disponível nesta sala.')
  const message: NetworkMessage = {
    type: 'SPOTIFY_DJ_STOP', senderId: game.localPlayer.id, timestamp: Date.now(),
    payload: { zoneId, ownerId: dj.djPeerId, startedAt: dj.startedAt },
  }
  PeerManager.getInstance().broadcast(message)
  receiveDjStopMessage(message)
}
