import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MiniCallOverlay } from '../../components/MiniCallOverlay'
import { CurrentLocationPill } from '../../components/CurrentLocationPill'
import {
  PROXIMITY_ENTER_RADIUS,
  PROXIMITY_EXIT_RADIUS,
  arePlayersCallEligible,
  isPlayerInCorridor,
  isWithinProximityCall,
} from '../../engine/proximityCall'
import { PeerManager } from '../../p2p/PeerManager'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { useGameStore } from '../../store/useGameStore'

vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))
vi.mock('peerjs', () => ({ default: class {} }))

const originalGame = useGameStore.getState()

describe('Corredor Geral proximity calls', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useGameStore.setState({
      ...originalGame,
      localPlayer: {
        ...originalGame.localPlayer,
        id: 'local-1',
        name: 'Player',
        x: 10,
        y: 10,
        currentZoneId: null,
        currentHouseId: null,
      },
      remotePlayers: {},
      callStates: {},
      proximityPeerIds: [],
    })
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.restoreAllMocks()
    useGameStore.setState(originalGame)
  })

  it('evaluates 10-tile corridor eligibility and 11-tile hysteresis while isolating zones, houses, and DJ bots', () => {
    expect(PROXIMITY_ENTER_RADIUS).toBe(10)
    expect(PROXIMITY_EXIT_RADIUS).toBe(11)

    const local = useGameStore.getState().localPlayer
    expect(isPlayerInCorridor(local)).toBe(true)
    expect(isPlayerInCorridor({ currentZoneId: 'room-1', currentHouseId: null })).toBe(false)
    expect(isPlayerInCorridor({ currentZoneId: null, currentHouseId: 'house-1' })).toBe(false)

    const nearPeer = { ...local, id: 'p-near', x: 19.8, y: 10 }
    const hysteresisPeer = { ...local, id: 'p-mid', x: 20.5, y: 10 }
    const farPeer = { ...local, id: 'p-far', x: 21.1, y: 10 }
    const roomPeer = { ...local, id: 'p-room', x: 11, y: 10, currentZoneId: 'room-1' }
    const housePeer = { ...local, id: 'p-house', x: 11, y: 10, currentHouseId: 'house-1' }
    const djBot = { ...local, id: 'dj-room', x: 11, y: 10, isDjBot: true }

    expect(isWithinProximityCall(local, nearPeer, false)).toBe(true)
    expect(isWithinProximityCall(local, hysteresisPeer, false)).toBe(false)
    expect(isWithinProximityCall(local, hysteresisPeer, true)).toBe(true)
    expect(isWithinProximityCall(local, farPeer, true)).toBe(false)
    expect(isWithinProximityCall(local, roomPeer, false)).toBe(false)
    expect(isWithinProximityCall(local, housePeer, false)).toBe(false)
    expect(isWithinProximityCall(local, djBot, false)).toBe(false)

    expect(arePlayersCallEligible(local, nearPeer, false)).toEqual({ eligible: true, mode: 'proximity' })
    expect(arePlayersCallEligible({ ...local, currentZoneId: 'room-1' }, roomPeer, false)).toEqual({
      eligible: true,
      mode: 'zone',
    })
  })

  it('syncs corridor proximity state in PeerManager and dials/terminates via MediaCallHandler', () => {
    const pm = new (PeerManager as any)()
    pm.peer = { id: 'local-1', destroyed: false }
    pm.roomCode = 'ROOM'

    const checkSpy = vi.spyOn(MediaCallHandler, 'checkZoneCallEligibility').mockImplementation(() => {})

    const local = useGameStore.getState().localPlayer
    useGameStore.getState().setRemotePlayer({
      ...local,
      id: 'peer-near',
      name: 'Alice',
      x: 19,
      y: 10,
      currentZoneId: null,
      currentHouseId: null,
    })
    useGameStore.getState().setRemotePlayer({
      ...local,
      id: 'peer-far',
      name: 'Bob',
      x: 30,
      y: 25,
      currentZoneId: null,
      currentHouseId: null,
    })

    pm.syncProximityCalls()
    expect(useGameStore.getState().proximityPeerIds).toEqual(['peer-near'])

    vi.advanceTimersByTime(16)
    expect(checkSpy).toHaveBeenCalledTimes(1)
    expect(checkSpy.mock.calls[0][0].id).toBe('peer-near')

    // Moving slightly outside 10-tile enter radius but inside 11-tile hysteresis keeps peer-near active
    useGameStore.getState().updateRemotePlayerPosition('peer-near', 20.5, 10, 'right', true)
    pm.syncProximityCalls()
    expect(useGameStore.getState().proximityPeerIds).toEqual(['peer-near'])

    // Walking beyond 11-tile exit radius disconnects peer-near cleanly
    useGameStore.getState().updateRemotePlayerPosition('peer-near', 22.0, 10, 'right', false)
    pm.syncProximityCalls()
    expect(useGameStore.getState().proximityPeerIds).toEqual([])

    vi.advanceTimersByTime(16)
    expect(checkSpy).toHaveBeenCalledTimes(2)
    expect(checkSpy.mock.calls[1][0].id).toBe('peer-near')
  })

  it('renders MiniCallOverlay and CurrentLocationPill cleanly for proximity calls vs empty corridor', () => {
    vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, getSnapshot) => getSnapshot())

    // Alone in Corredor Geral: MiniCallOverlay renders nothing, pill shows Corredor Geral
    expect(renderToStaticMarkup(React.createElement(MiniCallOverlay))).toBe('')
    expect(renderToStaticMarkup(React.createElement(CurrentLocationPill))).toContain('Corredor Geral')

    // With nearby corridor peer: MiniCallOverlay shows Proximidade without Jam/Shield buttons
    const local = useGameStore.getState().localPlayer
    useGameStore.setState({
      remotePlayers: {
        'peer-near': { ...local, id: 'peer-near', name: 'Alice', x: 18, y: 10 },
      },
      proximityPeerIds: ['peer-near'],
    })

    const overlayHtml = renderToStaticMarkup(React.createElement(MiniCallOverlay))
    expect(overlayHtml).toContain('Proximidade')
    expect(overlayHtml).toContain('Alice')
    expect(overlayHtml).not.toContain('Iniciar Spotify Jam')
    expect(overlayHtml).not.toContain('Gerenciar Usuários com Permissão de Entrada')

    const pillHtml = renderToStaticMarkup(React.createElement(CurrentLocationPill))
    expect(pillHtml).toContain('Corredor Geral · Proximidade (2)')
  })
})
