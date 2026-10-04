import { describe, it, expect } from 'vitest'
import { createStartupTimer } from '../../electron/startupTimer'

function setup(clock: number[], uptimes: number[]) {
  const lines: string[] = []
  let c = 0
  let u = 0
  const mark = createStartupTimer({
    log: (line) => lines.push(line),
    now: () => clock[Math.min(c++, clock.length - 1)],
    uptimeMs: () => uptimes[Math.min(u++, uptimes.length - 1)],
  })
  return { mark, lines }
}

describe('createStartupTimer (main process)', () => {
  it('logs each step with the time since the timer started and how long the process has been up', () => {
    // 1st clock reading: creation; then one per mark
    const { mark, lines } = setup([1000, 1000, 1180, 2650], [1500, 1680, 3150])
    mark('window-created')
    mark('dom-ready')
    mark('did-finish-load')
    expect(lines).toEqual([
      '[Startup] main: window-created +0 ms (process up 1500 ms)',
      '[Startup] main: dom-ready +180 ms (process up 1680 ms)',
      '[Startup] main: did-finish-load +1650 ms (process up 3150 ms)',
    ])
  })

  it('rounds to whole milliseconds', () => {
    const { mark, lines } = setup([10, 10.4, 20.6], [100.2, 200.7])
    mark('a')
    mark('b')
    expect(lines).toEqual(['[Startup] main: a +0 ms (process up 100 ms)', '[Startup] main: b +11 ms (process up 201 ms)'])
  })

  it('logs a step only the first time it happens', () => {
    const { mark, lines } = setup([0, 5, 9, 12], [1, 2, 3, 4])
    mark('dom-ready')
    mark('dom-ready')
    mark('did-finish-load')
    expect(lines.map((l) => l.split(' ')[2])).toEqual(['dom-ready', 'did-finish-load'])
  })

  it('never lets a failing log break the app', () => {
    const mark = createStartupTimer({
      log: () => {
        throw new Error('disk full')
      },
      now: () => 0,
      uptimeMs: () => 0,
    })
    expect(() => mark('x')).not.toThrow()
  })
})
