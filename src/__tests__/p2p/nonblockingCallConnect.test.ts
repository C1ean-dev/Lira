import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerManager } from '../../p2p/PeerManager'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { CanvasEngine } from '../../engine/CanvasEngine'
import { WorldRenderer } from '../../engine/rendering/worldRenderer'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useGameStore } from '../../store/useGameStore'
vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))
vi.mock('peerjs', () => ({ default: class {} }))
vi.mock('../../engine/physics/collision', () => ({ checkCollision: () => false, checkZonePresence: () => {} }))

const original = useGameStore.getState()
let pm: any
let dial: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.useFakeTimers()
  pm = new (PeerManager as any)()
  pm.peer = { id: 'local', destroyed: false }
  pm.roomCode = 'ROOM'
  const local = { ...original.localPlayer, id: 'local', currentZoneId: 'zone' }
  useGameStore.setState({
    localPlayer: local,
    remotePlayers: Object.fromEntries(['a', 'b', 'c'].map((id) => [id, { ...local, id, name: id }])),
    callStates: {},
  })
  dial = vi.spyOn(MediaCallHandler, 'checkZoneCallEligibility').mockImplementation(() => {})
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useGameStore.setState(original)
})

describe('non-blocking zone call negotiation', () => {
  it('returns to the map and sends movement before starting negotiation', () => {
    const remote = useGameStore.getState().remotePlayers.a
    const send = vi.fn()
    pm.connections.set('a', { open: true, send })
    pm.checkZoneCallEligibility(remote)
    expect(dial).not.toHaveBeenCalled()
    pm.sendMovement(10, 11, 'right', true)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'PLAYER_MOVE' }))
    vi.advanceTimersByTime(16)
    expect(dial).toHaveBeenCalledTimes(1)
  })
  it('starts at most one negotiation per task without waiting for another call to connect', () => {
    dial.mockImplementation((remote: any) => useGameStore.getState().setCallState(remote.id, 'connecting'))
    pm.recheckZoneCalls()
    expect(dial).not.toHaveBeenCalled()
    for (const count of [1, 2, 3]) {
      vi.advanceTimersByTime(16)
      expect(dial).toHaveBeenCalledTimes(count)
    }
    expect(Object.values(useGameStore.getState().callStates)).toEqual(['connecting', 'connecting', 'connecting'])
  })
  it('coalesces repeated checks and reads the latest participant details', () => {
    const state = useGameStore.getState()
    pm.checkZoneCallEligibility(state.remotePlayers.a)
    pm.checkZoneCallEligibility(state.remotePlayers.a)
    useGameStore.setState({ remotePlayers: { ...state.remotePlayers, a: { ...state.remotePlayers.a, currentZoneId: 'elsewhere' } } })
    vi.advanceTimersByTime(32)
    expect(dial).toHaveBeenCalledTimes(1)
    expect(dial.mock.calls[0][0].currentZoneId).toBe('elsewhere')
  })
  it.each(['left', 'session', 'stop'])('cancels outdated work when %s changes', (reason) => {
    pm.checkZoneCallEligibility(useGameStore.getState().remotePlayers.a)
    if (reason === 'left') useGameStore.getState().removeRemotePlayer('a')
    if (reason === 'session') pm.peer = { id: 'new-session' }
    if (reason === 'stop') pm.endAllZoneMediaCalls()
    vi.advanceTimersByTime(32)
    expect(dial).not.toHaveBeenCalled()
  })
})

describe('call teardown avoids recursive close work', () => {
  it.each(['single', 'all'])('detaches calls before closing them (%s)', (mode) => {
    const calls = new Map<string, any>()
    const call = { close: vi.fn(() => {
      if (calls.has('a') && call.close.mock.calls.length < 10) MediaCallHandler.endMediaCall(calls, 'a')
    }) }
    calls.set('a', call)
    if (mode === 'single') MediaCallHandler.endMediaCall(calls, 'a')
    else MediaCallHandler.endAllMediaCalls(calls)
    expect(call.close).toHaveBeenCalledTimes(1)
    expect(calls.size).toBe(0)
  })
})
describe('map animation during a pending connection', () => {
  it('keeps rendering and moving the local player while a remote remains connecting', () => {
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.push(fn); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const render = vi.spyOn(WorldRenderer, 'render').mockImplementation(() => {})
    vi.spyOn(PeerManager, 'getInstance').mockReturnValue(pm)
    const settings = useSettingsStore.getState()
    useSettingsStore.setState({ targetFps: 0 })
    dial.mockImplementation((remote: any) => useGameStore.getState().setCallState(remote.id, 'connecting'))
    pm.checkZoneCallEligibility(useGameStore.getState().remotePlayers.a)
    vi.advanceTimersByTime(16)
    const canvas = { getContext: () => ({ imageSmoothingEnabled: false }) } as unknown as HTMLCanvasElement
    const engine = new CanvasEngine(canvas)
    engine.input.simulateKey('d', true)
    const before = useGameStore.getState().localPlayer.x
    try {
      engine.start()
      for (let index = 1; index <= 5; index++) frames.shift()!(performance.now() + index * 20)
      expect(useGameStore.getState().callStates.a).toBe('connecting')
      expect(useGameStore.getState().localPlayer.x).toBeGreaterThan(before)
      expect(render).toHaveBeenCalledTimes(6)
    } finally {
      engine.dispose()
      useSettingsStore.setState(settings)
    }
  })
})