import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimplifiedMapView } from '../../components/SimplifiedMapView'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { PeerManager } from '../../p2p/PeerManager'
import { PrivateZone } from '../../types/map'

const captured = vi.hoisted(() => ({ elements: [] as React.ReactElement[] }))
vi.mock('react/jsx-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react/jsx-runtime')>()
  return Object.fromEntries(Object.entries(actual).map(([key, value]) => [key,
    key === 'jsx' || key === 'jsxs' ? (...args: any[]) => {
      const element = (value as Function)(...args)
      captured.elements.push(element)
      return element
    } : value,
  ]))
})
vi.mock('react/jsx-dev-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react/jsx-dev-runtime')>()
  return { ...actual, jsxDEV: (...args: any[]) => {
    const element = (actual.jsxDEV as Function)(...args)
    captured.elements.push(element)
    return element
  } }
})

const originalGame = useGameStore.getState()
const originalMap = useMapStore.getState()
const room: PrivateZone = { id: 'room', name: 'Meeting Room', x: 10, y: 10, width: 8, height: 8, color: '#00ff00' }
let subscriptions: Array<{ get: () => unknown; notify: ReturnType<typeof vi.fn>; unsubscribe: () => void }>
let sendPlayerUpdate: ReturnType<typeof vi.fn>
let sendRoomKnockRequest: ReturnType<typeof vi.fn>

function mount() {
  return renderToStaticMarkup(<SimplifiedMapView />)
}

beforeEach(() => {
  vi.useFakeTimers()
  subscriptions = []
  captured.elements = []
  useGameStore.setState({
    localPlayer: { ...originalGame.localPlayer, name: 'Alice', currentZoneId: null, x: 2, y: 2, isOwner: false, role: 'member' },
    remotePlayers: { peer: { ...originalGame.localPlayer, id: 'peer', name: 'Bob', currentZoneId: null } },
  })
  useMapStore.setState({ mapData: { ...originalMap.mapData, width: 40, height: 30, zones: [room] } })
  sendPlayerUpdate = vi.fn()
  sendRoomKnockRequest = vi.fn()
  vi.spyOn(PeerManager, 'getInstance').mockReturnValue({ sendPlayerUpdate, sendRoomKnockRequest, sendRoomLockToggle: vi.fn(), endAllZoneMediaCalls: vi.fn() } as unknown as PeerManager)
  vi.spyOn(React, 'useSyncExternalStore').mockImplementation((subscribe, getSnapshot) => {
    const notify = vi.fn()
    const unsubscribe = subscribe(notify)
    subscriptions.push({ get: getSnapshot, notify, unsubscribe })
    return getSnapshot()
  })
})

afterEach(() => {
  subscriptions.forEach(({ unsubscribe }) => unsubscribe())
  vi.restoreAllMocks()
  vi.useRealTimers()
  useGameStore.setState(originalGame)
  useMapStore.setState(originalMap)
})

describe('simplified map low consumption', () => {
  it('coalesces movement and room changes into one display update per second', () => {
    mount()
    const before = subscriptions.map(({ get }) => get())
    for (let i = 0; i < 60; i++) {
      useGameStore.getState().updateRemotePlayerPosition('peer', i, i, 'right', true)
    }
    useMapStore.setState({ mapData: { ...useMapStore.getState().mapData, zones: [{ ...room, name: 'Renamed Room' }] } })
    vi.advanceTimersByTime(999)
    expect(subscriptions.every(({ get, notify }, i) => Object.is(get(), before[i]) && notify.mock.calls.length === 0)).toBe(true)
    vi.advanceTimersByTime(1)
    expect(subscriptions.some(({ get }, i) => !Object.is(get(), before[i]))).toBe(true)
    expect(subscriptions.reduce((count, { notify }) => count + notify.mock.calls.length, 0)).toBe(1)
    expect(mount()).toContain('Renamed Room')
  })

  it('does not notify during idle seconds or changes unrelated to the displayed map', () => {
    mount()
    useGameStore.setState({ isConnected: true })
    useMapStore.setState({ isEditorOpen: !originalMap.isEditorOpen })
    vi.advanceTimersByTime(5000)
    expect(subscriptions.every(({ notify }) => notify.mock.calls.length === 0)).toBe(true)
  })

  it('shares one timer and removes it when the last view unmounts', () => {
    mount()
    mount()
    expect(vi.getTimerCount()).toBe(1)
    subscriptions.slice(0, -1).forEach(({ unsubscribe }) => unsubscribe())
    expect(vi.getTimerCount()).toBe(1)
    subscriptions.at(-1)!.unsubscribe()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reads current data immediately when mounting again', () => {
    mount()
    subscriptions.forEach(({ unsubscribe }) => unsubscribe())
    useGameStore.getState().setLocalPlayer({ name: 'Fresh Name' })
    expect(mount()).toContain('Fresh Name')
  })

  it('has no continuous animation, backdrop blur or fixed FPS claim', () => {
    useGameStore.getState().setLocalPlayer({ currentZoneId: room.id })
    const markup = mount()
    expect(markup).not.toContain('animate-')
    expect(markup).not.toContain('backdrop-blur')
    expect(markup).not.toContain('60 FPS')
  })

  it('checks the current lock instead of the room shown in the last sampled frame', () => {
    mount()
    const displayedRoom = captured.elements.find(({ props }) => props.title === `${room.name} - Clique para entrar`)!
    useMapStore.setState({ mapData: { ...useMapStore.getState().mapData, zones: [{ ...room, isLocked: true }] } })
    const isAuthorized = vi.spyOn(useMapStore.getState(), 'isPeerAuthorizedForZone').mockReturnValue(false)
    displayedRoom.props.onClick({ stopPropagation() {} })
    expect(isAuthorized).toHaveBeenCalled()
    expect(useGameStore.getState().localPlayer.currentZoneId).toBeNull()
    expect(sendRoomKnockRequest).toHaveBeenCalled()
  })

  it('ignores a room removed since the last sampled frame', () => {
    mount()
    const displayedRoom = captured.elements.find(({ props }) => props.title === `${room.name} - Clique para entrar`)!
    useMapStore.setState({ mapData: { ...useMapStore.getState().mapData, zones: [] } })
    displayedRoom.props.onClick({ stopPropagation() {} })
    expect(sendPlayerUpdate).not.toHaveBeenCalled()
    expect(useGameStore.getState().localPlayer.currentZoneId).toBeNull()
  })
})
