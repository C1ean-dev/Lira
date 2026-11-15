import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWhiteboardStore } from '../../store/useWhiteboardStore'
import { useGameStore } from '../../store/useGameStore'
import { sendWhiteboardOperation, requestWhiteboard } from '../../services/whiteboardNetwork'
import { PeerManager } from '../../p2p/PeerManager'
const original = useGameStore.getState()
afterEach(() => { useWhiteboardStore.getState().reset(); useGameStore.setState(original); vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('offline boards per room', () => {
  it('draws without a connection or a peer manager and restores the room after restart', () => {
    const saved = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (k: string) => saved.get(k) || null, setItem: (k: string, v: string) => saved.set(k, v) })
    useGameStore.setState({ roomId: 'my-room', isConnected: false, isHost: false })
    const peer = vi.spyOn(PeerManager, 'getInstance')
    requestWhiteboard()
    expect(sendWhiteboardOperation({ id: 'me:1', actor: 'me', clock: 1, kind: 'stroke', color: '#000000', width: 2, points: [{ x: .1, y: .1 }] })).toBe(true)
    useWhiteboardStore.getState().reset()
    useWhiteboardStore.getState().selectRoom('other-room')
    expect(Object.keys(useWhiteboardStore.getState().document.operations)).toHaveLength(0)
    useWhiteboardStore.getState().selectRoom('my-room')
    expect(Object.keys(useWhiteboardStore.getState().document.operations)).toEqual(['me:1'])
    expect(peer).not.toHaveBeenCalled()
  })
  it('keeps the drawing usable when local storage is full and reports that a file should be saved', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } })
    useGameStore.setState({ roomId: 'my-room', isConnected: false })
    requestWhiteboard()
    expect(sendWhiteboardOperation({ id: 'me:1', actor: 'me', clock: 1, kind: 'stroke', color: '#000000', width: 2, points: [{ x: .1, y: .1 }] })).toBe(true)
    expect(useWhiteboardStore.getState().storageError).toBe(true)
    expect(Object.keys(useWhiteboardStore.getState().document.operations)).toEqual(['me:1'])
  })
  it('ignores corrupted saved data without preventing the board from opening offline', () => {
    vi.stubGlobal('localStorage', { getItem: () => '{invalid', setItem: vi.fn() })
    useGameStore.setState({ roomId: 'my-room', isConnected: false })
    requestWhiteboard()
    expect(useWhiteboardStore.getState().synchronized).toBe(true)
    expect(useWhiteboardStore.getState().document.operations).toEqual({})
  })
})
