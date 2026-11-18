import { posix } from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../../../vite.config'

const ignored = config.server?.watch?.ignored as string[]
const watches = (file: string) => !ignored.some(pattern => posix.matchesGlob(file, pattern))

describe('development file watcher', () => {
  it.each([
    'C:/Users/clean/lira/.scratch/process-audio-monitor-current/obj/vc145.pdb',
    'C:/Users/clean/lira/native/process-audio-capture/obj/x64/Release/vc145.pdb',
    'C:/Users/clean/lira/native/bin/process-audio-capture.exe',
  ])('ignores generated files that can be held open by native tools (%s)', file => {
    expect(watches(file)).toBe(false)
  })

  it('continues to watch application source files', () => {
    expect(watches('C:/Users/clean/lira/src/media/MediaManager.ts')).toBe(true)
    expect(watches('C:/Users/clean/lira/electron/main.ts')).toBe(true)
  })
})
