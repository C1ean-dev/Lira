import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerManager } from '../../p2p/PeerManager'
import { TopNavBar } from '../../components/TopNavBar'
import { useGameStore } from '../../store/useGameStore'

const button = vi.hoisted(() => ({ click: null as null | (() => void) }))
vi.mock('react/jsx-runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('react/jsx-runtime')>()
  const capture = (factory: typeof actual.jsx) => (type: any, props: any, key: any) => {
    if (type === 'button' && props.title === 'Conexão com o servidor perdida. Clique para tentar reconectar agora.') button.click = props.onClick
    return factory(type, props, key)
  }
  return { ...actual, jsx: capture(actual.jsx), jsxs: capture(actual.jsxs) }
})
vi.mock('react/jsx-dev-runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('react/jsx-dev-runtime')>()
  return { ...actual, jsxDEV: (type: any, props: any, ...args: any[]) => {
    if (type === 'button' && props.title === 'Conexão com o servidor perdida. Clique para tentar reconectar agora.') button.click = props.onClick
    return actual.jsxDEV(type, props, ...args)
  } }
})
vi.mock('../../hooks/useRoomPublication', () => ({ useRoomPublication: () => [] }))
vi.mock('../../store/useGameStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../../store/useGameStore')>()
  return { ...actual, useGameStore: Object.assign((select: any) => select(actual.useGameStore.getState()), actual.useGameStore) }
})

const original = useGameStore.getState()
let manager: any
let peer: any
let events: Record<string, (...args: any[]) => void>
let network: EventTarget

beforeEach(() => {
  vi.useFakeTimers()
  network = new EventTarget()
  vi.stubGlobal('window', network)
  events = {}
  button.click = null
  peer = {
    id: 'local', open: false, destroyed: false, disconnected: true,
    reconnect: vi.fn(),
    on: (event: string, listener: (...args: any[]) => void) => { events[event] = listener },
  }
  peer.disconnect = vi.fn(() => { peer.disconnected = true; peer.open = false; events.disconnected?.('local') })
  manager = new (PeerManager as any)()
  manager.peer = peer
  manager.roomCode = 'ROOM'
  manager.isHost = true
  manager.setupSignalingListeners(peer)
  vi.spyOn(PeerManager, 'getInstance').mockReturnValue(manager)
  useGameStore.setState({
    roomId: 'ROOM', connectionStatus: 'disconnected', isConnected: false,
    roomName: 'Minha sala', roomDescription: 'Descrição', isRoomPublic: true, maxPlayers: 12, roomColor: '#123456',
  })
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useGameStore.setState(original)
})

describe('reconnecting a room after an internet outage', () => {
  it('lets the actual Reconectar button restart recovery when disconnected', async () => {
    expect(renderToStaticMarkup(<TopNavBar onOpenAvatarModal={() => {}} />)).toContain('Reconectar')
    expect(button.click).toBeTypeOf('function')
    button.click!()
    expect(useGameStore.getState().connectionStatus).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(0)
    expect(peer.reconnect).toHaveBeenCalledOnce()
    peer.open = true; peer.disconnected = false
    events.open('local')
    expect(useGameStore.getState()).toMatchObject({ isConnected: true, connectionStatus: 'connected', roomId: 'ROOM' })
  })

  it('restarts recovery immediately when the network returns during an outage', async () => {
    manager.scheduleSignalingReconnect()
    expect(peer.reconnect).not.toHaveBeenCalled()
    network.dispatchEvent(new Event('online'))
    expect(useGameStore.getState().connectionStatus).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(0)
    expect(peer.reconnect).toHaveBeenCalledOnce()
  })

  it('replaces a pending retry with one immediate attempt even after repeated clicks', async () => {
    manager.scheduleSignalingReconnect()
    manager.reconnect()
    manager.reconnect()
    manager.reconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(peer.reconnect).toHaveBeenCalledOnce()
    peer.open = true; peer.disconnected = false
    events.open('local')
    await vi.advanceTimersByTimeAsync(120000)
    expect(peer.reconnect).toHaveBeenCalledOnce()
  })

  it('resets a stalled signaling handshake without closing established calls', async () => {
    const call = { close: vi.fn() }
    manager.mediaCalls.set('remote', call)
    peer.disconnected = false
    peer.reconnect.mockImplementation(() => { if (!peer.disconnected) throw new Error('Already connecting') })
    manager.reconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(peer.disconnect).toHaveBeenCalledOnce()
    expect(peer.reconnect).toHaveBeenCalledOnce()
    expect(manager.peer).toBe(peer)
    expect(call.close).not.toHaveBeenCalled()
  })

  it.each(['missing', 'destroyed'])('recreates a %s host peer and keeps the room details', async state => {
    if (state === 'missing') manager.peer = null
    else peer.destroyed = true
    const create = vi.spyOn(manager, 'createRoom').mockResolvedValue('ROOM')
    manager.reconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(create).toHaveBeenCalledExactlyOnceWith('ROOM', useGameStore.getState().localPlayer, {
      roomName: 'Minha sala', roomDescription: 'Descrição', isPublic: true, maxPlayers: 12, color: '#123456',
    }, 0)
  })

  it('rejoins as a client when the signaling peer is open but the host connection is gone', async () => {
    manager.isHost = false
    peer.open = true; peer.disconnected = false
    const join = vi.spyOn(manager, 'joinRoom').mockResolvedValue(undefined)
    manager.reconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(join).toHaveBeenCalledExactlyOnceWith('ROOM', useGameStore.getState().localPlayer, 0)
    expect(peer.reconnect).not.toHaveBeenCalled()
  })

  it('leaves the button available after a full rejoin fails', async () => {
    manager.peer = null
    vi.spyOn(manager, 'createRoom').mockRejectedValue(new Error('Network unavailable'))
    manager.reconnect()
    await vi.advanceTimersByTimeAsync(0)
    expect(useGameStore.getState().connectionStatus).toBe('disconnected')
  })

  it.each(['leaving', 'lobby', 'host-recovery'])('does not start another recovery while %s', async reason => {
    if (reason === 'leaving') manager.isIntentionalDisconnect = true
    if (reason === 'lobby') manager.roomCode = null
    if (reason === 'host-recovery') manager.hostRecovery = { roomCode: 'ROOM' }
    manager.reconnect()
    network.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(10000)
    expect(peer.reconnect).not.toHaveBeenCalled()
  })

  it('does not interrupt a healthy session when an online event fires', async () => {
    peer.open = true; peer.disconnected = false
    useGameStore.setState({ connectionStatus: 'connected', isConnected: true })
    network.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(10000)
    expect(peer.reconnect).not.toHaveBeenCalled()
    expect(peer.disconnect).not.toHaveBeenCalled()
  })
})
