import { useGameStore } from '../store/useGameStore'
import { useSpotifyJamStore } from '../store/useSpotifyJamStore'
import { PeerManager } from '../p2p/PeerManager'
import { MAX_DJ_SONG_REQUESTS, normalizeDjSongQuery, type SpotifyDjRequestResult } from '../types/spotifyDjRequests'
import type { SpotifyDjState } from '../types/spotifyJam'
import type { NetworkMessage } from '../types/p2p'
import type { Player } from '../types/game'
import { validSpotifySearchTrack, type SpotifySearchTrack } from '../types/spotifySearch'

type Session = SpotifyDjState & { startedAt: number }
type Envelope = { zoneId: string; ownerId: string; startedAt: number; requestId: string }
type Pending = Envelope & { roomId: string | null; finish(result: SpotifyDjRequestResult): void }
const pending = new Map<string, Pending>()
const received = new Map<string, Map<string, Promise<SpotifyDjRequestResult>>>()
const unavailable = (): SpotifyDjRequestResult => ({ ok: false, error: 'O DJ não está mais disponível nesta sala.' })

function activeDj(zoneId: string): Session | null {
  const dj = useSpotifyJamStore.getState().djStateByZone[zoneId]
  return dj?.isDjActive && typeof dj.startedAt === 'number' && Number.isFinite(dj.startedAt) ? dj as Session : null
}
function isOwner(dj: Session): boolean {
  const local = useGameStore.getState().localPlayer
  return useSpotifyJamStore.getState().isDjModeActive && dj.djPeerId === local.id && local.currentZoneId === dj.zoneId
}
function member(id: string, zoneId: string): Player | null {
  const game = useGameStore.getState()
  const player = game.localPlayer.id === id ? game.localPlayer : game.remotePlayers[id]
  return player && !player.isDjBot && player.currentZoneId === zoneId ? player : null
}
function matches(dj: Session | null, envelope: Envelope): dj is Session {
  return !!dj && envelope.ownerId === dj.djPeerId && envelope.startedAt === dj.startedAt
}
async function queueTrack(dj: Session, requestId: string, track: SpotifySearchTrack): Promise<SpotifyDjRequestResult> {
  const roomId = useGameStore.getState().roomId
  let result: SpotifyDjRequestResult
  try {
    const queue = typeof window === 'undefined' ? undefined : window.electronAPI?.queueSpotifyTrack
    if (!queue) result = { ok: false, error: 'Reabra o Lira do DJ para ativar a inclusão automática na fila.' }
    else {
      const reply = await queue(track, `${dj.startedAt}:${requestId}`)
      result = typeof reply?.ok === 'boolean' ? { ok: reply.ok,
        ...(typeof reply.error === 'string' ? { error: reply.error.slice(0, 300) } : {}), ...(reply.uncertain === true ? { uncertain: true } : {}) }
        : { ok: false, uncertain: true, error: 'O Spotify não confirmou a inclusão. Confira a fila antes de repetir o pedido.' }
    }
  } catch { result = { ok: false, uncertain: true, error: 'A conexão com o Spotify foi interrompida. Confira a fila antes de repetir o pedido.' } }
  const current = activeDj(dj.zoneId)
  if (current && current.djPeerId === dj.djPeerId && current.startedAt === dj.startedAt && isOwner(current)
    && roomId === useGameStore.getState().roomId && current.requests?.some(request => request.id === requestId)) {
    useSpotifyJamStore.getState().setDjStateInZone(dj.zoneId, { ...current,
      requests: current.requests.map(request => request.id !== requestId ? request : { ...request,
        status: result.ok ? 'queued' : result.uncertain ? 'uncertain' : 'error', ...(result.error ? { error: result.error } : {}),
      }), requestsRevision: (current.requestsRevision || 0) + 1,
    }, true)
  }
  return result
}

function addRequest(dj: Session, requestId: string, query: string, sender: Player, track?: SpotifySearchTrack): Promise<SpotifyDjRequestResult> {
  if (!isOwner(dj)) return Promise.resolve(unavailable())
  const key = JSON.stringify([useGameStore.getState().roomId, dj.zoneId, dj.djPeerId, dj.startedAt])
  let history = received.get(key)
  if (!history) {
    history = new Map()
    received.set(key, history)
    if (received.size > 16) received.delete(received.keys().next().value!)
  }
  const previous = history.get(requestId)
  if (previous) return previous
  let requests = dj.requests || []
  if (track && requests.some(request => request.track?.id === track.id && (request.status === 'adding' || request.status === 'uncertain'))) {
    const rejection = Promise.resolve({ ok: false, error: 'Esta música já está sendo processada ou precisa ser conferida na fila do Spotify.' })
    history.set(requestId, rejection)
    return rejection
  }
  if (requests.length >= MAX_DJ_SONG_REQUESTS) {
    const completed = requests.findIndex(request => request.status === 'queued' || request.status === 'error')
    if (completed >= 0) requests = requests.filter((_, index) => index !== completed)
  }
  const result: SpotifyDjRequestResult = requests.length >= MAX_DJ_SONG_REQUESTS
    ? { ok: false, error: 'A fila tem 50 pedidos. Aguarde o DJ atender alguns deles.' }
    : { ok: true }
  if (result.ok) {
    useSpotifyJamStore.getState().setDjStateInZone(dj.zoneId, { ...dj,
      requests: [...requests, { id: requestId, query, requestedById: sender.id,
        requestedByName: (sender.name || 'Participante').slice(0, 120), requestedAt: Date.now(), ...(track ? { track, status: 'adding' as const } : {}) }],
      requestsRevision: (dj.requestsRevision || 0) + 1,
    }, true)
  }
  const completion = result.ok && track ? queueTrack(dj, requestId, track) : Promise.resolve(result)
  history.set(requestId, completion)
  return completion
}

export function requestDjSong(zoneId: string, text: string, track?: SpotifySearchTrack): Promise<SpotifyDjRequestResult> {
  const query = normalizeDjSongQuery(text)
  if (!query) return Promise.resolve({ ok: false, error: 'Digite uma música ou artista com até 120 caracteres.' })
  if (track !== undefined && !validSpotifySearchTrack(track)) return Promise.resolve({ ok: false, error: 'Selecione uma faixa válida do Spotify.' })
  const dj = activeDj(zoneId)
  const game = useGameStore.getState()
  const sender = member(game.localPlayer.id, zoneId)
  if (!dj || !sender || (dj.djPeerId === sender.id && !isOwner(dj))) return Promise.resolve(unavailable())
  const requestId = crypto.randomUUID()
  if (isOwner(dj)) return Promise.resolve(addRequest(dj, requestId, query, sender, track))
  const envelope: Envelope = { zoneId, ownerId: dj.djPeerId, startedAt: dj.startedAt, requestId }
  return new Promise(resolve => {
    const timer = setTimeout(() => { pending.delete(requestId); resolve(track
      ? { ok: false, uncertain: true, error: 'O DJ ainda não confirmou a inclusão. Confira o andamento do pedido antes de repetir.' }
      : { ok: false, error: 'O DJ não respondeu. Tente novamente.' }) }, track ? 30000 : 8000)
    const finish = (result: SpotifyDjRequestResult) => { clearTimeout(timer); pending.delete(requestId); resolve(result) }
    pending.set(requestId, { ...envelope, roomId: game.roomId, finish })
    try {
      PeerManager.getInstance().broadcast({ type: 'SPOTIFY_DJ_REQUEST', senderId: sender.id,
        payload: { ...envelope, query, ...(track ? { track } : {}) }, timestamp: Date.now() })
    } catch { finish({ ok: false, error: 'Não foi possível enviar o pedido ao DJ.' }) }
  })
}

// The DJ owns the queue. Listeners submit requests; the resulting status snapshot
// synchronizes additions/removals and is also sent to peers joining later.
export function receiveDjRequestMessage(msg: NetworkMessage): boolean {
  const payload = msg.payload || {}
  const dj = typeof payload.zoneId === 'string' ? activeDj(payload.zoneId) : null
  if (!matches(dj, payload) || typeof payload.requestId !== 'string' || !payload.requestId || payload.requestId.length > 128) return false
  if (msg.type === 'SPOTIFY_DJ_REQUEST_RESULT') {
    if (msg.senderId !== dj.djPeerId || typeof payload.result?.ok !== 'boolean'
      || (payload.result.uncertain !== undefined && typeof payload.result.uncertain !== 'boolean')
      || (payload.result.error !== undefined && (typeof payload.result.error !== 'string' || payload.result.error.length > 300))) return false
    const request = pending.get(payload.requestId)
    if (request && request.ownerId === msg.senderId && request.zoneId === payload.zoneId && request.startedAt === payload.startedAt
      && request.roomId === useGameStore.getState().roomId && member(useGameStore.getState().localPlayer.id, payload.zoneId)) {
      request.finish({ ok: payload.result.ok, ...(payload.result.error ? { error: payload.result.error } : {}), ...(payload.result.uncertain === true ? { uncertain: true } : {}) })
    }
    return true
  }
  if (msg.type !== 'SPOTIFY_DJ_REQUEST') return false
  const query = normalizeDjSongQuery(payload.query)
  const sender = member(msg.senderId, payload.zoneId)
  if (!query || !sender || (payload.track !== undefined && !validSpotifySearchTrack(payload.track))) return false
  if (isOwner(dj)) {
    const roomId = useGameStore.getState().roomId
    void addRequest(dj, payload.requestId, query, sender, payload.track).then(result => {
      const current = activeDj(dj.zoneId)
      if (!current || current.djPeerId !== dj.djPeerId || current.startedAt !== dj.startedAt || !isOwner(current)
        || roomId !== useGameStore.getState().roomId) return
      PeerManager.getInstance().broadcast({ type: 'SPOTIFY_DJ_REQUEST_RESULT', senderId: dj.djPeerId, timestamp: Date.now(),
        payload: { zoneId: dj.zoneId, ownerId: dj.djPeerId, startedAt: dj.startedAt, requestId: payload.requestId, result } })
    })
  }
  return true
}

export function removeDjSongRequest(zoneId: string, requestId: string): SpotifyDjRequestResult {
  const dj = activeDj(zoneId)
  if (!dj || !isOwner(dj)) return unavailable()
  const requests = dj.requests || []
  if (requests.some(request => request.id === requestId && request.status === 'adding')) return { ok: false, error: 'Aguarde a inclusão no Spotify terminar antes de remover este pedido.' }
  if (!requests.some(request => request.id === requestId)) return { ok: false, error: 'Este pedido já foi atendido ou removido.' }
  useSpotifyJamStore.getState().setDjStateInZone(zoneId, { ...dj,
    requests: requests.filter(request => request.id !== requestId), requestsRevision: (dj.requestsRevision || 0) + 1,
  }, true)
  return { ok: true }
}

export async function openDjSongRequest(zoneId: string, requestId: string): Promise<SpotifyDjRequestResult> {
  const dj = activeDj(zoneId)
  if (!dj || !isOwner(dj)) return unavailable()
  const request = dj.requests?.find(item => item.id === requestId)
  if (!request) return { ok: false, error: 'Este pedido já foi atendido ou removido.' }
  try {
    return await window.electronAPI?.searchSpotifyMusic?.(request.query)
      || { ok: false, error: 'Atualize o Lira para abrir os pedidos no Spotify.' }
  } catch { return { ok: false, error: 'Não foi possível abrir a busca no Spotify. Tente novamente.' } }
}
