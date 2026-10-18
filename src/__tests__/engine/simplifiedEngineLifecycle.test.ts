import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasEngine } from '../../engine/CanvasEngine'
import { useGameStore } from '../../store/useGameStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { PeerManager } from '../../p2p/PeerManager'

vi.mock('../../engine/rendering/worldRenderer', () => ({ WorldRenderer: { render: vi.fn() } }))

const originalGame = useGameStore.getState()
const originalSettings = useSettingsStore.getState()
let engine: CanvasEngine
let events: EventTarget
let frames: Map<number, FrameRequestCallback>
let nextFrameId: number
let update: ReturnType<typeof vi.spyOn>
let render: ReturnType<typeof vi.spyOn>
let sendMovement: ReturnType<typeof vi.fn>

function runFrame() {
  const [id, callback] = frames.entries().next().value!
  frames.delete(id)
  vi.advanceTimersByTime(20)
  callback(performance.now())
}

beforeEach(() => {
  vi.useFakeTimers()
  events = new EventTarget()
  frames = new Map()
  nextFrameId = 0
  vi.stubGlobal('window', events)
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrameId, callback)
    return nextFrameId
  }))
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)))
  useGameStore.setState({ mapViewMode: 'immersive', localPlayer: { ...originalGame.localPlayer, isMoving: false } })
  useSettingsStore.setState({ targetFps: 0 })
  sendMovement = vi.fn()
  vi.spyOn(PeerManager, 'getInstance').mockReturnValue({ sendMovement } as unknown as PeerManager)
  engine = new CanvasEngine({ getContext: () => ({ imageSmoothingEnabled: false }) } as unknown as HTMLCanvasElement)
  update = vi.spyOn(engine as any, 'update').mockImplementation(() => {})
  render = vi.spyOn(engine as any, 'render').mockImplementation(() => {})
})

afterEach(() => {
  engine.dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  useGameStore.setState(originalGame)
  useSettingsStore.setState(originalSettings)
})

describe('simplified mode engine lifecycle', () => {
  it('starts in simplified mode without drawing or scheduling animation frames', () => {
    useGameStore.setState({ mapViewMode: 'simplified' })
    engine.start()
    vi.advanceTimersByTime(5000)
    expect(update).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels the pending frame immediately when switching to simplified mode', () => {
    engine.start()
    runFrame()
    const before = render.mock.calls.length
    useGameStore.setState({ mapViewMode: 'simplified' })
    expect(frames.size).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(render).toHaveBeenCalledTimes(before)
    expect(update).toHaveBeenCalledTimes(before)
  })

  it('resumes once with a fresh clock after a long pause and ignores unrelated updates', () => {
    engine.start()
    useGameStore.setState({ mapViewMode: 'simplified' })
    vi.advanceTimersByTime(60_000)
    update.mockClear()
    render.mockClear()
    useGameStore.setState({ mapViewMode: 'immersive' })
    expect(frames.size).toBe(1)
    runFrame()
    expect(update).toHaveBeenCalled()
    expect(update.mock.calls.every(([delta]) => delta >= 0 && delta <= 0.021)).toBe(true)
    expect(render).toHaveBeenCalled()
    const count = render.mock.calls.length
    useGameStore.setState({ isConnected: true })
    engine.start()
    expect(render).toHaveBeenCalledTimes(count)
    expect(frames.size).toBe(1)
  })

  it('clears old movement and broadcasts a stop before pausing', () => {
    engine.start()
    engine.input.setPath([{ x: 10, y: 10 }])
    engine.input.keysPressed.add('d')
    engine.isShiftPressed = true
    useGameStore.getState().setLocalPlayer({ isMoving: true })
    const local = useGameStore.getState().localPlayer
    useGameStore.setState({ mapViewMode: 'simplified' })
    expect(engine.input.path).toEqual([])
    expect(engine.input.keysPressed.size).toBe(0)
    expect(engine.isShiftPressed).toBe(false)
    expect(useGameStore.getState().localPlayer.isMoving).toBe(false)
    expect(sendMovement).toHaveBeenCalledWith(local.x, local.y, local.direction, false)
  })

  it('detaches keyboard inputs while simplified and restores them on return', () => {
    const key = (name: string) => Object.assign(new Event('keydown'), { key: name })
    engine.start()
    useGameStore.setState({ mapViewMode: 'simplified' })
    events.dispatchEvent(key('d'))
    events.dispatchEvent(key('Shift'))
    expect(engine.input.keysPressed.size).toBe(0)
    expect(engine.isShiftPressed).toBe(false)
    useGameStore.setState({ mapViewMode: 'immersive' })
    events.dispatchEvent(key('d'))
    events.dispatchEvent(key('Shift'))
    expect(engine.input.keysPressed.has('d')).toBe(true)
    expect(engine.isShiftPressed).toBe(true)
  })

  it.each(['stop', 'dispose'] as const)('does not restart after %s and removes every input listener', (method) => {
    engine.start()
    useGameStore.setState({ mapViewMode: 'simplified' })
    engine[method]()
    useGameStore.setState({ mapViewMode: 'immersive' })
    events.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Shift' }))
    expect(frames.size).toBe(0)
    expect(engine.isShiftPressed).toBe(false)
  })
})
