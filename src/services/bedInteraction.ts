import { useBedStore, type BedSession } from '../store/useBedStore'
import { useGameStore } from '../store/useGameStore'
import { useMapStore } from '../store/useMapStore'
import { useCustomAssetsStore } from '../store/useCustomAssetsStore'
import { findFurnitureSeatAt } from '../engine/physics/seating'
import { PeerManager } from '../p2p/PeerManager'
import type { Player } from '../types/game'
import type { NetworkMessage } from '../types/p2p'

export const BED_INVITE_MS = 20000
export const BED_SCENE_MS = 12000
const CLOCK_TOLERANCE_MS = 5000

function occupiedBed(player: Player) {
  if (!player.seatedOn || player.isMoving || player.isDjBot ||
    (player.id === useGameStore.getState().localPlayer.id && useMapStore.getState().isEditorOpen)) return null
  const map = useMapStore.getState().mapData
  const seat = findFurnitureSeatAt(player.x + .5, player.y + .5, map)
  if (!seat || seat.id !== player.seatedOn) return null
  const furniture = map.furniture.find(item => item.id === seat.furnitureId)
  const asset = furniture && useCustomAssetsStore.getState().getAssetById(furniture.defId)
  return furniture && asset?.bedAnimation?.frames.length ? { furniture, asset, seat } : null
}

export function getLocalBed() {
  const game = useGameStore.getState()
  return game.isConnected && game.roomId ? occupiedBed(game.localPlayer) : null
}

function validPair(session: Pick<BedSession, 'roomId' | 'furnitureId' | 'initiatorId' | 'targetId'>) {
  const game = useGameStore.getState()
  if (!game.isConnected || game.roomId !== session.roomId || session.initiatorId === session.targetId) return false
  const players = [game.localPlayer, ...Object.values(game.remotePlayers)]
  const a = players.find(p => p.id === session.initiatorId)
  const b = players.find(p => p.id === session.targetId)
  if (!a || !b || a.currentZoneId !== b.currentZoneId) return false
  const aBed = occupiedBed(a), bBed = occupiedBed(b)
  return !!aBed && !!bBed && aBed.furniture.id === session.furnitureId && bBed.furniture.id === session.furnitureId && aBed.seat.id !== bBed.seat.id
}

function isCurrent(session: BedSession, now = Date.now()) {
  const since = session.stage === 'active' ? session.acceptedAt! : session.createdAt
  return Number.isFinite(since) && since <= now + CLOCK_TOLERANCE_MS &&
    now - since < (session.stage === 'active' ? BED_SCENE_MS : BED_INVITE_MS) && validPair(session)
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
  if (payload.action === 'invite') {
    const proposal = payload.session as BedSession | undefined
    if (!proposal || typeof proposal.id !== 'string' || !proposal.id || proposal.id.length > 160 ||
      typeof proposal.furnitureId !== 'string' || typeof proposal.initiatorId !== 'string' || typeof proposal.targetId !== 'string' ||
      message.senderId !== proposal.initiatorId || !Number.isFinite(proposal.createdAt)) return false
    const session: BedSession = { id: proposal.id, roomId: proposal.roomId, furnitureId: proposal.furnitureId,
      initiatorId: proposal.initiatorId, targetId: proposal.targetId, createdAt: proposal.createdAt, stage: 'invited' }
    if (!isCurrent(session)) return false
    const inviteKey = JSON.stringify([session.roomId, session.furnitureId, session.id, session.createdAt])
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
    if (session.stage !== 'invited' || message.senderId !== session.targetId || !Number.isFinite(message.timestamp) ||
      Math.abs(Date.now() - message.timestamp) > CLOCK_TOLERANCE_MS || message.timestamp < session.createdAt - CLOCK_TOLERANCE_MS) return false
    putSession(session.furnitureId, { ...session, stage: 'active', acceptedAt: message.timestamp })
    return true
  }
  if ((payload.action === 'decline' && session.stage === 'invited' && message.senderId === session.targetId) ||
    (payload.action === 'cancel' && [session.initiatorId, session.targetId].includes(message.senderId))) {
    putSession(session.furnitureId)
    return true
  }
  return false
}

function send(payload: NetworkMessage['payload']) {
  const message: NetworkMessage = { type: 'BED_INTERACTION', senderId: useGameStore.getState().localPlayer.id, timestamp: Date.now(), payload }
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
  if (session?.stage === 'active') cancelBedInteraction()
  else if (session?.targetId === game.localPlayer.id) respondToBedInvitation(true)
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
  return { participantIds: [session.initiatorId, session.targetId], frame: animation.frames[index], coverProgress: Math.min(1, elapsed / 450) }
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
