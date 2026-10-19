import { useGameStore } from '../store/useGameStore'
import { useSpotifyJamStore } from '../store/useSpotifyJamStore'
import { PeerManager } from '../p2p/PeerManager'
import type { SpotifyPlaybackCommand, SpotifyPlaybackResult } from '../types/spotifyPlayback'
import type { NetworkMessage } from '../types/p2p'

const pending = new Map<string, { owner: string; finish: (result: SpotifyPlaybackResult) => void }>()
const receivedCommands = new Set<string>()
let commanding = false
let generation = 0
const api = () => typeof window === 'undefined' ? null : (window as any).electronAPI
const localOwner = (zoneId: string) => {
  const state = useSpotifyJamStore.getState()
  const local = useGameStore.getState().localPlayer
  const dj = state.djStateByZone[zoneId]
  return state.isDjModeActive && local.currentZoneId === zoneId && dj?.isDjActive && dj.djPeerId === local.id ? dj : null
}

export async function refreshDjPlayback(zoneId: string): Promise<void> {
  const dj = localOwner(zoneId)
  if (!dj || commanding) return
  const currentGeneration = generation
  try {
    const result: SpotifyPlaybackResult | undefined = await api()?.getSpotifyPlaybackFrame?.()
    const current = localOwner(zoneId)
    if (current && current.startedAt === dj.startedAt && generation === currentGeneration) {
      useSpotifyJamStore.getState().setDjStateInZone(zoneId, {
        ...current,
        playback: result?.ok && result.frame ? result.frame : current.playback,
        playbackError: result?.ok ? null : result?.error || 'Não foi possível atualizar o Spotify. Verifique se ele está aberto no Lira.',
      }, true)
    }
  } catch { /* Keep the last shared frame during transient Spotify failures. */ }
}

function validCommand(command: SpotifyPlaybackCommand): boolean {
  return !!command && ['shuffle', 'previous', 'playpause', 'next', 'repeat', 'seek'].includes(command.action)
    && (command.action !== 'seek' || (typeof command.fraction === 'number' && Number.isFinite(command.fraction) && command.fraction >= 0 && command.fraction <= 1))
}

async function execute(zoneId: string, command: SpotifyPlaybackCommand): Promise<SpotifyPlaybackResult> {
  if (!localOwner(zoneId) || !validCommand(command)) return { ok: false, error: 'Esta transmissão não está mais disponível.' }
  if (commanding) return { ok: false, error: 'Aguarde o controle anterior terminar.' }
  commanding = true
  generation++
  try {
    return await api()?.spotifyPlaybackCommand?.(command) || { ok: false, error: 'Reabra o Lira para ativar os controles do Spotify.' }
  } catch { return { ok: false, error: 'Não foi possível controlar o Spotify.' } }
  finally { commanding = false; await refreshDjPlayback(zoneId) }
}

export function commandDjPlayback(zoneId: string, command: SpotifyPlaybackCommand): Promise<SpotifyPlaybackResult> {
  if (localOwner(zoneId)) return execute(zoneId, command)
  const local = useGameStore.getState().localPlayer
  const dj = useSpotifyJamStore.getState().djStateByZone[zoneId]
  if (!dj?.isDjActive || local.currentZoneId !== zoneId || !validCommand(command)) return Promise.resolve({ ok: false, error: 'Esta transmissão não está mais disponível.' })
  const requestId = crypto.randomUUID()
  return new Promise(resolve => {
    const timer = setTimeout(() => { pending.delete(requestId); resolve({ ok: false, error: 'O DJ não respondeu. Tente novamente.' }) }, 8000)
    const finish = (result: SpotifyPlaybackResult) => { clearTimeout(timer); pending.delete(requestId); resolve(result) }
    pending.set(requestId, { owner: dj.djPeerId, finish })
    try {
      PeerManager.getInstance().broadcast({ type: 'SPOTIFY_DJ_COMMAND', senderId: local.id,
        payload: { zoneId, ownerId: dj.djPeerId, startedAt: dj.startedAt, requestId, command }, timestamp: Date.now() })
    } catch { finish({ ok: false, error: 'Não foi possível enviar o controle ao DJ.' }) }
  })
}

export function receiveDjPlaybackMessage(msg: NetworkMessage): void {
  const payload = msg.payload || {}
  if (msg.type === 'SPOTIFY_DJ_COMMAND_RESULT') {
    const request = pending.get(payload.requestId)
    if (request?.owner === msg.senderId && typeof payload.result?.ok === 'boolean') request.finish(payload.result)
    return
  }
  const dj = localOwner(payload.zoneId)
  const sender = useGameStore.getState().remotePlayers[msg.senderId]
  if (!dj || payload.ownerId !== dj.djPeerId || payload.startedAt !== dj.startedAt || !sender
    || sender.isDjBot || sender.currentZoneId !== payload.zoneId || typeof payload.requestId !== 'string') return
  if (receivedCommands.has(payload.requestId)) return
  receivedCommands.add(payload.requestId)
  if (receivedCommands.size > 128) receivedCommands.delete(receivedCommands.values().next().value!)
  void execute(payload.zoneId, payload.command).then(result => {
    PeerManager.getInstance().broadcast({ type: 'SPOTIFY_DJ_COMMAND_RESULT', senderId: dj.djPeerId,
      payload: { requestId: payload.requestId, result }, timestamp: Date.now() })
  })
}
