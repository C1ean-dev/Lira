type Participant = { id: string; zoneId: string | null }
type TtsPayload = { id: string; zoneId: string; text: string }
type Dependencies = { local(): Participant; player(id: string): Participant | undefined; speak(senderId: string, text: string): void }

export function parseTtsCommand(text: string): string | null {
  const match = /^\/tts(?:\s+([\s\S]*))?$/i.exec(text.trim())
  return match ? (match[1] || '').trim() : null
}

export function prepareTtsCommand(input: string, zoneId: string | null | undefined, isDm: boolean): { text: string } | { error: string } | null {
  const text = parseTtsCommand(input)
  if (text === null) return null
  if (isDm) return { error: 'O /tts está disponível nos canais da sala, não em conversas privadas.' }
  if (!zoneId) return { error: 'Entre em uma sala para usar /tts.' }
  if (!text) return { error: 'Digite /tts seguido do texto que deseja falar.' }
  if (text.length > 2000) return { error: 'O /tts aceita até 2000 caracteres.' }
  return { text }
}

export function createCallTts(deps: Dependencies) {
  const seen = new Set<string>()
  return {
    receive(senderId: string, payload: TtsPayload): void {
      const local = deps.local()
      const sender = senderId === local.id ? local : deps.player(senderId)
      if (!sender || !local.zoneId || sender.zoneId !== local.zoneId || !payload || payload.zoneId !== local.zoneId ||
        typeof payload.id !== 'string' || !payload.id || payload.id.length > 128 ||
        typeof payload.text !== 'string' || !payload.text.trim() || payload.text.length > 2000) return
      const key = JSON.stringify([senderId, payload.id])
      if (seen.has(key)) return
      seen.add(key)
      if (seen.size > 200) seen.delete(seen.values().next().value!)
      deps.speak(senderId, payload.text.trim())
    },
  }
}
