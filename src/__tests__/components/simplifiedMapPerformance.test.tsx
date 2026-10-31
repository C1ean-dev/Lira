import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SimplifiedMapView } from '../../components/SimplifiedMapView'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { PeerManager } from '../../p2p/PeerManager'
import { PrivateZone } from '../../types/map'
import { checkCollision, isPlayerInZone } from '../../engine/physics/collision'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import type { CustomAsset } from '../../types/customAsset'

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
const originalAssets = useCustomAssetsStore.getState()
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
  useMapStore.setState({ mapData: { ...originalMap.mapData, width: 40, height: 30, zones: [room], furniture: [], walls: [] } })
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
  useCustomAssetsStore.setState(originalAssets)
})

describe('simplified map low consumption', () => {
  function furnish(width = 4, height = 4, x = 12, y = 12) {
    const asset: CustomAsset = { id: 'blocked-center', name: 'Block', type: 'furniture', category: 'Geral', width, height, isObstacle: true, frames: [], createdAt: 1 }
    useCustomAssetsStore.setState({ customAssets: [asset] })
    useMapStore.setState({ mapData: { ...useMapStore.getState().mapData, furniture: [{ id: 'f', defId: asset.id, x, y }] } })
  }

  it('teleports beside furniture and broadcasts the actual free position inside the room', () => {
    furnish()
    mount()
    captured.elements.find(({ props }) => props.title === `${room.name} - Clique para entrar`)!.props.onClick({ stopPropagation() {} })
    const player = useGameStore.getState().localPlayer
    const map = useMapStore.getState().mapData
    expect(checkCollision(player.x, player.y, map)).toBe(false)
    expect(isPlayerInZone(player.x, player.y, room, map)).toBe(true)
    expect(sendPlayerUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ x: player.x, y: player.y, currentZoneId: room.id, isMoving: false, seatedOn: null }))
  })

  it('cancels a teleport when no free position exists in the room', () => {
    furnish(8, 8, 10, 10)
    mount()
    captured.elements.find(({ props }) => props.title === `${room.name} - Clique para entrar`)!.props.onClick({ stopPropagation() {} })
    expect(useGameStore.getState().localPlayer).toMatchObject({ x: 2, y: 2, currentZoneId: null })
    expect(sendPlayerUpdate).not.toHaveBeenCalled()
  })

  it('checks hitboxes and map bounds when clicking the corridor', () => {
    furnish(4, 4, 2, 2)
    mount()
    const floor = captured.elements.find(({ props }) => props.className === 'relative rounded-3xl bg-[#0e2a2e]/60 border border-[#194c52]/70 overflow-hidden')!
    for (const [clientX, clientY] of [[3, 3], [40, 30]]) {
      floor.props.onClick({ clientX, clientY, currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 40, height: 30 }) } })
      const player = useGameStore.getState().localPlayer
      expect(checkCollision(player.x, player.y, useMapStore.getState().mapData)).toBe(false)
      expect(player.currentZoneId).toBeNull()
      expect(sendPlayerUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ x: player.x, y: player.y, currentZoneId: null }))
    }
  })

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
