import { describe, it, expect } from 'vitest'
import { MAX_REPORTS_PER_MINUTE, REPEAT_WINDOW_MS, createErrorReporter } from '../utils/errorReporter'
import type { Breadcrumb } from '../utils/breadcrumbs'

const START = Date.UTC(2026, 9, 4, 10, 0, 0)

const errorAt = (message: string, fn = 'run') => {
  const error = new Error(message)
  error.stack = `Error: ${message}\n    at ${fn} (http://localhost:5173/src/a.ts:1:2)`
  return error
}

const setup = (overrides: Partial<Parameters<typeof createErrorReporter>[0]> = {}) => {
  const clock = { ms: START }
  const state = {
    context: { room: { inRoom: true } } as Record<string, unknown>,
    crumbs: [{ t: new Date(START).toISOString(), cat: 'room', event: 'join-open' }] as Breadcrumb[],
    stats: {} as Record<string, Breadcrumb>,
  }
  const reporter = createErrorReporter({
    source: 'renderer',
    session: 's1',
    now: () => new Date(clock.ms),
    random: () => 0,
    context: () => state.context,
    breadcrumbs: () => state.crumbs,
    stats: () => state.stats,
    ...overrides,
  })
  return { reporter, clock, state }
}

describe('error reporter', () => {
  it('reports the first occurrence with the context and the trail of that moment', () => {
    const { reporter } = setup()
    const { report, fingerprint } = reporter.capture({ kind: 'uncaught', scope: 'P2P', error: errorAt('boom') })

    expect(report).toMatchObject({
      kind: 'uncaught',
      severity: 'error',
      source: 'renderer',
      session: 's1',
      scope: 'P2P',
      message: 'Error: boom',
      count: 1,
      context: { room: { inRoom: true } },
      breadcrumbs: [{ cat: 'room', event: 'join-open' }],
    })
    expect(report!.fingerprint).toBe(fingerprint)
    expect(report).not.toHaveProperty('late')
    expect(report).not.toHaveProperty('stats')
  })

  it('includes the latest measurements when there are some', () => {
    const { reporter, state } = setup()
    state.stats = { 'p2p/sender-stats': { t: new Date(START).toISOString(), cat: 'p2p', event: 'sender-stats', data: { kbps: 300 } } }

    expect(reporter.capture({ error: errorAt('boom') }).report!.stats).toEqual(state.stats)
  })

  it('folds a repeat of the same error inside the window', () => {
    const { reporter, clock } = setup()
    const first = reporter.capture({ error: errorAt('boom') })
    clock.ms += 1000
    const second = reporter.capture({ error: errorAt('boom') })

    expect(first.report).not.toBeNull()
    expect(second.report).toBeNull()
    expect(second.fingerprint).toBe(first.fingerprint)
  })

  it('reports again after the window, counting what was folded', () => {
    const { reporter, clock } = setup()
    reporter.capture({ error: errorAt('boom') })
    reporter.capture({ error: errorAt('boom') })
    reporter.capture({ error: errorAt('boom') })
    clock.ms += REPEAT_WINDOW_MS

    const { report } = reporter.capture({ error: errorAt('boom') })
    expect(report).toMatchObject({ count: 3 })
    expect(report).not.toHaveProperty('late')
  })

  it('starts counting from zero again after each report', () => {
    const { reporter, clock } = setup()
    reporter.capture({ error: errorAt('boom') })
    reporter.capture({ error: errorAt('boom') })
    reporter.capture({ error: errorAt('boom') })
    clock.ms += REPEAT_WINDOW_MS
    expect(reporter.capture({ error: errorAt('boom') }).report).toMatchObject({ count: 3 })

    clock.ms += REPEAT_WINDOW_MS
    expect(reporter.capture({ error: errorAt('boom') }).report).toMatchObject({ count: 1 })
    expect(reporter.drain()).toEqual([])
  })

  it('treats different errors independently', () => {
    const { reporter } = setup()
    const a = reporter.capture({ error: errorAt('boom') })
    const b = reporter.capture({ error: errorAt('other') })
    const c = reporter.capture({ error: errorAt('boom', 'elsewhere') })

    expect(a.report).not.toBeNull()
    expect(b.report).not.toBeNull()
    expect(c.report).not.toBeNull()
    expect(new Set([a.fingerprint, b.fingerprint, c.fingerprint]).size).toBe(3)
  })

  it('has nothing to drain while nothing was folded', () => {
    const { reporter, clock } = setup()
    reporter.capture({ error: errorAt('boom') })
    clock.ms += REPEAT_WINDOW_MS * 2

    expect(reporter.drain()).toEqual([])
    expect(reporter.nextDrainInMs()).toBeNull()
  })

  it('drains one report for the folded occurrences once the window has passed', () => {
    const { reporter, clock, state } = setup()
    reporter.capture({ scope: 'P2P', error: errorAt('boom') })
    clock.ms += 1000
    reporter.capture({ scope: 'P2P', error: errorAt('boom') })
    clock.ms += 1000
    reporter.capture({ scope: 'P2P', error: errorAt('boom') })
    const lastSeen = new Date(clock.ms).toISOString()

    expect(reporter.drain()).toEqual([])
    expect(reporter.nextDrainInMs()).toBe(REPEAT_WINDOW_MS - 2000)

    clock.ms = START + REPEAT_WINDOW_MS
    state.context = { room: { inRoom: false } }
    const drained = reporter.drain()

    expect(drained).toHaveLength(1)
    expect(drained[0]).toMatchObject({
      scope: 'P2P',
      message: 'Error: boom',
      count: 2,
      late: true,
      t: lastSeen,
      context: { room: { inRoom: false } },
    })
    expect(reporter.drain()).toEqual([])
    expect(reporter.nextDrainInMs()).toBeNull()
  })

  it('starts a new window after draining', () => {
    const { reporter, clock } = setup()
    reporter.capture({ error: errorAt('boom') })
    reporter.capture({ error: errorAt('boom') })
    clock.ms += REPEAT_WINDOW_MS
    reporter.drain()

    clock.ms += 1000
    expect(reporter.capture({ error: errorAt('boom') }).report).toBeNull()
  })

  it('holds back a flood of different errors and lets them out later', () => {
    const { reporter, clock } = setup()
    const results = Array.from({ length: MAX_REPORTS_PER_MINUTE + 5 }, (_v, i) =>
      reporter.capture({ error: errorAt(`failure in step ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`) })
    )

    expect(results.filter((result) => result.report).length).toBe(MAX_REPORTS_PER_MINUTE)
    expect(reporter.drain()).toEqual([])

    clock.ms += 61000
    const drained = reporter.drain()
    expect(drained).toHaveLength(5)
    expect(drained.every((report) => report.count === 1 && report.late === true)).toBe(true)
  })

  it('still reports when the context or the trail cannot be read', () => {
    const { reporter } = setup({
      context: () => {
        throw new Error('store not ready')
      },
      breadcrumbs: () => {
        throw new Error('trail gone')
      },
    })

    const { report } = reporter.capture({ error: errorAt('boom') })
    expect(report).toMatchObject({ message: 'Error: boom', context: { contextError: 'store not ready' }, breadcrumbs: [] })
  })

  it('never throws, whatever it is given', () => {
    const { reporter } = setup()
    const hostile = {
      get message(): string {
        throw new Error('no')
      },
    }

    expect(() => reporter.capture({ error: hostile })).not.toThrow()
    expect(() => reporter.capture(null as never)).not.toThrow()
    expect(() => reporter.capture({})).not.toThrow()
  })

  it('keeps a bounded memory of the errors it has seen', () => {
    const { reporter, clock } = setup({ maxTracked: 3, maxPerMinute: 1000 })
    const name = (i: number) => `failure ${String.fromCharCode(97 + i)}`
    for (let i = 0; i < 5; i++) reporter.capture({ error: errorAt(name(i)) })

    clock.ms += 1000
    // The oldest two were forgotten: they are reported as new, the newest three are folded.
    expect(reporter.capture({ error: errorAt(name(4)) }).report).toBeNull()
    expect(reporter.capture({ error: errorAt(name(0)) }).report).not.toBeNull()
  })
})
