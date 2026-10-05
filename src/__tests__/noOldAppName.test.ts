import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// The app used to ship under another name. It is spelled in two halves here so
// this file passes its own scan.
const OLD_NAME = ['gat', 'her'].join('')
// "...ing" / "...ed" are the English verb (WebRTC's ICE vocabulary), not the old name.
const OLD_NAME_PATTERN = new RegExp(`${OLD_NAME}(?!ing|ed)`, 'i')

const ROOT = process.cwd()
const SKIPPED_DIRS = new Set(['node_modules', '.git', '.claude', '.mut', 'dist', 'dist-electron', 'release', 'logs', 'bin', 'obj'])
// Written by the app (images as base64) or by npm: not our text.
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

  it('is in no source, config or doc file', () => {
    const mentions: string[] = []
    for (const file of files) {
      if (!SCANNED_EXTENSIONS.has(path.extname(file).toLowerCase())) continue
      const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/)
      lines.forEach((line, index) => {
        if (OLD_NAME_PATTERN.test(line)) mentions.push(`${file}:${index + 1}`)
      })
    }
    expect(mentions).toEqual([])
  })
})
