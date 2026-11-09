import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('local release entry point', () => {
  it('removes all GitHub Actions workflows', () => {
    const directory = '.github/workflows'
    expect(existsSync(directory) ? readdirSync(directory).filter(file => /\.ya?ml$/.test(file)) : []).toEqual([])
  })

  it('provides a double-click launcher and an npm command for the same pipeline', () => {
    const launcher = readFileSync('Publicar-Atualizacao.cmd', 'utf8')
    expect(launcher).toContain('%~dp0')
    expect(launcher).toContain('scripts\\local-release.mjs')
    expect(launcher).toContain('pause')
    expect(JSON.parse(readFileSync('package.json', 'utf8')).scripts.release).toBe('node scripts/local-release.mjs')
  })

  it('ignores the local configuration containing signing and TURN credentials', () => {
    expect(readFileSync('.gitignore', 'utf8')).toContain('.env.release.local')
    expect(existsSync('.env.release.example')).toBe(true)
  })
})
