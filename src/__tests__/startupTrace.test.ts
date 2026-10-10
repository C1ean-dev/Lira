import { describe, it, expect } from 'vitest'
import { formatStartupReport, shortResourceName, StartupSnapshot } from '../utils/startupTrace'

const base: StartupSnapshot = {
  marks: { entry: 8123.4, graph: 9573.4, commit: 10213.4, painted: 10303.4 },
  navigation: { responseEnd: 140.2, domInteractive: 9100.7 },
  paints: { 'first-paint': 10250.1, 'first-contentful-paint': 10251.9 },
  resources: [
    { name: 'http://localhost:5173/src/index.css?t=1', startTime: 150, responseEnd: 3250, duration: 3100 },
    { name: 'http://localhost:5173/node_modules/.vite/deps/lucide-react.js?v=ab12', startTime: 160, responseEnd: 1060, duration: 900 },
    { name: 'http://localhost:5173/src/main.tsx', startTime: 120, responseEnd: 200, duration: 80 },
    { name: 'http://localhost:5173/src/App.tsx', startTime: 210, responseEnd: 8100, duration: 7890 },
  ],
  longTasks: [
    { startTime: 8120, duration: 1450 },
    { startTime: 9580, duration: 640 },
  ],
}

describe('formatStartupReport', () => {
  const line = formatStartupReport(base)

  it('is one line that can be found in the log', () => {
    expect(line.startsWith('[Startup] renderer:')).toBe(true)
    expect(line).not.toContain('\n')
  })

  it('says when the app code started and how long each step after that took', () => {
    expect(line).toContain('entry 8123 ms')
    expect(line).toContain('graph +1450')
    expect(line).toContain('commit +640')
    expect(line).toContain('painted +90')
    expect(line).toContain('total 10303 ms')
  })

  it('places the splash mark between the entry and the end of the evaluation', () => {
    const withSplash = formatStartupReport({
      ...base,
      marks: { entry: 100.4, splash: 250.4, graph: 2650.4, commit: 2780.4, painted: 2900.4 },
    })
    expect(withSplash).toContain('entry 100 ms | splash +150 | graph +2400 | commit +130 | painted +120 | total 2900 ms')
  })

  it('says when the page arrived and the first paint', () => {
    expect(line).toContain('html 140 ms')
    expect(line).toContain('dom-interactive 9101 ms')
    expect(line).toContain('first-paint 10250 ms')
    expect(line).toContain('fcp 10252 ms')
  })

  it('counts the requests and shows the slowest first', () => {
    expect(line).toContain('requests 4 (120-8100 ms)')
    const slowest = line.slice(line.indexOf('slowest:'))
    expect(slowest.indexOf('App.tsx 7890 ms')).toBeGreaterThan(-1)
    expect(slowest.indexOf('App.tsx')).toBeLessThan(slowest.indexOf('index.css'))
    expect(slowest.indexOf('index.css')).toBeLessThan(slowest.indexOf('lucide-react.js'))
  })

  it('names the requests by their last two path segments, without origin or query', () => {
    expect(line).toContain('src/index.css 3100 ms')
    expect(line).toContain('deps/lucide-react.js 900 ms')
    expect(line).not.toContain('localhost')
    expect(line).not.toContain('?')
  })

  it('shows only the 5 slowest', () => {
    const many: StartupSnapshot = {
      ...base,
      resources: Array.from({ length: 12 }, (_, i) => ({ name: `http://x/src/m${i}.ts`, startTime: i, responseEnd: i + 10 + i, duration: 10 + i })),
    }
    const text = formatStartupReport(many)
    const listed = text.slice(text.indexOf('slowest:')).match(/m\d+\.ts/g) ?? []
    expect(listed).toEqual(['m11.ts', 'm10.ts', 'm9.ts', 'm8.ts', 'm7.ts'])
  })

  it('reports the long tasks: how many, and the longest with where it started', () => {
    expect(line).toContain('long tasks 2, longest 1450 ms at 8120 ms')
  })

  it('leaves out what it does not have', () => {
    const bare = formatStartupReport({ marks: { entry: 3000 }, paints: {}, resources: [], longTasks: [] })
    expect(bare).toContain('entry 3000 ms')
    for (const word of ['graph', 'commit', 'painted', 'html', 'first-paint', 'fcp', 'requests', 'long tasks', 'total']) {
      expect(bare, word).not.toContain(word)
    }
  })

  it('measures a step from the last mark that exists', () => {
    const skipped = formatStartupReport({ marks: { entry: 1000, commit: 1600 }, paints: {}, resources: [], longTasks: [] })
    expect(skipped).toContain('commit +600')
    expect(skipped).not.toContain('graph')
  })

  it('does not trip over empty or odd data', () => {
    expect(() => formatStartupReport({ marks: {}, paints: {}, resources: [], longTasks: [] })).not.toThrow()
    expect(formatStartupReport({ marks: {}, paints: {}, resources: [], longTasks: [] })).toBe('[Startup] renderer: no marks')
    const odd = formatStartupReport({
      ...base,
      resources: [{ name: 'not a url', startTime: 1, responseEnd: 2, duration: 1 }],
    })
    expect(odd).toContain('not a url 1 ms')
  })
})

describe('formatStartupReport: local storage', () => {
  const storage = {
    firstAccessMs: 640.4,
    keys: 14,
    totalChars: 6_300_000,
    largest: [
      { key: 'lira_custom_user_assets', chars: 2_700_000 },
      { key: 'lira_dm_messages', chars: 412_345 },
      { key: 'lira_profile', chars: 980 },
    ],
  }

  it('says how long the first access took and what is stored', () => {
    const line = formatStartupReport({ ...base, storage })
    expect(line).toContain('storage first access 640 ms, 14 keys, 6.3M chars')
  })

  it('names the largest values, with sizes in M, k or plain characters', () => {
    const line = formatStartupReport({ ...base, storage })
    expect(line).toContain('(lira_custom_user_assets 2.7M, lira_dm_messages 412k, lira_profile 980)')
  })

  it('is left out when the storage could not be read', () => {
    expect(formatStartupReport(base)).not.toContain('storage')
  })

  it('copes with an empty storage', () => {
    const line = formatStartupReport({ ...base, storage: { firstAccessMs: 3.2, keys: 0, totalChars: 0, largest: [] } })
    expect(line).toContain('storage first access 3 ms, 0 keys, 0 chars')
  })
})

describe('shortResourceName', () => {
  it.each([
    ['http://localhost:5173/src/components/LobbyModal.tsx?t=17', 'components/LobbyModal.tsx'],
    ['http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=9', 'deps/react-dom_client.js'],
    ['file:///C:/Users/x/app.asar/dist/assets/index-DGQtizKz.js', 'assets/index-DGQtizKz.js'],
    ['https://fonts.googleapis.com/css2?family=Inter&display=swap', 'fonts.googleapis.com/css2'],
    ['http://localhost:5173/index.html', 'localhost:5173/index.html'],
    ['http://localhost:5173/@vite/client', '@vite/client'],
    ['not a url', 'not a url'],
  ])('%s -> %s', (input, expected) => {
    expect(shortResourceName(input)).toBe(expected)
  })
})
