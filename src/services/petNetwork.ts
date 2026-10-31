import { useGameStore } from '../store/useGameStore'
import { useChatStore } from '../store/useChatStore'
import { useMediaStore } from '../store/useMediaStore'
import { PeerManager } from '../p2p/PeerManager'
import { askPet } from './petOpenRouter'
import { getRoomPetApiKey } from './petApiKey'
import { createPetConversation } from './petConversation'
import { createPetNetwork } from './petNetworkCore'
import { speakPetReply } from './petSpeech'
import type { NetworkMessage } from '../types/p2p'

function findPlayer(id: string) {
  const state = useGameStore.getState()
  return state.localPlayer.id === id ? state.localPlayer : state.remotePlayers[id] || Object.values(state.remotePlayers).find(p => p.id === id || p.gameId === id)
}
function petPlayer(player: ReturnType<typeof useGameStore.getState>['localPlayer']) {
  const pet = player.avatar?.pet
  return { id: player.id, zoneId: player.currentZoneId || null, petName: pet && pet.type !== 'none' ? pet.name?.trim() || 'Pet' : undefined }
}
function isPublicChannel(id: string): boolean {
  return useChatStore.getState().channels.some(channel => channel.id === id && channel.type !== 'dm')
}

const conversation = createPetConversation({
  getRoom: () => ({ roomId: useGameStore.getState().roomId, isOwner: useGameStore.getState().isOwner }),
  getPlayer: id => {
    const player = findPlayer(id)
    return player ? { id: player.id, zoneId: player.currentZoneId || null, pet: player.avatar?.pet } : undefined
  },
  getKey: getRoomPetApiKey,
  isPublicChannel,
  ask: askPet,
  publish: reply => {
    const local = useGameStore.getState().localPlayer
    network.reply(local.id, reply)
    const pm = PeerManager.getInstance()
    pm.broadcast({ type: 'PET_REPLY', senderId: pm.getPeerId() || local.id, payload: reply, timestamp: Date.now() })
  },
})

const network = createPetNetwork({
  local: () => petPlayer(useGameStore.getState().localPlayer),
  isPublicChannel,
  player: id => { const player = findPlayer(id); return player ? petPlayer(player) : undefined },
  isRoomOwner: id => {
    const state = useGameStore.getState()
    const player = findPlayer(id)
    return id === state.localPlayer.id ? state.isOwner : !!player && (player.isOwner === true || player.role === 'owner')
  },
  receive: (senderId, question) => { void conversation.receive(senderId, question) },
  deliver: (ownerId, petName, reply) => {
    useChatStore.getState().addMessage({ id: `pet-reply-${ownerId}-${reply.id}`, senderId: `pet-${ownerId}`, senderName: `🐾 ${petName}`, channelId: reply.channelId ?? 'general', content: reply.text, timestamp: Date.now() })
    const local = useGameStore.getState().localPlayer
    const isAsker = !reply.askerId ? (reply.ownerId === local.id) : (reply.askerId === local.id || (!!local.gameId && reply.askerId === local.gameId))
    if (isAsker && !reply.error && typeof window !== 'undefined' && window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') {
      speakPetReply(reply.text, useMediaStore.getState(), window.speechSynthesis, SpeechSynthesisUtterance)
    }
  },
})

export function requestPetFromChat(targetId: string, question: string, channelId: string): void {
  const state = useGameStore.getState()
  const local = state.localPlayer
  const zoneId = local.currentZoneId
  const text = question.trim()
  if (!zoneId || !text || text.length > 2000 || !isPublicChannel(channelId)) return
  const target = findPlayer(targetId)
  if (!target || target.currentZoneId !== zoneId || !target.avatar?.pet || target.avatar.pet.type === 'none') return
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const pm = PeerManager.getInstance()
  const payload = { id, targetId: target.id, askerId: local.id, zoneId, question: text, channelId }
  network.question(local.id, payload)
  pm.broadcast({ type: 'PET_QUESTION', senderId: pm.getPeerId() || local.id, payload, timestamp: Date.now() })
}

export function receivePetNetworkMessage(message: NetworkMessage): void {
  if (message.type === 'PET_QUESTION') network.question(message.senderId, message.payload)
  else if (message.type === 'PET_REPLY') network.reply(message.senderId, message.payload)
}
