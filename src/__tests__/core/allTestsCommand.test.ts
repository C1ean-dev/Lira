import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))

describe('complete local test command', () => {
  it('uses the quiet runner for every suite', () => {
    expect(scripts['test:all']).toBe('node scripts/test-all.mjs')
    expect(scripts['teste:all']).toBe('npm run test:all')
  })

  it('enables the opt-in runtime suites instead of silently skipping them', () => {
    for (const [name, flag, file] of [
      ['test:core:browser', 'LIRA_RUN_BROWSER_TESTS', 'scripts/core-realtime.browser.test.mjs'],
      ['test:sprites:electron', 'LIRA_RUN_SPRITE_TESTS', 'scripts/individual-library.electron.test.mjs'],
      ['test:transcription:electron', 'LIRA_RUN_TRANSCRIPTION_TESTS', 'scripts/transcription-module.electron.test.mjs'],
    ]) {
      expect(scripts[name]).toContain(`${flag}=1`)
      expect(scripts[name]).toContain('node --test')
      expect(scripts[name]).toContain(file)
      expect(existsSync(file)).toBe(true)
    }
    expect(scripts['test:migration']).toBe('python scripts/test_migrate_individual_library.py')
  })

  it('keeps transcription tests independent of previous application builds', () => {
    const source = readFileSync('scripts/transcription-module.electron.test.mjs', 'utf8')
    expect(source).not.toContain('dist/assets')
    expect(source).toContain('buildTestPanelCss')
  })

  it('generates the transcription test stylesheet without starting Electron', async () => {
    const { buildTestPanelCss } = await import('../../../scripts/build-test-panel-css.mjs')
    const temporary = mkdtempSync(path.join(tmpdir(), 'lira-test-css-'))
    try {
      const output = path.join(temporary, 'panel.css')
      await buildTestPanelCss(output)
      const css = readFileSync(output, 'utf8')
      expect(css).toContain('.bg-slate-950')
      expect(css).not.toContain('@tailwind')
      // A class mentioned only in tests must not enter the isolated panel stylesheet.
      expect(css).not.toContain('.bg-fuchsia-950')
      expect(css).toContain('.w-72')
    } finally {
      rmSync(temporary, { recursive: true, force: true })
    }
  })
})
