import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { fileURLToPath } from 'url'

// The pieces are tested on their own (startupTrace, startupTimer). This checks they are
// hooked up where the measurements have to be taken.

const read = (relative: string) => fs.readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8')

describe('start-up measurements', () => {
  it('main.tsx evaluates the entry mark before anything else in the app', () => {
    const main = read('src/main.tsx')
    const imports = main.split(/\r?\n/).filter((l) => l.startsWith('import '))
    expect(imports[0]).toBe("import './utils/startupEntry'")
  })

  it('main.tsx is tiny: it lets the splash paint, then loads the app', () => {
    const main = read('src/main.tsx')
    // nothing of the app is imported up front, or its evaluation would run before the splash is painted
    const imports = main.split(/\r?\n/).filter((l) => l.startsWith('import '))
    expect(imports.filter((l) => /from '\.\/(App|components|store|p2p|media|engine|editor)/.test(l))).toEqual([])
    expect(imports.some((l) => /react-dom/.test(l))).toBe(false)
    expect(main).toMatch(/installRendererLogging\(\)/)
    expect(main).toMatch(/requestAnimationFrame\(\(\) => requestAnimationFrame\(loadApp\)\)/)
    expect(main).toMatch(/markStartup\('splash'\)/)
    expect(main).toMatch(/import\('\.\/bootstrap'\)/)
  })

  it('main.tsx does not wait forever for animation frames (a window that is not drawn gets none)', () => {
    expect(read('src/main.tsx')).toMatch(/setTimeout\(loadApp, \d+\)/)
  })

  it('main.tsx says so on the splash when the app cannot be loaded', () => {
    const main = read('src/main.tsx')
    expect(main).toMatch(/\.catch\(/)
    expect(main).toContain('boot-splash-status')
  })

  it('bootstrap.tsx marks the end of the evaluation and renders the app', () => {
    const bootstrap = read('src/bootstrap.tsx')
    expect(bootstrap).toMatch(/markStartup\('graph'\)/)
    expect(bootstrap).toMatch(/createRoot\(document\.getElementById\('root'\)!\)\.render\(/)
    expect(bootstrap).toMatch(/<ErrorBoundary>\s*<App \/>\s*<\/ErrorBoundary>/)
    expect(bootstrap).toMatch(/import '\.\/index\.css'/)
  })

  it('the entry module takes the first mark and watches long tasks', () => {
    const entry = read('src/utils/startupEntry.ts')
    expect(entry).toMatch(/markStartup\('entry'\)/)
    expect(entry).toMatch(/observeLongTasks\(\)/)
    expect(entry).toMatch(/probeStorage\(\)/)
  })

  it('App marks the first commit and reports after the first paint', () => {
    const app = read('src/App.tsx')
    expect(app).toMatch(/useLayoutEffect\(\(\) => \{\s*markStartup\('commit'\)\s*reportStartupAfterPaint\(\)/)
  })

  it('the main process can record a CPU profile of the load, only when asked for', () => {
    const main = read('electron/main.ts')
    expect(main).toMatch(/from '\.\/startupProfile'/)
    expect(main).toMatch(/process\.env\.LIRA_PROFILE_STARTUP === '1'/)
    expect(main).toContain('startCpuProfile(')
  })

  it('the profiler is started once the page has committed (before that its target is replaced) and the app loads either way', () => {
    const main = read('electron/main.ts')
    expect(main).toMatch(/LIRA_PROFILE_STARTUP === '1' && !startupProfiled\) \{[\s\S]*?once\('did-navigate'[\s\S]*?startCpuProfile\(/)
    expect(main).toMatch(/\r?\n  loadApp\(\)\r?\n\}/)
  })

  it('the main process logs the window steps', () => {
    const main = read('electron/main.ts')
    expect(main).toMatch(/from '\.\/startupTimer'/)
    for (const step of [
      'ready',
      'window-created',
      'did-start-loading',
      'did-start-navigation',
      'did-navigate',
      'ready-to-show',
      'dom-ready',
      'did-finish-load',
    ]) {
      expect(main, step).toContain(`'${step}'`)
    }
  })
})
