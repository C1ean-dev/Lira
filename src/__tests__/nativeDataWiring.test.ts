import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { fileURLToPath } from 'url'

// The pieces are tested on their own (imageTable, pngOptimizer, nativeDataFile).
// What nothing else notices is a writer that goes back to dumping the plain JSON.

const read = (relative: string) => fs.readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8')

/** The text between two markers. */
function between(text: string, from: string, to: string): string {
  const start = text.indexOf(from)
  const end = text.indexOf(to, start + from.length)
  expect(start, `"${from}" not found`).toBeGreaterThanOrEqual(0)
  expect(end, `"${to}" not found after "${from}"`).toBeGreaterThan(start)
  return text.slice(start, end)
}

describe('who writes and reads nativeAssets.json', () => {
  it('the Electron main process saves it without holding up its event loop, and does not recode in the installed app', () => {
    const main = read('electron/main.ts')
    expect(main).toMatch(/from '\.\/nativeDataFile'/)
    const save = between(main, "'save-native-assets'", "'load-native-assets'")
    expect(save).toContain('await writeNativeDataFileLatest(')
    expect(save).toContain('optimize: !app.isPackaged')
    expect(save).not.toContain('JSON.stringify')
    expect(save).not.toMatch(/writeNativeDataFile\(/)
  })

  it('the Electron main process loads it through readNativeDataFile', () => {
    const main = read('electron/main.ts')
    const load = between(main, "'load-native-assets'", "'save-native-spaces'")
    expect(load).toContain('readNativeDataFile(')
    expect(load).not.toContain('JSON.parse')
  })

  it('the dev server saves it without holding up its event loop', () => {
    const config = read('vite.config.ts')
    expect(config).toMatch(/from '\.\/electron\/nativeDataFile'/)
    const save = between(config, "'/api/save-native-assets'", "'/api/save-native-spaces'")
    expect(save).toContain('await writeNativeDataFileLatest(')
    expect(save).not.toMatch(/writeNativeDataFile\(/)
    expect(save).not.toContain('JSON.stringify(parsed')
  })

  it('the assets store expands the table of images when it reads the file', () => {
    const store = read('src/store/useCustomAssetsStore.ts')
    expect(store).toMatch(/from '\.\.\/utils\/imageTable'/)
    expect(store).toContain('unpackImages(')
  })
})
