import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { findSourceMentions } from '../../../scripts/sourceAudit'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('reports each matching line once, preserving file order and CRLF line numbers', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lira-audit-'))
  roots.push(root)
  writeFileSync(path.join(root, 'first.ts'), 'clear\r\nneedle needle\r\nclear\r\nNEEDLE')
  writeFileSync(path.join(root, 'second.md'), 'needle\nclear')
  writeFileSync(path.join(root, 'clean.ts'), 'clear\n'.repeat(100000))
  writeFileSync(path.join(root, 'ignored.png'), 'needle')
  expect(await findSourceMentions(root, ['first.ts', 'clean.ts', 'ignored.png', 'second.md'], /needle/gi, new Set(['.ts', '.md'])))
    .toEqual(['first.ts:2', 'first.ts:4', 'second.md:1'])
})

it('propagates unreadable source errors instead of silently skipping coverage', async () => {
  await expect(findSourceMentions(process.cwd(), ['missing-source.ts'], /needle/, new Set(['.ts']))).rejects.toThrow()
})
