import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { findSourceMentions } from '../../../scripts/sourceAudit'

const OLD_NAME = ['gat', 'her'].join('')
const OLD_NAME_PATTERN = new RegExp(`${OLD_NAME}(?!ing|ed)`, 'i')

const ROOT = process.cwd()
const SKIPPED_DIRS = new Set(['node_modules', '.git', '.claude', '.mut', 'dist', 'dist-electron', 'out', 'release', 'logs', 'bin', 'obj'])
const SKIPPED_PATHS = new Set(['src/data', 'package-lock.json'])
const SCANNED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css', '.html', '.md',
  '.yml', '.yaml', '.xml', '.svg', '.ps1', '.nsh', '.cpp', '.vcxproj',
])

const listFiles = (dir: string, found: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const relative = path.relative(ROOT, full).split(path.sep).join('/')
    if (SKIPPED_PATHS.has(relative)) continue
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) listFiles(full, found)
    } else {
      found.push(relative)
    }
  }
  return found
}

describe('old app name', () => {
  const files = listFiles(ROOT)

  it('scans the project sources', () => {
    expect(files).toContain('package.json')
    expect(files).toContain('src/App.tsx')
    expect(files).toContain('electron/main.ts')
  })

  it('is in no file or folder name', () => {
    expect(files.filter((file) => OLD_NAME_PATTERN.test(file))).toEqual([])
  })

  it('is in no source, config or doc file', async () => {
    expect(await findSourceMentions(ROOT, files, OLD_NAME_PATTERN, SCANNED_EXTENSIONS)).toEqual([])
  })
})
