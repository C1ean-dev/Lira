import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAvatarInactivity } from '../../hooks/useAvatarInactivity'

const mocks = vi.hoisted(() => ({
  effect: vi.fn(), send: vi.fn(), unsubscribe: vi.fn(),
  assets: [] as any[],
  player: { activityAnimationManual: false, avatar: { otherType: 'none' }, isMoving: false, activityAnimation: 'none', activityAnimationStartedAt: 0 },
}))
vi.mock('react', () => ({ useEffect: mocks.effect }))
vi.mock('../../store/useGameStore', () => ({ useGameStore: {
  getState: () => ({ localPlayer: mocks.player, setLocalPlayer: (change: object) => Object.assign(mocks.player, change) }),
  subscribe: () => mocks.unsubscribe,
} }))
vi.mock('../../store/useCustomAssetsStore', () => ({ useCustomAssetsStore: { getState: () => ({ customAssets: mocks.assets }) } }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: () => ({ sendPlayerUpdate: mocks.send }) } }))

describe('inactivity events and synchronization', () => {
  let cleanup: () => void
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    vi.stubGlobal('window', new EventTarget())
    mocks.player.activityAnimationManual = false
    mocks.player.isMoving = false
    mocks.assets = [{ id: 'avatar_other_sliced_1788355059618_ozg3', activityAnimations: { sleep: ['sleep'] } }]
    mocks.player.activityAnimation = 'none'
    mocks.player.activityAnimationStartedAt = 0
    mocks.send.mockClear()
    useAvatarInactivity()
    cleanup = mocks.effect.mock.lastCall![0]()
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it('broadcasts yawns, sleeping and immediate wake-up for interactions anywhere in the app', () => {
    vi.advanceTimersByTime(60_000)
    expect(mocks.player.activityAnimation).toBe('yawn')
    expect(mocks.send).toHaveBeenLastCalledWith({ activityAnimation: 'yawn', activityAnimationStartedAt: 61_000 })
    vi.advanceTimersByTime(240_000)
    expect(mocks.player.activityAnimation).toBe('sleep')
    window.dispatchEvent(new Event('pointerdown'))
    expect(mocks.player.activityAnimation).toBe('none')
    expect(mocks.send).toHaveBeenLastCalledWith({ activityAnimation: 'none', activityAnimationStartedAt: 0 })
    vi.advanceTimersByTime(59_750)
    expect(mocks.player.activityAnimation).toBe('none')
    vi.advanceTimersByTime(250)
    expect(mocks.player.activityAnimation).toBe('yawn')
  })

  it('keeps a manual animation through UI interactions and clears it when walking', () => {
    Object.assign(mocks.player, { activityAnimation: 'sleep', activityAnimationStartedAt: 1000, activityAnimationManual: true })
    for (const event of ['pointermove', 'pointerdown', 'wheel', 'keydown']) window.dispatchEvent(new Event(event))
    vi.advanceTimersByTime(1000)
    expect(mocks.player.activityAnimation).toBe('sleep')
    expect(mocks.player.activityAnimationStartedAt).toBe(1000)
    mocks.player.isMoving = true
    vi.advanceTimersByTime(250)
    expect(mocks.player.activityAnimation).toBe('none')
    expect(mocks.player.activityAnimationManual).toBe(false)
    expect(mocks.send).toHaveBeenLastCalledWith({ activityAnimation: 'none', activityAnimationStartedAt: 0 })
  })

  it('stops a manual activity if the selected character loses its sequence', () => {
    Object.assign(mocks.player, { activityAnimation: 'sleep', activityAnimationStartedAt: 1000, activityAnimationManual: true })
    mocks.assets = []
    vi.advanceTimersByTime(250)
    expect(mocks.player.activityAnimation).toBe('none')
    expect(mocks.player.activityAnimationManual).toBe(false)
  })

  it('resets on keyboard, pointer movement, input and scrolling and removes timers on leaving', () => {
    for (const event of ['keydown', 'pointermove', 'input', 'wheel']) {
      vi.advanceTimersByTime(59_000)
      window.dispatchEvent(new Event(event))
      vi.advanceTimersByTime(2000)
      expect(mocks.player.activityAnimation).toBe('none')
    }
    cleanup()
    expect(vi.getTimerCount()).toBe(0)
    expect(mocks.unsubscribe).toHaveBeenCalled()
  })
})
