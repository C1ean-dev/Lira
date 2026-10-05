import { describe, it, expect } from 'vitest'
import { formatFrame, isAppPath, normalizeFramePath, parseStack } from '../utils/stackFrames'

describe('normalizeFramePath', () => {
  it('keeps the project path of a dev server URL, without the cache query', () => {
    expect(normalizeFramePath('http://localhost:5173/src/p2p/PeerManager.ts?t=1728061200000')).toBe('src/p2p/PeerManager.ts')
  })

  it('keeps the package path of a dependency', () => {
    expect(normalizeFramePath('http://localhost:5173/node_modules/.vite/deps/peerjs.js?v=23797a99')).toBe(
      'node_modules/.vite/deps/peerjs.js'
    )
    expect(normalizeFramePath('C:\\Users\\ana\\lira\\node_modules\\peerjs\\dist\\bundler.mjs')).toBe(
      'node_modules/peerjs/dist/bundler.mjs'
    )
  })

  it('drops the install folder of the packaged app', () => {
    expect(
      normalizeFramePath('file:///C:/Users/ana/AppData/Local/Programs/Lira/resources/app.asar/dist/assets/index-BxK3.js')
    ).toBe('dist/assets/index-BxK3.js')
    expect(
      normalizeFramePath('C:\\Users\\ana\\AppData\\Local\\Programs\\Lira\\resources\\app.asar\\dist-electron\\main.js')
    ).toBe('dist-electron/main.js')
  })

  it('is not misled by a user folder that is named like a project folder', () => {
    expect(normalizeFramePath('C:\\src\\tools\\Lira\\resources\\app.asar\\dist\\assets\\index-BxK3.js')).toBe('dist/assets/index-BxK3.js')
  })

  it('keeps the path of the app bundle outside the package', () => {
    expect(normalizeFramePath('file:///C:/Users/ana/lira/dist/assets/index-BxK3.js')).toBe('dist/assets/index-BxK3.js')
  })

  it('drops the checkout folder of a dev build', () => {
    expect(normalizeFramePath('C:\\Users\\ana\\lira\\dist-electron\\main.js')).toBe('dist-electron/main.js')
    expect(normalizeFramePath('file:///C:/Users/ana/lira/electron/main.ts')).toBe('electron/main.ts')
    expect(normalizeFramePath('/home/ana/lira/src/utils/logger.ts')).toBe('src/utils/logger.ts')
  })

  it('keeps runtime internals as they are', () => {
    expect(normalizeFramePath('node:internal/process/task_queues')).toBe('node:internal/process/task_queues')
  })

  it('keeps only the file name of a path outside the project', () => {
    expect(normalizeFramePath('C:\\Users\\ana\\Documents\\private\\tool.js')).toBe('tool.js')
    expect(normalizeFramePath('file:///C:/Users/ana/Documents/private/tool.js')).toBe('tool.js')
  })

  it('keeps the path of a dev server URL outside the project folders', () => {
    expect(normalizeFramePath('http://localhost:5173/@vite/client')).toBe('@vite/client')
  })
})

describe('isAppPath', () => {
  it('tells our code from dependencies and the runtime', () => {
    expect(isAppPath('src/p2p/PeerManager.ts')).toBe(true)
    expect(isAppPath('electron/main.ts')).toBe(true)
    expect(isAppPath('dist/assets/index-BxK3.js')).toBe(true)
    expect(isAppPath('dist-electron/main.js')).toBe(true)
    expect(isAppPath('node_modules/peerjs/dist/bundler.mjs')).toBe(false)
    expect(isAppPath('src/vendor/node_modules/lib/index.js')).toBe(false)
    expect(isAppPath('node:events')).toBe(false)
    expect(isAppPath('@vite/client')).toBe(false)
    expect(isAppPath('tool.js')).toBe(false)
  })
})

describe('parseStack', () => {
  it('reads the frames of a renderer error in dev', () => {
    const stack = [
      'Error: ID "lira-ROOM-host" is taken',
      '    at PeerManager.promoteToHost (http://localhost:5173/src/p2p/PeerManager.ts?t=17:883:15)',
      '    at async PeerManager.handleHostDisconnected (http://localhost:5173/src/p2p/PeerManager.ts?t=17:810:7)',
      '    at _socket.onmessage (http://localhost:5173/node_modules/.vite/deps/peerjs.js?v=23797a99:5329:12)',
      '    at http://localhost:5173/src/main.tsx:9:1',
      '    at new Foo (<anonymous>)',
      '    at Array.map (<anonymous>)',
    ].join('\n')

    expect(parseStack(stack)).toEqual([
      { fn: 'PeerManager.promoteToHost', file: 'src/p2p/PeerManager.ts', line: 883, col: 15, app: true },
      { fn: 'PeerManager.handleHostDisconnected', file: 'src/p2p/PeerManager.ts', line: 810, col: 7, app: true },
      { fn: '_socket.onmessage', file: 'node_modules/.vite/deps/peerjs.js', line: 5329, col: 12, app: false },
      { file: 'src/main.tsx', line: 9, col: 1, app: true },
      { fn: 'new Foo', app: false },
      { fn: 'Array.map', app: false },
    ])
  })

  it('reads the frames of a main process error', () => {
    const stack = [
      'TypeError: Cannot read properties of null',
      '    at Object.<anonymous> (C:\\Users\\ana\\lira\\dist-electron\\main.js:120:11)',
      '    at node:internal/main/run_main_module:28:49',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ].join('\n')

    expect(parseStack(stack)).toEqual([
      { fn: 'Object.<anonymous>', file: 'dist-electron/main.js', line: 120, col: 11, app: true },
      { file: 'node:internal/main/run_main_module', line: 28, col: 49, app: false },
      { fn: 'process.processTicksAndRejections', file: 'node:internal/process/task_queues', line: 95, col: 5, app: false },
    ])
  })

  it('reads a React component stack', () => {
    const stack = [
      '',
      '    at div',
      '    at CustomDropdown (http://localhost:5173/src/components/common/CustomDropdown.tsx:49:3)',
      '    at App (http://localhost:5173/src/App.tsx:47:33)',
    ].join('\n')

    expect(parseStack(stack)).toEqual([
      { fn: 'div', app: false },
      { fn: 'CustomDropdown', file: 'src/components/common/CustomDropdown.tsx', line: 49, col: 3, app: true },
      { fn: 'App', file: 'src/App.tsx', line: 47, col: 33, app: true },
    ])
  })

  it('points an eval frame at the code that ran the eval', () => {
    const stack = 'Error: x\n    at eval (eval at run (http://localhost:5173/src/a.ts:10:3), <anonymous>:1:1)'
    expect(parseStack(stack)).toEqual([{ fn: 'eval', file: 'src/a.ts', line: 10, col: 3, app: true }])
  })

  it('skips the lines of the message, however many they are', () => {
    const stack = 'Error: first line\nat least one item is required\nit failed at step 3\n    at run (http://localhost:5173/src/a.ts:1:2)'
    expect(parseStack(stack)).toEqual([{ fn: 'run', file: 'src/a.ts', line: 1, col: 2, app: true }])
  })

  it('keeps a bounded number of frames', () => {
    const lines = Array.from({ length: 100 }, (_v, i) => `    at f${i} (http://localhost:5173/src/a.ts:${i + 1}:1)`)
    const frames = parseStack(['Error: deep', ...lines].join('\n'), 5)
    expect(frames).toHaveLength(5)
    expect(frames[4].fn).toBe('f4')
  })

  it('returns no frames for a missing or foreign stack', () => {
    expect(parseStack(undefined)).toEqual([])
    expect(parseStack(null)).toEqual([])
    expect(parseStack('')).toEqual([])
    expect(parseStack(42 as unknown as string)).toEqual([])
    expect(parseStack('run@http://localhost/src/a.ts:1:2')).toEqual([])
  })
})

describe('formatFrame', () => {
  it('writes function and place', () => {
    expect(formatFrame({ fn: 'run', file: 'src/a.ts', line: 1, col: 2, app: true })).toBe('run (src/a.ts:1:2)')
  })

  it('writes only what it has', () => {
    expect(formatFrame({ file: 'src/a.ts', line: 1, col: 2, app: true })).toBe('src/a.ts:1:2')
    expect(formatFrame({ fn: 'Array.map', app: false })).toBe('Array.map')
    expect(formatFrame({ fn: 'run', file: 'src/a.ts', app: true })).toBe('run (src/a.ts)')
    expect(formatFrame({ app: false })).toBe('<unknown>')
  })
})
