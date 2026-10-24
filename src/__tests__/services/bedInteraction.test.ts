import '../helpers/mockAssetPersistence'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { useBedStore } from '../../store/useBedStore'
import { handleBedInteractionKey, handleBedInteractionShortcut, receiveBedInteraction, reconcileBedInteractions, respondToBedInvitation, startBedInteractionLifecycle, getBedScene } from '../../services/bedInteraction'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import type { NetworkMessage } from '../../types/p2p'
const network = vi.hoisted(() => ({ broadcast: vi.fn() }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => network } }))
const game = useGameStore.getState(), map = useMapStore.getState(), assets = useCustomAssetsStore.getState()
const player = (id: string, col: number) => ({ ...game.localPlayer, id, name: id, x: 5 + col, y: 6, isMoving: false, seatedOn: `bed:1:${col}`, currentZoneId: null })
const message = (action: string, senderId = 'a'): NetworkMessage => ({ type: 'BED_INTERACTION', senderId, timestamp: Date.now(), payload: action === 'invite'
  ? { action, session: { id: 'invitation', roomId: 'space', furnitureId: 'bed', initiatorId: 'a', targetId: 'b', createdAt: Date.now() } }
  : { action, furnitureId: 'bed', sessionId: 'invitation' } })
const session = () => useBedStore.getState().sessions.bed
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(100000); vi.clearAllMocks()
  useBedStore.setState({ sessions: {}, seenInvites: [] })
  useGameStore.setState({ isConnected: true, roomId: 'space', localPlayer: player('a', 0), remotePlayers: { b: player('b', 1) } })
  useMapStore.setState({ isEditorOpen: false, mapData: { ...map.mapData, furniture: [{ id: 'bed', defId: 'romantic-bed', x: 5, y: 5, direction: 'down' }] } })
  useCustomAssetsStore.setState({ customAssets: [{ id: 'romantic-bed', name: 'Cama', category: 'Quarto', type: 'furniture', width: 2, height: 3, isObstacle: true, seatGrid: [[false, false], [true, true]], frames: ['idle'], bedAnimation: { frames: ['covered1', 'covered2'], frameRateMs: 320 }, createdAt: 1 }] })
})
afterEach(() => { vi.useRealTimers(); useGameStore.setState(game); useMapStore.setState(map); useCustomAssetsStore.setState(assets); useBedStore.setState({ sessions: {} }) })
it('requires two distinct occupied seats on this bed before inviting, and consumes E while waiting alone', () => {
  useGameStore.setState({ remotePlayers: {} })
  expect(handleBedInteractionKey()).toBe(true)
  expect(network.broadcast).not.toHaveBeenCalled()
  useGameStore.setState({ remotePlayers: { b: player('b', 1) } })
  expect(handleBedInteractionKey()).toBe(true)
  expect(network.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'BED_INTERACTION', payload: expect.objectContaining({ action: 'invite' }) }))
  expect(session()).toMatchObject({ initiatorId: 'a', targetId: 'b', stage: 'invited' })
  expect(getBedScene('bed')).toBeNull()
  handleBedInteractionKey()
  expect(network.broadcast).toHaveBeenCalledTimes(1)
})
it('starts the animation only after the invited player explicitly accepts, using the same time for every client', () => {
  expect(receiveBedInteraction(message('invite'))).toBe(true)
  expect(receiveBedInteraction(message('accept', 'a'))).toBe(false)
  expect(getBedScene('bed')).toBeNull()
  expect(receiveBedInteraction(message('accept', 'b'))).toBe(true)
  expect(session()).toMatchObject({ stage: 'active', acceptedAt: Date.now() })
  expect(getBedScene('bed')).toMatchObject({ participantIds: ['a', 'b'], frame: 'covered1' })
  vi.advanceTimersByTime(320)
  expect(getBedScene('bed')?.frame).toBe('covered2')
  expect(getBedScene('bed')?.elapsedMs).toBe(320)
  vi.advanceTimersByTime(100)
  expect(getBedScene('bed')?.elapsedMs).toBe(420)
})
it('lets the recipient accept with E and either participant cancel the scene', () => {
  receiveBedInteraction(message('invite'))
  useGameStore.setState({ localPlayer: player('b', 1), remotePlayers: { a: player('a', 0) } })
  handleBedInteractionKey()
  expect(network.broadcast).toHaveBeenLastCalledWith(expect.objectContaining({ senderId: 'b', payload: expect.objectContaining({ action: 'accept' }) }))
  expect(session()?.stage).toBe('active')
  handleBedInteractionKey()
  expect(session()).toBeUndefined()
})
it('declines without animating and never accepts a delayed response to that invitation', () => {
  receiveBedInteraction(message('invite'))
  useGameStore.setState({ localPlayer: player('b', 1), remotePlayers: { a: player('a', 0) } })
  respondToBedInvitation(false)
  expect(session()).toBeUndefined()
  expect(receiveBedInteraction(message('accept', 'b'))).toBe(false)
})
it.each(['standing', 'same-seat', 'different-bed', 'bot', 'fake-position', 'editor'])('rejects an invitation when eligibility changes: %s', scenario => {
  const b = player('b', 1)
  if (scenario === 'standing') b.seatedOn = null as any
  if (scenario === 'same-seat') { b.seatedOn = 'bed:1:0'; b.x = 5 }
  if (scenario === 'different-bed') b.seatedOn = 'other:1:1'
  if (scenario === 'bot') b.isDjBot = true
  if (scenario === 'fake-position') b.x = 12
  if (scenario === 'editor') useMapStore.setState({ isEditorOpen: true })
  useGameStore.setState({ remotePlayers: { b } })
  expect(receiveBedInteraction(message('invite'))).toBe(false)
})
it('rejects strangers, old invites, other spaces and stale or replayed acceptance', () => {
  const invite = message('invite')
  expect(receiveBedInteraction({ ...invite, senderId: 'stranger' })).toBe(false)
  expect(receiveBedInteraction({ ...invite, payload: { action: 'invite', session: { ...invite.payload.session, roomId: 'other' } } })).toBe(false)
  vi.advanceTimersByTime(21000)
  expect(receiveBedInteraction(invite)).toBe(false)
  expect(receiveBedInteraction(message('accept', 'b'))).toBe(false)
  receiveBedInteraction(message('invite'))
  receiveBedInteraction(message('accept', 'b'))
  const started = session()?.acceptedAt
  vi.advanceTimersByTime(500)
  expect(receiveBedInteraction(message('accept', 'b'))).toBe(false)
  expect(session()?.acceptedAt).toBe(started)
})
it.each(['leave-seat', 'disconnect', 'remove-bed', 'leave-space', 'timeout'])('cleans up an active scene automatically: %s', change => {
  receiveBedInteraction(message('invite')); receiveBedInteraction(message('accept', 'b'))
  if (change === 'leave-seat') useGameStore.getState().setLocalPlayer({ seatedOn: null })
  if (change === 'disconnect') useGameStore.setState({ remotePlayers: {} })
  if (change === 'remove-bed') useMapStore.setState({ mapData: { ...useMapStore.getState().mapData, furniture: [] } })
  if (change === 'leave-space') useGameStore.setState({ roomId: 'other' })
  if (change === 'timeout') vi.advanceTimersByTime(21000)
  expect(getBedScene('bed')).toBeNull()
  reconcileBedInteractions()
  expect(session()).toBeUndefined()
})
it('expires unanswered invitations and observes movements without needing another key press', () => {
  const stop = startBedInteractionLifecycle()
  receiveBedInteraction(message('invite'))
  vi.advanceTimersByTime(21000)
  expect(session()).toBeUndefined()
  receiveBedInteraction(message('invite')); receiveBedInteraction(message('accept', 'b'))
  useGameStore.getState().setLocalPlayer({ seatedOn: null })
  expect(session()).toBeUndefined()
  stop()
  expect(vi.getTimerCount()).toBe(0)
})
it('relays valid consent messages through the host and rejects spoofed senders', () => {
  const relay = vi.fn(), invite = message('invite')
  processNetworkMessage(invite, 'b', true, relay, vi.fn(), vi.fn(), 'host')
  expect(relay).not.toHaveBeenCalled()
  processNetworkMessage(invite, 'a', true, relay, vi.fn(), vi.fn(), 'host')
  expect(relay).toHaveBeenCalledWith(invite, 'a')
})
it('leaves E available for the editor away from the bed', () => {
  useGameStore.getState().setLocalPlayer({ seatedOn: null })
  expect(handleBedInteractionKey()).toBe(false)
})
it('does not restore consent by replaying an invitation and its acceptance after cancellation', () => {
  const invite = message('invite'), accept = message('accept', 'b')
  receiveBedInteraction(invite); receiveBedInteraction(accept)
  expect(receiveBedInteraction(message('cancel', 'a'))).toBe(true)
  expect(receiveBedInteraction(invite)).toBe(false)
  expect(receiveBedInteraction(accept)).toBe(false)
  expect(getBedScene('bed')).toBeNull()
})
it('shows the shared animation to a spectator even while that spectator has the editor open', () => {
  useGameStore.setState({ localPlayer: { ...player('observer', 0), seatedOn: null, x: 12 }, remotePlayers: { a: player('a', 0), b: player('b', 1) } })
  useMapStore.setState({ isEditorOpen: true })
  expect(receiveBedInteraction(message('invite'))).toBe(true)
  expect(receiveBedInteraction(message('accept', 'b'))).toBe(true)
  expect(getBedScene('bed')).not.toBeNull()
})
it('resolves simultaneous invitations consistently while still requiring acceptance', () => {
  useGameStore.setState({ localPlayer: player('b', 1), remotePlayers: { a: player('a', 0) } })
  handleBedInteractionKey()
  expect(session()?.initiatorId).toBe('b')
  expect(receiveBedInteraction(message('invite'))).toBe(true)
  expect(session()).toMatchObject({ initiatorId: 'a', targetId: 'b', stage: 'invited' })
  expect(getBedScene('bed')).toBeNull()
  handleBedInteractionKey()
  expect(session()?.stage).toBe('active')
})
it('ignores typing, modifiers and repeated E presses while routing a fresh bed shortcut', () => {
  const event = (change = {}) => ({ key: 'e', target: { tagName: 'DIV' }, preventDefault: vi.fn(), repeat: false, ...change }) as unknown as KeyboardEvent
  for (const change of [{ target: { tagName: 'INPUT' } }, { target: { tagName: 'TEXTAREA' } }, { target: { isContentEditable: true } }, { ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
    expect(handleBedInteractionShortcut(event(change))).toBe(false)
  }
  expect(network.broadcast).not.toHaveBeenCalled()
  expect(handleBedInteractionShortcut(event({ repeat: true }))).toBe(true)
  expect(network.broadcast).not.toHaveBeenCalled()
  const key = event()
  expect(handleBedInteractionShortcut(key)).toBe(true)
  expect(key.preventDefault).toHaveBeenCalled()
  expect(network.broadcast).toHaveBeenCalledTimes(1)
})
