import { describe, it, expect, beforeEach, vi } from 'vitest'
import { appTrail } from '../utils/breadcrumbs'
import { useGameStore } from '../store/useGameStore'
import { useMediaStore } from '../store/useMediaStore'

/**
 * The transitions of the stores that matter to read an error: they enter the
 * trail (and logs/call-debug-<day>.log) wherever the change came from.
 */

const trail = () => appTrail.list().map((crumb) => [`${crumb.cat}/${crumb.event}`, crumb.data])
const player = (id: string) => ({ id, name: id, x: 0, y: 0, direction: 'down', isMoving: false }) as never

describe('room transitions', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    useGameStore.setState({ roomId: null, isHost: false, connectionStatus: 'disconnected', remotePlayers: {} })
    appTrail.clear()
  })

  it('notes entering and leaving a room', () => {
    useGameStore.setState({ roomId: 'ROOM-1', isHost: true })
    useGameStore.setState({ roomId: null, isHost: false })

    expect(trail()).toEqual([
      ['room/entered', { roomId: 'ROOM-1', host: true }],
      ['room/left', { roomId: 'ROOM-1' }],
    ])
  })

  it('notes the connection to the room changing', () => {
    useGameStore.getState().setConnectionStatus('reconnecting')
    useGameStore.getState().setConnectionStatus('connected')

    expect(trail()).toEqual([
      ['room/connection', { status: 'reconnecting' }],
      ['room/connection', { status: 'connected' }],
    ])
  })

  it('notes this player becoming the host of a room it is already in', () => {
    useGameStore.setState({ roomId: 'ROOM-1', isHost: false })
    appTrail.clear()
    useGameStore.setState({ isHost: true })

    expect(trail()).toEqual([['room/role', { host: true }]])
  })

  it('notes players arriving and leaving', () => {
    useGameStore.setState({ remotePlayers: { a: player('a') } })
    useGameStore.setState({ remotePlayers: { a: player('a'), b: player('b') } })
    appTrail.clear()
    useGameStore.setState({ remotePlayers: { b: player('b') } })

    expect(trail()).toEqual([['room/players', { count: 1, change: -1 }]])
  })

  it('stays quiet when nothing of that changed', () => {
    useGameStore.setState({ remotePlayers: { a: player('a') } })
    appTrail.clear()
    useGameStore.getState().setLocalPosition(10, 20, 'up', true)
    useGameStore.getState().updateRemotePlayerPosition('a', 5, 5, 'left', true)

    expect(trail()).toEqual([])
  })
})

describe('audio and video setup changes', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    appTrail.clear()
  })

  it('notes a setting that changes how audio or video is captured and sent', () => {
    const before = useMediaStore.getState()
    useMediaStore.setState({ echoCancellation: !before.echoCancellation })
    useMediaStore.setState({ selectedAudioInput: '8c1f4b7a9d3e5f60718293a4b5c6d7e8f9012345' })

    expect(trail()).toEqual([
      ['settings/echoCancellation', { value: !before.echoCancellation }],
      ['settings/selectedAudioInput', { value: '8c1f4b…2345' }],
    ])
  })

  it('notes the call grid and the settings window opening and closing', () => {
    useMediaStore.setState({ isGridCallOpen: false, isSettingsModalOpen: false })
    appTrail.clear()
    useMediaStore.setState({ isGridCallOpen: true })
    useMediaStore.setState({ isSettingsModalOpen: true })
    useMediaStore.setState({ isGridCallOpen: false })

    expect(trail()).toEqual([
      ['ui/grid-call', { open: true }],
      ['ui/settings', { open: true }],
      ['ui/grid-call', { open: false }],
    ])
  })

  it('stays quiet for what changes all the time', () => {
    useMediaStore.setState({ localAudioLevel: 0.42, isGateOpen: true } as never)
    useMediaStore.setState({ inputVolume: 80 })
    expect(trail()).toEqual([])
  })
})
