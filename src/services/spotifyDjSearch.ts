import { useGameStore } from '../store/useGameStore'
import { useSpotifyJamStore } from '../store/useSpotifyJamStore'
import { PeerManager } from '../p2p/PeerManager'
import { normalizeDjSongQuery } from '../types/spotifyDjRequests'
import { parseSpotifySearchResult, type SpotifySearchResult } from '../types/spotifySearch'
import type { NetworkMessage } from '../types/p2p'

type Envelope = { zoneId: string; ownerId: string; startedAt: number; requestId: string; query: string }
const pending = new Map<string, Envelope & { roomId: string | null; finish(result: SpotifySearchResult): void }>()
const received = new Set<string>()
const unavailable = (): SpotifySearchResult => ({ ok: false, error: 'O DJ não está disponível para pesquisar nesta sala.' })
function context(payload: Partial<Envelope>) {
  const game = useGameStore.getState()
  const store = useSpotifyJamStore.getState()
  const dj = typeof payload.zoneId === 'string' ? store.djStateByZone[payload.zoneId] : null
  return dj?.isDjActive && typeof dj.startedAt === 'number' && Number.isFinite(dj.startedAt)
    && (payload.ownerId === undefined || payload.ownerId === dj.djPeerId)
    && (payload.startedAt === undefined || payload.startedAt === dj.startedAt) ? { game, dj, owner: store.isDjModeActive
      && game.localPlayer.id === dj.djPeerId && game.localPlayer.currentZoneId === dj.zoneId } : null
}
function inRoom(id: string, zoneId: string): boolean {
  const game = useGameStore.getState()
  const player = game.localPlayer.id === id ? game.localPlayer : game.remotePlayers[id]
  return !!player && !player.isDjBot && player.currentZoneId === zoneId
}
async function queryPage(query: string, requesterId: string): Promise<SpotifySearchResult> {
  try {
    const search = window.electronAPI?.getSpotifySearchSuggestions
    if (!search) return { ok: false, error: 'Reabra o Lira do DJ para ativar a busca do Spotify.' }
    return parseSpotifySearchResult(await search(query, requesterId))
  }
  catch { return { ok: false, error: 'Não foi possível consultar a página do Spotify.' } }
}
export function searchDjSongs(zoneId: string, text: string): Promise<SpotifySearchResult> {
  const query = normalizeDjSongQuery(text)
  if (!query || query.length < 2) return Promise.resolve({ ok: true, tracks: [] })
  const current = context({ zoneId })
  if (!current || !inRoom(current.game.localPlayer.id, zoneId)) return Promise.resolve(unavailable())
  if (!current.owner && current.dj.djPeerId === current.game.localPlayer.id) return Promise.resolve(unavailable())
  if (current.owner) return queryPage(query, current.game.localPlayer.id)
  const requestId = crypto.randomUUID()
  const envelope: Envelope = { zoneId, ownerId: current.dj.djPeerId, startedAt: current.dj.startedAt!, requestId, query }
  return new Promise(resolve => {
    const timer = setTimeout(() => { pending.delete(requestId); resolve({ ok: false, error: 'O DJ demorou para retornar a busca. Tente novamente.' }) }, 15000)
    const finish = (result: SpotifySearchResult) => { clearTimeout(timer); pending.delete(requestId); resolve(result) }
    pending.set(requestId, { ...envelope, roomId: current.game.roomId, finish })
    try {
      PeerManager.getInstance().broadcast({ type: 'SPOTIFY_DJ_SEARCH', senderId: current.game.localPlayer.id, timestamp: Date.now(), payload: envelope })
    } catch { finish({ ok: false, error: 'Não foi possível enviar a pesquisa ao DJ.' }) }
  })
}

export function receiveDjSearchMessage(msg: NetworkMessage): boolean {
  const payload = msg.payload || {}
  if (typeof payload.ownerId !== 'string' || typeof payload.startedAt !== 'number'
    || typeof payload.requestId !== 'string' || !payload.requestId || payload.requestId.length > 128
    || !normalizeDjSongQuery(payload.query) || payload.query.length < 2) return false
  const current = context(payload)
  if (!current) return false
  if (msg.type === 'SPOTIFY_DJ_SEARCH_RESULT') {
    if (msg.senderId !== current.dj.djPeerId || typeof payload.recipientId !== 'string') return false
    const waiting = pending.get(payload.requestId)
    if (waiting && waiting.ownerId === msg.senderId && waiting.query === payload.query && waiting.zoneId === payload.zoneId
      && waiting.startedAt === payload.startedAt && waiting.roomId === current.game.roomId
      && payload.recipientId === current.game.localPlayer.id && inRoom(payload.recipientId, payload.zoneId)) {
      waiting.finish(parseSpotifySearchResult(payload.result))
    }
    return true
  }
  if (msg.type !== 'SPOTIFY_DJ_SEARCH' || !inRoom(msg.senderId, payload.zoneId)) return false
  if (current.owner) {
    const key = JSON.stringify([current.game.roomId, payload.ownerId, payload.startedAt, msg.senderId, payload.requestId])
    if (received.has(key)) return true
    received.add(key)
    if (received.size > 256) received.delete(received.values().next().value!)
    void queryPage(payload.query, msg.senderId).then(result => {
      const latest = context(payload)
      if (!latest?.owner || latest.game.roomId !== current.game.roomId || !inRoom(msg.senderId, payload.zoneId)) return
      PeerManager.getInstance().broadcast({ type: 'SPOTIFY_DJ_SEARCH_RESULT', senderId: current.dj.djPeerId, timestamp: Date.now(),
        payload: { zoneId: payload.zoneId, ownerId: payload.ownerId, startedAt: payload.startedAt,
          requestId: payload.requestId, query: payload.query, recipientId: msg.senderId, result } })
    })
  }
  return true
}
