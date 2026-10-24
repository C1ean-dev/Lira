import { useBedStore, type BedSession } from '../store/useBedStore'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { findFurnitureSeatAt, findFurnitureSeatById } from '../engine/physics/seating'
import { PeerManager } from '../p2p/PeerManager'
import type { Player } from '../types/game'
import type { NetworkMessage } from '../types/p2p'

export const BED_INVITE_MS = 20000
export const BED_SCENE_MS = 12000

function occupiedBed(player: Player) {
  if (!player.seatedOn || player.isMoving || player.isDjBot ||
    (player.id === useGameStore.getState().localPlayer.id && useMapStore.getState().isEditorOpen)) return null
  const map = useMapStore.getState().mapData
  const seat = findFurnitureSeatAt(player.x + .5, player.y + .5, map) || findFurnitureSeatById(player.seatedOn, map)
  if (!seat || seat.id !== player.seatedOn) return null
  if (Math.abs(player.x - seat.x) > 1.0 || Math.abs(player.y - seat.y) > 1.0) return null
  const furniture = map.furniture.find(item => item.id === seat.furnitureId)
  const asset = furniture && useCustomAssetsStore.getState().getAssetById(furniture.defId)
  return furniture && asset?.bedAnimation?.frames.length ? { furniture, asset, seat } : null
}

export function getLocalBed() {
  const game = useGameStore.getState()
  return game.isConnected && game.roomId ? occupiedBed(game.localPlayer) : null
}

function findPlayer(players: Player[], id: string) {
  return players.find(p => p.id === id || (p.gameId && p.gameId === id))
}

function validPair(session: Pick<BedSession, 'roomId' | 'furnitureId' | 'initiatorId' | 'targetId'>) {
  const game = useGameStore.getState()
  if (!game.isConnected || game.roomId !== session.roomId || session.initiatorId === session.targetId) return false
  const players = [game.localPlayer, ...Object.values(game.remotePlayers)]
  const a = findPlayer(players, session.initiatorId)
  const b = findPlayer(players, session.targetId)
  if (!a || !b) return false
  const aZone = a.currentZoneId ?? null
  const bZone = b.currentZoneId ?? null
  if (aZone !== bZone) return false
  const aBed = occupiedBed(a), bBed = occupiedBed(b)
  return !!aBed && !!bBed && aBed.furniture.id === session.furnitureId && bBed.furniture.id === session.furnitureId && aBed.seat.id !== bBed.seat.id
}

function isCurrent(session: BedSession, now = Date.now()) {
  const since = session.stage === 'active' ? (session.acceptedAt || session.createdAt) : session.createdAt
  const elapsed = now - since
  if (!Number.isFinite(since) || elapsed < -60000) return false
  if (session.stage === 'invited' && elapsed >= BED_INVITE_MS) return false
  return validPair(session)
}

function putSession(furnitureId: string, session?: BedSession) {
  const sessions = { ...useBedStore.getState().sessions }
  if (session) sessions[furnitureId] = session
  else delete sessions[furnitureId]
  useBedStore.setState({ sessions })
}

export function reconcileBedInteractions() {
  for (const session of Object.values(useBedStore.getState().sessions)) {
    if (!isCurrent(session)) putSession(session.furnitureId)
  }
}

export function receiveBedInteraction(message: NetworkMessage): boolean {
  if (message.type !== 'BED_INTERACTION') return false
  const payload = message.payload
  if (!payload || typeof payload !== 'object') return false
  const game = useGameStore.getState()
  const allPlayers = [game.localPlayer, ...Object.values(game.remotePlayers)]
  const matchesSender = (targetId: string, senderId: string) => {
    if (targetId === senderId) return true
    const p = allPlayers.find(pl => pl.id === targetId || (pl.gameId && pl.gameId === targetId))
    return !!p && (p.id === senderId || p.gameId === senderId)
  }

  if (payload.action === 'invite') {
    const proposal = payload.session as BedSession | undefined
    if (!proposal || typeof proposal.id !== 'string' || !proposal.id || proposal.id.length > 160 ||
      typeof proposal.furnitureId !== 'string' || typeof proposal.initiatorId !== 'string' || typeof proposal.targetId !== 'string' ||
      !matchesSender(proposal.initiatorId, message.senderId) || !Number.isFinite(proposal.createdAt) ||
      Date.now() - proposal.createdAt >= BED_INVITE_MS || proposal.createdAt > Date.now() + 60000) return false
    const session: BedSession = { id: proposal.id, roomId: proposal.roomId, furnitureId: proposal.furnitureId,
      initiatorId: proposal.initiatorId, targetId: proposal.targetId, createdAt: proposal.createdAt, stage: 'invited' }
    if (!isCurrent(session)) return false
    const inviteKey = JSON.stringify([session.roomId, session.furnitureId, session.id])
    const seen = useBedStore.getState().seenInvites
    if (seen.includes(inviteKey)) return false
    const previous = useBedStore.getState().sessions[session.furnitureId]
    // When both press E at once, every peer keeps the same proposal.
    if (previous && isCurrent(previous) && (previous.stage === 'active' || previous.initiatorId <= session.initiatorId)) return false
    useBedStore.setState({ seenInvites: [...seen.slice(-127), inviteKey] })
    putSession(session.furnitureId, session)
    return true
  }
  const session = useBedStore.getState().sessions[payload.furnitureId]
  if (!session || session.id !== payload.sessionId || !isCurrent(session)) return false
  if (payload.action === 'accept') {
    if (session.stage !== 'invited' || !matchesSender(session.targetId, message.senderId)) return false
    putSession(session.furnitureId, { ...session, stage: 'active', acceptedAt: Date.now() })
    return true
  }
  if ((payload.action === 'decline' && session.stage === 'invited' && matchesSender(session.targetId, message.senderId)) ||
    (payload.action === 'cancel' && (matchesSender(session.initiatorId, message.senderId) || matchesSender(session.targetId, message.senderId)))) {
    putSession(session.furnitureId)
    return true
  }
  return false
}

function send(payload: NetworkMessage['payload']) {
  const peerId = PeerManager.getInstance().getPeerId?.()
  const senderId = peerId || useGameStore.getState().localPlayer.id
  const message: NetworkMessage = { type: 'BED_INTERACTION', senderId, timestamp: Date.now(), payload }
  if (!receiveBedInteraction(message)) return false
  PeerManager.getInstance().broadcast(message)
  return true
}

export function respondToBedInvitation(accept: boolean) {
  const bed = getLocalBed()
  const session = bed && useBedStore.getState().sessions[bed.furniture.id]
  if (!session) return false
  return send({ action: accept ? 'accept' : 'decline', furnitureId: session.furnitureId, sessionId: session.id })
}

export function cancelBedInteraction() {
  const bed = getLocalBed()
  const session = bed && useBedStore.getState().sessions[bed.furniture.id]
  if (session) send({ action: 'cancel', furnitureId: session.furnitureId, sessionId: session.id })
}

/** Returns true when E belongs to the bed instead of the editor shortcut. */
export function handleBedInteractionKey(): boolean {
  const bed = getLocalBed()
  if (!bed) return false
  reconcileBedInteractions()
  const game = useGameStore.getState()
  const session = useBedStore.getState().sessions[bed.furniture.id]
  const isTarget = session && (session.targetId === game.localPlayer.id || (!!game.localPlayer.gameId && session.targetId === game.localPlayer.gameId))
  if (session?.stage === 'active') cancelBedInteraction()
  else if (isTarget) respondToBedInvitation(true)
  else if (!session) {
    const candidate = Object.values(game.remotePlayers).find(p => validPair({ roomId: game.roomId!, furnitureId: bed.furniture.id, initiatorId: game.localPlayer.id, targetId: p.id }))
    if (candidate) send({ action: 'invite', session: { id: crypto.randomUUID(), roomId: game.roomId!, furnitureId: bed.furniture.id,
      initiatorId: game.localPlayer.id, targetId: candidate.id, createdAt: Date.now() } })
  }
  return true
}

export function handleBedInteractionShortcut(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  if (event.key.toLowerCase() !== 'e' || event.ctrlKey || event.altKey || event.metaKey ||
    target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target?.tagName || '')) return false
  if (!getLocalBed()) return false
  event.preventDefault()
  if (!event.repeat) handleBedInteractionKey()
  return true
}

export function getBedScene(furnitureId: string, now = Date.now()) {
  const session = useBedStore.getState().sessions[furnitureId]
  if (!session || session.stage !== 'active' || !isCurrent(session, now)) return null
  const furniture = useMapStore.getState().mapData.furniture.find(item => item.id === furnitureId)
  const animation = furniture && useCustomAssetsStore.getState().getAssetById(furniture.defId)?.bedAnimation
  if (!animation?.frames.length) return null
  const elapsed = Math.max(0, now - session.acceptedAt!)
  const index = Math.floor(elapsed / Math.max(100, animation.frameRateMs || 320)) % animation.frames.length
  return { participantIds: [session.initiatorId, session.targetId], frame: animation.frames[index], elapsedMs: elapsed, coverProgress: Math.min(1, elapsed / 450) }
}

export function startBedInteractionLifecycle() {
  const unsubscribers = [useGameStore.subscribe(reconcileBedInteractions), useMapStore.subscribe(reconcileBedInteractions), useCustomAssetsStore.subscribe(reconcileBedInteractions)]
  const timer = setInterval(reconcileBedInteractions, 250)
  return () => {
    unsubscribers.forEach(unsubscribe => unsubscribe())
    clearInterval(timer)
    useBedStore.setState({ sessions: {} })
  }
}
