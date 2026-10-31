import type { PetConfig } from '../types/game'
import { PetOpenRouterError } from './petOpenRouter'

type PetQuestion = { id: string; targetId: string; zoneId: string; question: string; channelId?: string; askerId?: string }
type PetReply = { id: string; ownerId: string; askerId?: string; zoneId: string; channelId: string; text: string; error?: boolean }
type RoomPlayer = { id: string; zoneId: string | null; pet?: PetConfig }
type Dependencies = {
  getRoom(): { roomId: string | null; isOwner: boolean }
  getPlayer(id: string): RoomPlayer | undefined
  getKey(roomId: string): string
  isPublicChannel?(channelId: string): boolean
  ask(input: { apiKey: string; personality: string; petName: string; question: string }): Promise<string>
  publish(reply: PetReply): void
}

export function createPetConversation(deps: Dependencies) {
  const seen = new Set<string>()
  let pending = false
  const queue: Array<() => void> = []
  return {
    async receive(senderId: string, message: PetQuestion): Promise<void> {
      const room = { ...deps.getRoom() }
      const channelId = message?.channelId ?? 'general'
      if (!room.isOwner || !room.roomId || !message || typeof message.id !== 'string' || !message.id || message.id.length > 128 ||
          typeof message.targetId !== 'string' || typeof message.zoneId !== 'string' || !message.zoneId ||
          typeof channelId !== 'string' || !channelId || channelId.startsWith('dm-') || (deps.isPublicChannel && !deps.isPublicChannel(channelId)) ||
          typeof message.question !== 'string' || !message.question.trim() || message.question.length > 2000) return
      const sender = deps.getPlayer(senderId)
      const target = deps.getPlayer(message.targetId)
      if (!sender || !target || sender.zoneId !== message.zoneId || target.zoneId !== message.zoneId || !target.pet || target.pet.type === 'none' || seen.has(message.id)) return
      seen.add(message.id)
      if (seen.size > 200) seen.delete(seen.values().next().value!)
      const pet = { ...target.pet }
      const valid = () => {
        const now = deps.getPlayer(message.targetId)
        const currentRoom = deps.getRoom()
        return currentRoom.isOwner && currentRoom.roomId === room.roomId && now?.zoneId === message.zoneId && deps.getPlayer(senderId)?.zoneId === message.zoneId &&
          now.pet?.type === pet.type && now.pet?.customAssetId === pet.customAssetId
      }
      const askerId = message.askerId || senderId
      const reply = (text: string, error = false) => deps.publish({ id: message.id, ownerId: message.targetId, askerId, zoneId: message.zoneId, channelId, text, ...(error ? { error: true } : {}) })
      if (pending) {
        if (queue.length >= 10) { reply('O pet já está respondendo. Tente novamente em instantes.', true); return }
        await new Promise<void>(resolve => queue.push(resolve))
      }
      pending = true
      try {
        if (!valid()) return
        const text = await deps.ask({ apiKey: deps.getKey(room.roomId), personality: pet.personality || '', petName: pet.name?.trim() || 'Pet', question: message.question.trim() })
        if (valid()) reply(text)
      } catch (error) {
        if (valid()) reply(error instanceof PetOpenRouterError ? error.message : 'Não foi possível obter uma resposta do pet. Tente novamente em instantes.', true)
      } finally {
        const next = queue.shift()
        if (next) next()
        else pending = false
      }
    },
  }
}
