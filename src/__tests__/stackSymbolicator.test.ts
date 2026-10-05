import { describe, it, expect, vi } from 'vitest'
import { createSymbolicator } from '../../electron/stackSymbolicator'
import { buildErrorReport, sanitizeErrorReport } from '../utils/errorReport'
import type { StackFrame } from '../utils/stackFrames'
import { makeSourceMap } from './helpers/sourceMapFixture'

// The renderer bundle: our code, then a dependency, then code that came from no source.
const APP_MAP = makeSourceMap(
  ['../../src/p2p/PeerManager.ts', '../../node_modules/peerjs/dist/bundler.mjs', '\u0000vite/preload-helper.js'],
  [
    [
      [0, 0, 882, 14],
      [3000, 1, 5328, 11],
      [6000, 2, 0, 0],
      [9000],
    ],
  ]
)
// The main process bundle.
const MAIN_MAP = makeSourceMap(['../electron/main.ts', '../src/utils/logFormat.ts'], [[], [[0, 0, 400, 2]], [[0, 1, 50, 4]]])

const APP = 'dist/assets/bootstrap-B3a7s0Ga.js'
const MAIN = 'dist-electron/main.js'

const setup = (maps: Record<string, unknown> = { [APP]: APP_MAP, [MAIN]: MAIN_MAP }) => {
  const loadMap = vi.fn((file: string) => (maps[file] as never) ?? null)
  return { symbolicator: createSymbolicator({ loadMap }), loadMap }
}

const frame = (file: string, line: number, col: number, fn?: string): StackFrame => ({ ...(fn ? { fn } : {}), file, line, col, app: true })

describe('symbolicator', () => {
  it('turns a position in the app bundle into the source file and line', () => {
    const { symbolicator } = setup()
    expect(symbolicator.frames([frame(APP, 1, 101, 'Xe.promoteToHost')])).toEqual([
      { fn: 'Xe.promoteToHost', file: 'src/p2p/PeerManager.ts', line: 883, col: 15, app: true, min: `${APP}:1:101` },
    ])
  })

  it('tells our code from a dependency inside the same bundle', () => {
    const { symbolicator } = setup()
    expect(symbolicator.frames([frame(APP, 1, 3500, 'ws')])).toEqual([
      { fn: 'ws', file: 'node_modules/peerjs/dist/bundler.mjs', line: 5329, col: 12, app: false, min: `${APP}:1:3500` },
    ])
  })

  it('translates the main process bundle too', () => {
    const { symbolicator } = setup()
    expect(symbolicator.frames([frame(MAIN, 2, 10, 'createWindow'), frame(MAIN, 3, 1)])).toEqual([
      { fn: 'createWindow', file: 'electron/main.ts', line: 401, col: 3, app: true, min: `${MAIN}:2:10` },
      { file: 'src/utils/logFormat.ts', line: 51, col: 5, app: true, min: `${MAIN}:3:1` },
    ])
  })

  it('leaves alone what it cannot translate', () => {
    const { symbolicator } = setup()
    const untouched = [
      frame('src/p2p/PeerManager.ts', 883, 15, 'PeerManager.promoteToHost'), // a dev run: already the source
      { fn: 'Array.map', app: false }, // no place
      { fn: 'run', file: APP, app: true }, // no line
      frame(APP, 1, 9500, 'gone'), // code that came from no source
      frame(APP, 7, 1, 'beyond'), // outside the map
      frame('dist/assets/other-123.js', 1, 1, 'unknown'), // a bundle with no map
      frame('node_modules/peerjs/dist/bundler.mjs', 10, 2, 'vendor'),
    ]
    expect(symbolicator.frames(untouched)).toEqual(untouched)
  })

  it('translates the bundle frames of a mixed stack and leaves the others where they are', () => {
    const { symbolicator } = setup()
    const stack = [
      { fn: 'Array.map', app: false },
      frame(APP, 1, 101, 'a'),
      frame('src/App.tsx', 47, 33, 'App'),
      frame(MAIN, 2, 10, 'b'),
      frame(APP, 1, 3500, 'c'),
    ]

    expect(symbolicator.frames(stack).map((entry) => `${entry.fn} ${entry.file ?? '-'}:${entry.line ?? '-'}`)).toEqual([
      'Array.map -:-',
      'a src/p2p/PeerManager.ts:883',
      'App src/App.tsx:47',
      'b electron/main.ts:401',
      'c node_modules/peerjs/dist/bundler.mjs:5329',
    ])
  })

  it('names a bundler helper by its file, not as our code', () => {
    const { symbolicator } = setup()
    expect(symbolicator.frames([frame(APP, 1, 6001)])).toEqual([{ file: 'preload-helper.js', line: 1, col: 1, app: false, min: `${APP}:1:6001` }])
  })

  it('reads each map once, however many frames and reports use it', () => {
    const { symbolicator, loadMap } = setup()
    symbolicator.frames([frame(APP, 1, 1), frame(APP, 1, 3500), frame(MAIN, 2, 1), frame('dist/assets/other-123.js', 1, 1)])
    symbolicator.frames([frame(APP, 1, 10), frame('dist/assets/other-123.js', 2, 2)])

    expect(loadMap.mock.calls.map((call) => call[0]).sort()).toEqual([APP, MAIN, 'dist/assets/other-123.js'].sort())
  })

  it('reads the maps again after being told to forget them', () => {
    const { symbolicator, loadMap } = setup()
    symbolicator.frames([frame(APP, 1, 1)])
    symbolicator.forget()
    symbolicator.frames([frame(APP, 1, 1)])

    expect(loadMap).toHaveBeenCalledTimes(2)
  })

  it('does not ask for a map when no frame is in a bundle', () => {
    const { symbolicator, loadMap } = setup()
    symbolicator.frames([frame('src/App.tsx', 47, 33, 'App'), { fn: 'div', app: false }])
    expect(loadMap).not.toHaveBeenCalled()
  })

  it('translates every stack of a report: the error, its causes, where it was logged and the components', () => {
    const { symbolicator } = setup()
    const report = buildErrorReport({ source: 'renderer', session: 's', message: 'm', now: new Date('2026-10-04T10:00:00.000Z'), random: () => 0 })
    report.error = {
      name: 'Error',
      message: 'top',
      frames: [frame(APP, 1, 101, 'a')],
      cause: { name: 'Error', message: 'middle', frames: [frame(APP, 1, 3500, 'b')], cause: { name: 'Error', message: 'root', frames: [frame(MAIN, 2, 1, 'c')] } },
    }
    report.loggedAt = [frame(APP, 1, 50, 'd')]
    report.componentStack = [frame(APP, 1, 2000, 'Wt'), { fn: 'div', app: false }]
    const fingerprint = report.fingerprint

    expect(symbolicator.report(report)).toBe(report)
    expect(report.error.frames[0]).toMatchObject({ file: 'src/p2p/PeerManager.ts', line: 883 })
    expect(report.error.cause!.frames[0]).toMatchObject({ file: 'node_modules/peerjs/dist/bundler.mjs', app: false })
    expect(report.error.cause!.cause!.frames[0]).toMatchObject({ file: 'electron/main.ts', line: 401 })
    expect(report.loggedAt[0]).toMatchObject({ file: 'src/p2p/PeerManager.ts', min: `${APP}:1:50` })
    expect(report.componentStack).toEqual([
      { fn: 'Wt', file: 'src/p2p/PeerManager.ts', line: 883, col: 15, app: true, min: `${APP}:1:2000` },
      { fn: 'div', app: false },
    ])
    // The id of the error is the one the window computed: the text log refers to it.
    expect(report.fingerprint).toBe(fingerprint)
  })

  it('keeps the translated frames through the checks a report goes through', () => {
    const { symbolicator } = setup()
    const report = buildErrorReport({ source: 'renderer', session: 's', message: 'm', now: new Date('2026-10-04T10:00:00.000Z'), random: () => 0 })
    report.loggedAt = [frame(APP, 1, 50, 'd')]
    symbolicator.report(report)

    expect(sanitizeErrorReport(JSON.parse(JSON.stringify(report)), 'renderer')?.loggedAt).toEqual(report.loggedAt)
  })

  it('never throws: a map that cannot be read leaves the frames as they are', () => {
    const symbolicator = createSymbolicator({
      loadMap: () => {
        throw new Error('ENOENT')
      },
    })
    const frames = [frame(APP, 1, 101, 'a')]
    expect(symbolicator.frames(frames)).toEqual(frames)
    expect(() => symbolicator.report(null as never)).not.toThrow()
    expect(() => symbolicator.report({} as never)).not.toThrow()
    expect(symbolicator.frames(undefined as never)).toEqual([])
  })

  it('leaves the frames as they are when the map is not a map', () => {
    const { symbolicator } = setup({ [APP]: { sources: 'nope', mappings: 7 } })
    const frames = [frame(APP, 1, 101, 'a')]
    expect(symbolicator.frames(frames)).toEqual(frames)
  })
})
