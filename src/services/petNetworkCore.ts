type Player = { id: string; zoneId: string | null; petName?: string }
type Question = { id: string; targetId: string; zoneId: string; question: string; channelId?: string; askerId?: string }
type Reply = { id: string; ownerId: string; askerId?: string; zoneId: string; text: string; channelId?: string; error?: boolean }
type Dependencies = {
  local(): Player
  player(id: string): Player | undefined
  isRoomOwner(id: string): boolean
  isPublicChannel?(id: string): boolean
  receive(senderId: string, message: Question): void
  deliver(ownerId: string, petName: string, reply: Reply): void
}

export function createPetNetwork(deps: Dependencies) {
  const receivedReplies = new Set<string>()
  return {
    question(senderId: string, question: Question) { deps.receive(senderId, question) },
    reply(senderId: string, reply: Reply) {
      const local = deps.local()
      if (!deps.isRoomOwner(senderId) || !reply || typeof reply.ownerId !== 'string') return
      const channelId = reply.channelId ?? 'general'
      if (typeof channelId !== 'string' || channelId.startsWith('dm-') || (deps.isPublicChannel && !deps.isPublicChannel(channelId))) return
      const petOwner = reply.ownerId === local.id ? local : deps.player(reply.ownerId)
      if (!petOwner?.petName || !local.zoneId || petOwner.zoneId !== local.zoneId || reply.zoneId !== local.zoneId ||
          typeof reply.id !== 'string' || !reply.id || reply.id.length > 128 || typeof reply.text !== 'string' || !reply.text.trim() || reply.text.length > 4000) return
      const key = `${reply.ownerId}:${reply.id}`
      if (receivedReplies.has(key)) return
      receivedReplies.add(key)
      if (receivedReplies.size > 200) receivedReplies.delete(receivedReplies.values().next().value!)
      deps.deliver(reply.ownerId, petOwner.petName, reply)
    },
  }
}
