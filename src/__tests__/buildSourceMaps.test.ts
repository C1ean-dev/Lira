import { describe, it, expect } from 'vitest'
import fs from 'node:fs'

/**
 * The installed app translates the stack frames of its error reports with the
 * source maps of its own bundles (electron/stackSymbolicator.ts). That only
 * works when the build writes those maps: this file checks the build settings
 * and the place where the main process looks for them.
 */
const config = fs.readFileSync('vite.config.ts', 'utf8').replace(/\r\n/g, '\n')
const main = fs.readFileSync('electron/main.ts', 'utf8').replace(/\r\n/g, '\n')

const block = (text: string, start: string, end: string) => {
  const from = text.indexOf(start)
  expect(from, `"${start}" not found`).toBeGreaterThan(-1)
  const to = text.indexOf(end, from)
  expect(to, `"${end}" not found after "${start}"`).toBeGreaterThan(from)
  return text.slice(from, to)
}

describe('source maps of the build', () => {
  it('writes a map next to each bundle of the window', () => {
    const build = block(config, '\n  build: {', '\n  },')
    expect(build).toContain("sourcemap: 'hidden'")
  })

  it('writes a map for the main process bundle', () => {
    const entry = block(config, "entry: 'electron/main.ts',", '\n      },')
    expect(entry).toContain("sourcemap: 'hidden'")
  })

  it('keeps the sources themselves out of the maps', () => {
    expect(config.match(/sourcemapExcludeSources: true/g)).toHaveLength(2)
  })

  it('does not point the bundles at their maps, so nothing loads them at run time', () => {
    expect(config).not.toMatch(/sourcemap: true/)
    expect(config).not.toMatch(/sourcemap: 'inline'/)
  })
})

describe('reading the maps in the main process', () => {
  it('looks for the map next to the bundle, inside the app', () => {
    const symbolicator = block(main, 'const symbolicator = createSymbolicator({', '\n})')
    expect(symbolicator).toContain('path.join(app.getAppPath(), `${file}.map`)')
  })

  it('keeps only the parts of a map the lookup reads', () => {
    const symbolicator = block(main, 'const symbolicator = createSymbolicator({', '\n})')
    expect(symbolicator).toContain('sources: map.sources')
    expect(symbolicator).toContain('mappings: map.mappings')
    expect(symbolicator).not.toContain('sourcesContent')
  })

  it('translates every report before it is written, and lets go of the maps afterwards', () => {
    expect(block(main, 'const appLog = createLogWriter({', '\n})')).toContain('symbolicate: translateReport')
    const translate = block(main, 'function translateReport(', '\n}\n')
    expect(translate).toContain('symbolicator.report(report)')
    expect(translate).toContain('symbolicator.forget()')
  })
})
