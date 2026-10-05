import { describe, it, expect } from 'vitest'
import { createBreadcrumbTrail, isPeriodicEvent, MAX_CRUMB_DATA_CHARS } from '../utils/breadcrumbs'

const at = (second: number) => new Date(Date.UTC(2026, 9, 4, 10, 0, second)).toISOString()

/** A trail whose clock moves one second per event. */
const makeTrail = (options: { max?: number; maxStats?: number } = {}) => {
  let second = 0
  return createBreadcrumbTrail({ ...options, now: () => new Date(Date.UTC(2026, 9, 4, 10, 0, second++)) })
}

describe('isPeriodicEvent', () => {
  it('recognizes measurements taken on a timer', () => {
    expect(isPeriodicEvent('audio', 'rnnoise.metrics')).toBe(true)
    expect(isPeriodicEvent('p2p', 'sender-stats')).toBe(true)
    expect(isPeriodicEvent('p2p', 'receiver-stats')).toBe(true)
    expect(isPeriodicEvent('screenshare-native', 'pcm-forward-stats')).toBe(true)
    expect(isPeriodicEvent('screenshare-audio', 'pipeline-stats')).toBe(true)
    expect(isPeriodicEvent('screenshare', 'ramp')).toBe(true)
    expect(isPeriodicEvent('screenshare-native', 'helper-stderr')).toBe(true)
  })

  it('leaves transitions alone', () => {
    expect(isPeriodicEvent('room', 'join-open')).toBe(false)
    expect(isPeriodicEvent('p2p', 'call.dial')).toBe(false)
    expect(isPeriodicEvent('p2p', 'sender-state')).toBe(false)
    expect(isPeriodicEvent('media', 'startMedia.ready')).toBe(false)
    expect(isPeriodicEvent('ui', 'click')).toBe(false)
  })
})

describe('breadcrumb trail', () => {
  it('lists what happened, oldest first, with the time of each', () => {
    const trail = makeTrail()
    trail.add({ cat: 'room', event: 'join-begin', data: { roomCode: 'R1' } })
    trail.add({ cat: 'room', event: 'join-open' })

    expect(trail.list()).toEqual([
      { t: at(0), cat: 'room', event: 'join-begin', data: { roomCode: 'R1' } },
      { t: at(1), cat: 'room', event: 'join-open' },
    ])
  })

  it('uses the time that came with the event', () => {
    const trail = makeTrail()
    trail.add({ t: '2026-01-01T00:00:00.000Z', cat: 'room', event: 'join-open' })
    expect(trail.list()[0].t).toBe('2026-01-01T00:00:00.000Z')
  })

  it('keeps only the most recent ones', () => {
    const trail = makeTrail({ max: 3 })
    for (const event of ['a', 'b', 'c', 'd', 'e']) trail.add({ cat: 'x', event })
    expect(trail.list().map((crumb) => crumb.event)).toEqual(['c', 'd', 'e'])
  })

  it('counts a repeat instead of listing it again, with the latest time and data', () => {
    const trail = makeTrail()
    trail.add({ cat: 'tile', event: 'play-ok', data: { peer: 'A' } })
    trail.add({ cat: 'tile', event: 'play-ok', data: { peer: 'B' } })
    trail.add({ cat: 'tile', event: 'play-ok', data: { peer: 'C' } })

    expect(trail.list()).toEqual([{ t: at(2), cat: 'tile', event: 'play-ok', data: { peer: 'C' }, n: 3 }])
  })

  it('counts repeats that alternate with other events', () => {
    const trail = makeTrail()
    trail.add({ cat: 'tile', event: 'play-ok' })
    trail.add({ cat: 'p2p', event: 'call.remote-track-state' })
    trail.add({ cat: 'tile', event: 'play-ok' })
    trail.add({ cat: 'p2p', event: 'call.remote-track-state' })

    expect(trail.list()).toEqual([
      { t: at(2), cat: 'tile', event: 'play-ok', n: 2 },
      { t: at(3), cat: 'p2p', event: 'call.remote-track-state', n: 2 },
    ])
  })

  it('lists an event again once enough has happened since', () => {
    const trail = makeTrail()
    for (const event of ['a', 'b', 'c', 'd', 'e', 'a']) trail.add({ cat: 'x', event })
    expect(trail.list().map((crumb) => [crumb.event, crumb.n])).toEqual([
      ['a', undefined],
      ['b', undefined],
      ['c', undefined],
      ['d', undefined],
      ['e', undefined],
      ['a', undefined],
    ])
  })

  it('tells events of the same name apart by their key', () => {
    const trail = makeTrail()
    trail.add({ cat: 'log', event: 'info', key: 'P2P|Room created', data: { message: 'Room created' } })
    trail.add({ cat: 'log', event: 'info', key: 'P2P|Joined', data: { message: 'Joined' } })
    trail.add({ cat: 'log', event: 'info', key: 'P2P|Room created', data: { message: 'Room created' } })

    expect(trail.list()).toEqual([
      { t: at(2), cat: 'log', event: 'info', data: { message: 'Room created' }, n: 2 },
      { t: at(1), cat: 'log', event: 'info', data: { message: 'Joined' } },
    ])
  })

  it('keeps periodic measurements out of the trail, only the latest of each', () => {
    const trail = makeTrail()
    trail.add({ cat: 'audio', event: 'rnnoise.metrics', data: { rms: 1 } })
    trail.add({ cat: 'room', event: 'join-open' })
    trail.add({ cat: 'audio', event: 'rnnoise.metrics', data: { rms: 2 } })
    trail.add({ cat: 'p2p', event: 'sender-stats', data: { kbps: 300 } })

    expect(trail.list()).toEqual([{ t: at(1), cat: 'room', event: 'join-open' }])
    expect(trail.stats()).toEqual({
      'audio/rnnoise.metrics': { t: at(2), cat: 'audio', event: 'rnnoise.metrics', data: { rms: 2 }, n: 2 },
      'p2p/sender-stats': { t: at(3), cat: 'p2p', event: 'sender-stats', data: { kbps: 300 } },
    })
  })

  it('bounds how many measurements it keeps, dropping the stalest', () => {
    const trail = makeTrail({ maxStats: 2 })
    trail.add({ cat: 'a', event: 'one-stats' })
    trail.add({ cat: 'a', event: 'two-stats' })
    trail.add({ cat: 'a', event: 'one-stats' })
    trail.add({ cat: 'a', event: 'three-stats' })

    expect(Object.keys(trail.stats()).sort()).toEqual(['a/one-stats', 'a/three-stats'])
  })

  it('cuts data that is too large', () => {
    const trail = makeTrail()
    // Many values that are each within the limits, and too much together.
    const data = Object.fromEntries(Array.from({ length: 16 }, (_v, i) => [`field${i}`, `"quoted" \\ ${'x'.repeat(180)}`]))
    trail.add({ cat: 'p2p', event: 'sender-state', data: { ...data, blob: 'y'.repeat(5000), list: Array.from({ length: 500 }, (_v, i) => `item-${i}`) } })

    const [crumb] = trail.list()
    expect(JSON.stringify(crumb.data).length).toBeLessThanOrEqual(MAX_CRUMB_DATA_CHARS + 40)
    expect(Object.keys(crumb.data!)).toEqual(['cut'])
  })

  it('makes data safe to write as JSON', () => {
    const trail = makeTrail()
    const data: Record<string, unknown> = { when: new Date(0), fn: () => 1 }
    data.self = data
    trail.add({ cat: 'x', event: 'y', data })

    expect(trail.list()[0].data).toEqual({ when: '1970-01-01T00:00:00.000Z', fn: '[Function fn]', self: '[Circular]' })
    expect(() => JSON.stringify(trail.list())).not.toThrow()
  })

  it('wraps data that is not an object', () => {
    const trail = makeTrail()
    trail.add({ cat: 'x', event: 'y', data: 'plain text' })
    expect(trail.list()[0].data).toEqual({ value: 'plain text' })
  })

  it('never throws', () => {
    const trail = makeTrail()
    const hostile = {
      get boom() {
        throw new Error('no')
      },
    }
    expect(() => trail.add({ cat: 'x', event: 'y', data: hostile })).not.toThrow()
    expect(() => trail.add(null as never)).not.toThrow()
    expect(() => trail.add({ cat: 1, event: {} } as never)).not.toThrow()
    expect(trail.list()).toHaveLength(1)
  })

  it('hands out copies', () => {
    const trail = makeTrail()
    trail.add({ cat: 'room', event: 'join-open' })
    const listed = trail.list()
    listed[0].event = 'changed'
    listed.push({ t: at(9), cat: 'x', event: 'y' })

    expect(trail.list()).toEqual([{ t: at(0), cat: 'room', event: 'join-open' }])
  })

  it('forgets everything on clear', () => {
    const trail = makeTrail()
    trail.add({ cat: 'room', event: 'join-open' })
    trail.add({ cat: 'p2p', event: 'sender-stats' })
    trail.clear()

    expect(trail.list()).toEqual([])
    expect(trail.stats()).toEqual({})
  })
})
