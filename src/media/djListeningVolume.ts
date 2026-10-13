import { useGameStore } from '../store/useGameStore'
import { useMediaStore } from '../store/useMediaStore'

export function setDjListeningVolume(value: number) {
  const { localPlayer, remotePlayers } = useGameStore.getState()
  const volume = Math.max(0, Math.min(200, value))
  for (const player of Object.values(remotePlayers)) {
    if (player.isDjBot && player.currentZoneId === localPlayer.currentZoneId) {
      useMediaStore.getState().setParticipantVolume(player.id, volume)
    }
  }
}
