import { afterEach, describe, expect, it, vi } from 'vitest'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { useGameStore } from '../../store/useGameStore'

const initial = useGameStore.getState()
afterEach(() => useGameStore.setState(initial))
const run = (type: 'PLAYER_JOIN' | 'PLAYER_UPDATE', player: any) => processNetworkMessage(
  { type, senderId: player.id, payload: { player }, timestamp: Date.now() }, player.id, false, vi.fn(), vi.fn(), vi.fn(), 'self')

describe('pet profile synchronization', () => {
  it('keeps the room owner identity and the pet personality when a player joins', () => {
    run('PLAYER_JOIN', { ...initial.localPlayer, id: 'lira-room-host', gameId: 'host-game', isOwner: true, avatar: { ...initial.localPlayer.avatar, pet: { type: 'custom', customAssetId: 'x', name: 'Rex', personality: 'Curioso' } } })
    const player = useGameStore.getState().remotePlayers['lira-room-host']
    expect(player.isOwner).toBe(true)
    expect(player.avatar?.pet?.personality).toBe('Curioso')
  })
  it('updates a pet personality when its owner saves the avatar', () => {
    run('PLAYER_JOIN', { ...initial.localPlayer, id: 'visitor', gameId: 'visitor-game', avatar: { ...initial.localPlayer.avatar, pet: { type: 'meowth', name: 'Rex' } } })
    run('PLAYER_UPDATE', { id: 'visitor', gameId: 'visitor-game', avatar: { ...initial.localPlayer.avatar, pet: { type: 'meowth', name: 'Rex', personality: 'Fala baixinho' } } })
    expect(useGameStore.getState().remotePlayers.visitor.avatar?.pet?.personality).toBe('Fala baixinho')
  })
})
