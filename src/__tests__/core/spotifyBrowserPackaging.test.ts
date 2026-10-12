import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Spotify browser packaging', () => {
  it('uses standard Electron without EVS signing hooks or Castlabs dependencies', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(pkg.devDependencies.electron).not.toContain('castlabs')
    expect(pkg.build.afterSign).toBeUndefined()
    expect(pkg.build.electronDist).toBeUndefined()
    expect(pkg.scripts.postinstall).toBeUndefined()
  })
})
