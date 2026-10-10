import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isWatchable, noteFirstFrame, useLiveWatchStore } from '../store/useLiveWatchStore'
import { useGameStore } from '../store/useGameStore'
import { flushDiagLogs, __resetDiagForTests } from '../utils/diagnosticLogger'

const player = (id: string, extra: Record<string, unknown> = {}): any => ({
  id,
  name: id,
  x: 0,
  y: 0,
  direction: 'down',
  isMoving: false,
  avatar: { baseId: 'char-1', shirtColor: '#e03131' },
  status: 'available',
  lastUpdated: 0,
  currentZoneId: 'zone-1',
  ...extra,
})

const room = (...players: any[]) => {
  useGameStore.setState({
    localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: 'zone-1' },
    remotePlayers: Object.fromEntries(players.map((p) => [p.id, p])),
  })
}

const live = (id: string, extra: Record<string, unknown> = {}) =>
  player(id, { isScreenSharing: true, liveOptIn: true, ...extra })

const watched = () => Object.keys(useLiveWatchStore.getState().watching).sort()

const captureDiag = (event = 'watch') => {
  const entries: any[] = []
  ;(globalThis as any).window = {
    electronAPI: {
      diagnosticLogBatch: vi.fn(async (batch: any[]) => {
        entries.push(...batch)
        return { ok: true, path: null }
      }),
    },
  }
  return async () => {
    await flushDiagLogs()
    return entries.filter((e) => e.cat === 'screenshare' && e.event === event).map((e) => e.data)
  }
}

describe('the lives this user is watching', () => {
  beforeEach(() => {
    __resetDiagForTests()
    useLiveWatchStore.setState({ watching: {} })
    room()
  })
  afterEach(() => {
    __resetDiagForTests()
    useLiveWatchStore.setState({ watching: {} })
    useGameStore.setState({
      remotePlayers: {},
      localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: null },
    })
    ;(globalThis as any).window = undefined
  })

  it('start empty: nobody is watched before a click', () => {
    room(live('ana'))
    expect(watched()).toEqual([])
  })

  it('has a live after the click, and no longer after stopping', () => {
    room(live('ana'), live('bia'))
    useLiveWatchStore.getState().watch('ana')
    expect(watched()).toEqual(['ana'])

    useLiveWatchStore.getState().watch('bia')
    expect(watched()).toEqual(['ana', 'bia'])

    useLiveWatchStore.getState().stop('ana')
    expect(watched()).toEqual(['bia'])
  })

  it('keeps the time of the click', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_700_000_000_000)
      room(live('ana'))
      useLiveWatchStore.getState().watch('ana')
      expect(useLiveWatchStore.getState().watching.ana).toBe(1_700_000_000_000)

      // A second click does not start the count again.
      vi.setSystemTime(1_700_000_005_000)
      useLiveWatchStore.getState().watch('ana')
      expect(useLiveWatchStore.getState().watching.ana).toBe(1_700_000_000_000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not change the state for a click that changes nothing', () => {
    room(live('ana'))
    useLiveWatchStore.getState().watch('ana')
    const before = useLiveWatchStore.getState().watching
    useLiveWatchStore.getState().watch('ana')
    useLiveWatchStore.getState().stop('nobody')
    expect(useLiveWatchStore.getState().watching).toBe(before)
  })

  it('ignores a click on somebody who is not live, not in the call, or not there', () => {
    room(player('ana'), live('bia', { currentZoneId: 'zone-2' }))
    for (const id of ['ana', 'bia', 'ghost', '']) useLiveWatchStore.getState().watch(id)
    expect(watched()).toEqual([])
  })

  it('ignores a click while this user is in no call', () => {
    room(live('ana', { currentZoneId: null }))
    useGameStore.setState({ localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: null } })
    useLiveWatchStore.getState().watch('ana')
    expect(watched()).toEqual([])
  })

  describe('stops on its own', () => {
    beforeEach(() => {
      room(live('ana'), live('bia'))
      useLiveWatchStore.getState().watch('ana')
      useLiveWatchStore.getState().watch('bia')
    })

    it('when the live ends: the next one needs a new click', () => {
      useGameStore.getState().setRemotePlayer(live('ana', { isScreenSharing: false }))
      expect(watched()).toEqual(['bia'])

      useGameStore.getState().setRemotePlayer(live('ana'))
      expect(watched()).toEqual(['bia'])
    })

    it('when who is live leaves the call', () => {
      useGameStore.getState().setRemotePlayer(live('ana', { currentZoneId: null }))
      expect(watched()).toEqual(['bia'])
    })

    it('when who is live leaves the room', () => {
      useGameStore.getState().removeRemotePlayer('bia')
      expect(watched()).toEqual(['ana'])
    })

    it('when this user leaves the call', () => {
      useGameStore.setState({ localPlayer: { ...useGameStore.getState().localPlayer, currentZoneId: 'zone-9' } })
      expect(watched()).toEqual([])
    })

    it('when this user leaves the room', () => {
      useGameStore.setState({ remotePlayers: {} })
      expect(watched()).toEqual([])
    })

    it('but not when somebody only moves or changes status', () => {
      const before = useLiveWatchStore.getState().watching
      useGameStore.getState().setRemotePlayer(live('ana', { x: 10, y: 4, isMuted: true }))
      useGameStore.getState().updateRemotePlayerPosition('bia', 3, 3, 'left', true)
      expect(useLiveWatchStore.getState().watching).toBe(before)
    })
  })

  it('records the click, the stop and what ended a live on its own', async () => {
    const log = captureDiag()
    room(live('ana'), live('bia'))
    useLiveWatchStore.getState().watch('ana')
    useLiveWatchStore.getState().watch('bia')
    useLiveWatchStore.getState().stop('ana')
    useGameStore.getState().setRemotePlayer(live('bia', { isScreenSharing: false }))

    expect(await log()).toEqual([
      { sharer: 'ana', on: true },
      { sharer: 'bia', on: true },
      { sharer: 'ana', on: false, why: 'click' },
      { sharer: 'bia', on: false, why: 'ended' },
    ])
  })

  describe('the first frame after a click', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('is recorded with the time it took, once per click however many places show the live', async () => {
      const log = captureDiag('watch-first-frame')
      vi.setSystemTime(1_700_000_000_000)
      room(live('ana'))
      useLiveWatchStore.getState().watch('ana')

      vi.setSystemTime(1_700_000_001_840)
      noteFirstFrame('ana')
      vi.setSystemTime(1_700_000_002_000)
      noteFirstFrame('ana')
      expect(await log()).toEqual([{ sharer: 'ana', ms: 1840 }])

      // A new click is a new wait.
      useLiveWatchStore.getState().stop('ana')
      vi.setSystemTime(1_700_000_010_000)
      useLiveWatchStore.getState().watch('ana')
      vi.setSystemTime(1_700_000_010_900)
      noteFirstFrame('ana')
      expect(await log()).toEqual([
        { sharer: 'ana', ms: 1840 },
        { sharer: 'ana', ms: 900 },
      ])
    })

    it('is nothing for a live that is not being watched', async () => {
      const log = captureDiag('watch-first-frame')
      room(live('ana'))
      noteFirstFrame('ana')
      noteFirstFrame('ghost')
      expect(await log()).toEqual([])
    })
  })

  describe('isWatchable', () => {
    it('is a live that is running in the call this user is in', () => {
      expect(isWatchable(live('ana'), 'zone-1')).toBe(true)
      expect(isWatchable(live('ana', { liveOptIn: undefined }), 'zone-1')).toBe(true)
    })

    it('is not a live elsewhere, a live that ended, or nobody', () => {
      expect(isWatchable(live('ana'), 'zone-2')).toBe(false)
      expect(isWatchable(live('ana'), null)).toBe(false)
      expect(isWatchable(live('ana', { currentZoneId: null }), null)).toBe(false)
      expect(isWatchable(live('ana', { currentZoneId: undefined }), undefined)).toBe(false)
      expect(isWatchable(player('ana'), 'zone-1')).toBe(false)
      expect(isWatchable(undefined, 'zone-1')).toBe(false)
    })
  })
})
