import { useGameStore } from '../store/useGameStore'
import { useMediaStore } from '../store/useMediaStore'
import { PeerManager } from '../p2p/PeerManager'
import { speakPetReply } from './petSpeech'
import { createCallTts } from './callTtsCore'

type Payload = { id: string; zoneId: string; text: string }
const core = createCallTts({
  local: () => {
    const player = useGameStore.getState().localPlayer
    return { id: player.id, zoneId: player.currentZoneId || null }
  },
  player: id => {
    const players = useGameStore.getState().remotePlayers
    const player = players[id] || Object.values(players).find(p => p.id === id || p.gameId === id)
    return player ? { id: player.id, zoneId: player.currentZoneId || null } : undefined
  },
  speak: (senderId, text) => {
    if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return
    const media = useMediaStore.getState()
    const game = useGameStore.getState()
    const local = game.localPlayer
    const remote = game.remotePlayers[senderId] || Object.values(game.remotePlayers).find(player => player.id === senderId || player.gameId === senderId)
    const volume = senderId === local.id ? media.outputVolume / 100 : media.getEffectiveParticipantVolume(senderId, remote?.name)
    speakPetReply(text, { isDeafened: media.isDeafened, outputVolume: volume * 100 }, window.speechSynthesis, SpeechSynthesisUtterance)
  },
})

export function receiveCallTts(senderId: string, payload: Payload): void { core.receive(senderId, payload) }

export function sendCallTts(text: string): boolean {
  const local = useGameStore.getState().localPlayer
  const value = text.trim()
  if (!local.currentZoneId || !value || value.length > 2000) return false
  const pm = PeerManager.getInstance()
  const payload = { id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`, zoneId: local.currentZoneId, text: value }
  core.receive(local.id, payload)
  pm.broadcast({ type: 'CALL_TTS', senderId: pm.getPeerId() || local.id, payload, timestamp: Date.now() })
  return true
}
