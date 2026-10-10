import { describe, it, expect } from 'vitest'
import { summarizeCpuProfile, startCpuProfile, CpuProfile } from '../../electron/startupProfile'

// A small profile with known numbers. Times are microseconds, as the DevTools protocol gives them;
// a sample lasts until the next one.
//
//   (root)
//   |- load   src/store/a.ts:10        (self 10 ms)
//   |   `- parse  (native, no file)    (self 25 ms)
//   |- (idle)                           (1 ms)
//   `- render src/components/App.tsx:21 (self 2 ms)
const profile: CpuProfile = {
  nodes: [
    { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1, columnNumber: -1 }, children: [2, 3, 4] },
    { id: 2, callFrame: { functionName: 'load', url: 'http://localhost:5173/src/store/a.ts?t=1', lineNumber: 9, columnNumber: 0 }, children: [5] },
    { id: 3, callFrame: { functionName: '(idle)', url: '', lineNumber: -1, columnNumber: -1 } },
    { id: 4, callFrame: { functionName: 'render', url: 'http://localhost:5173/src/components/App.tsx', lineNumber: 20, columnNumber: 0 } },
    { id: 5, callFrame: { functionName: 'parse', url: '', lineNumber: -1, columnNumber: -1 } },
  ],
  startTime: 0,
  endTime: 38000,
  samples: [2, 5, 5, 3, 4, 2],
  timeDeltas: [0, 10000, 20000, 5000, 1000, 2000],
}

const lines = summarizeCpuProfile(profile)
const text = lines.join('\n')
const section = (title: string) => lines.find((l) => l.startsWith(`[Startup] profile (${title})`)) ?? ''

describe('summarizeCpuProfile', () => {
  it('gives one log line per view, each tagged so it can be found', () => {
    expect(lines.length).toBeGreaterThanOrEqual(4)
    for (const line of lines) {
      expect(line.startsWith('[Startup] profile')).toBe(true)
      expect(line).not.toContain('\n')
    }
  })

  it('says how much time was sampled and how much of it was idle', () => {
    expect(lines[0]).toContain('38 ms sampled')
    expect(lines[0]).toContain('idle 1')
  })

  it('ranks the files by their own time, native work counted for the file that called it', () => {
    const files = section('self by file')
    expect(files).toContain('store/a.ts 35 ms')
    expect(files).toContain('components/App.tsx 2 ms')
    expect(files.indexOf('store/a.ts')).toBeLessThan(files.indexOf('components/App.tsx'))
  })

  it('ranks the files by the time they were on the stack', () => {
    const files = section('inclusive by file')
    expect(files).toContain('store/a.ts 35 ms')
    expect(files).toContain('components/App.tsx 2 ms')
  })

  it('ranks the functions by their own time, with line numbers starting at 1', () => {
    const functions = section('self by function')
    expect(functions).toContain('parse (native) 25 ms')
    expect(functions).toContain('load store/a.ts:10 10 ms')
    expect(functions).toContain('render components/App.tsx:21 2 ms')
    expect(functions.indexOf('parse')).toBeLessThan(functions.indexOf('load'))
    expect(functions.indexOf('load')).toBeLessThan(functions.indexOf('render'))
  })

  it('keeps the root and the idle time out of the rankings', () => {
    for (const title of ['self by file', 'inclusive by file', 'self by function']) {
      expect(section(title)).not.toContain('(root)')
      expect(section(title)).not.toContain('(idle)')
    }
  })

  it('does not show the query of a URL', () => {
    expect(text).not.toContain('?t=1')
    expect(text).not.toContain('localhost')
  })

  it('counts garbage collection and program time separately', () => {
    const withGc: CpuProfile = {
      ...profile,
      nodes: [...profile.nodes, { id: 6, callFrame: { functionName: '(garbage collector)', url: '', lineNumber: -1, columnNumber: -1 } }, { id: 7, callFrame: { functionName: '(program)', url: '', lineNumber: -1, columnNumber: -1 } }],
      samples: [6, 7, 2],
      timeDeltas: [0, 6000, 3000],
    }
    const head = summarizeCpuProfile(withGc)[0]
    expect(head).toContain('gc 6')
    expect(head).toContain('program 3')
  })

  it('shows only the top of each ranking', () => {
    const many: CpuProfile = {
      nodes: [
        { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1, columnNumber: -1 }, children: Array.from({ length: 30 }, (_, i) => i + 2) },
        ...Array.from({ length: 30 }, (_, i) => ({
          id: i + 2,
          callFrame: { functionName: `fn${i}`, url: `http://x/src/f${i}.ts`, lineNumber: i, columnNumber: 0 },
        })),
      ],
      startTime: 0,
      endTime: 1,
      samples: Array.from({ length: 30 }, (_, i) => i + 2),
      timeDeltas: [0, ...Array.from({ length: 30 }, (_, i) => (i + 1) * 1000)],
    }
    const out = summarizeCpuProfile(many)
    const files = out.find((l) => l.startsWith('[Startup] profile (self by file)')) ?? ''
    expect((files.match(/f\d+\.ts/g) ?? []).length).toBe(10)
    const functions = out.find((l) => l.startsWith('[Startup] profile (self by function)')) ?? ''
    expect((functions.match(/fn\d+ /g) ?? []).length).toBe(12)
  })

  it('copes with a profile that has no samples', () => {
    expect(summarizeCpuProfile({ nodes: [], startTime: 0, endTime: 0 })).toEqual(['[Startup] profile: no samples'])
    expect(summarizeCpuProfile({ nodes: profile.nodes, startTime: 0, endTime: 0, samples: [], timeDeltas: [] })).toEqual([
      '[Startup] profile: no samples',
    ])
  })

  it('ignores samples that point to a node it does not know', () => {
    const odd: CpuProfile = { ...profile, samples: [99, 2, 2], timeDeltas: [0, 5000, 7000] }
    expect(() => summarizeCpuProfile(odd)).not.toThrow()
  })
})

class FakeDebugger {
  calls: string[] = []
  attach(version: string) {
    this.calls.push(`attach ${version}`)
  }
  detach() {
    this.calls.push('detach')
  }
  async sendCommand(method: string, params?: unknown) {
    this.calls.push(params ? `${method} ${JSON.stringify(params)}` : method)
    return method === 'Profiler.stop' ? { profile } : {}
  }
}

describe('startCpuProfile', () => {
  it('attaches, enables and starts the profiler, in that order', async () => {
    const dbg = new FakeDebugger()
    await startCpuProfile(dbg)
    expect(dbg.calls).toEqual(['attach 1.3', 'Profiler.enable', 'Profiler.setSamplingInterval {"interval":500}', 'Profiler.start'])
  })

  it('stops, releases the debugger and returns the summary lines', async () => {
    const dbg = new FakeDebugger()
    const stop = await startCpuProfile(dbg)
    const result = await stop()
    expect(dbg.calls.slice(-3)).toEqual(['Profiler.stop', 'Profiler.disable', 'detach'])
    expect(result).toEqual(summarizeCpuProfile(profile))
  })

  it('releases the debugger even when stopping fails', async () => {
    const dbg = new FakeDebugger()
    const stop = await startCpuProfile(dbg)
    dbg.sendCommand = async (method: string) => {
      dbg.calls.push(method)
      if (method === 'Profiler.stop') throw new Error('target closed')
      return {}
    }
    await expect(stop()).rejects.toThrow('target closed')
    expect(dbg.calls).toContain('detach')
  })

  it('lets the caller know when it cannot attach', async () => {
    const dbg = new FakeDebugger()
    dbg.attach = () => {
      throw new Error('already attached')
    }
    await expect(startCpuProfile(dbg)).rejects.toThrow('already attached')
  })
})
