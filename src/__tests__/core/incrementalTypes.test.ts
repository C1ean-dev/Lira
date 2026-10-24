import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { checkTypeScriptProject } from '../../../scripts/checkTypeScriptProject'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it('invalidates cached diagnostics when an imported type changes and clears repaired errors', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lira-types-'))
  roots.push(root)
  const config = path.join(root, 'tsconfig.json')
  const cache = path.join(root, 'cache', 'types.tsbuildinfo')
  writeFileSync(config, JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], skipLibCheck: true }, files: ['main.ts', 'value.ts'] }))
  writeFileSync(path.join(root, 'main.ts'), "import { value } from './value'; const result: string = value")
  const dependency = path.join(root, 'value.ts')
  writeFileSync(dependency, "export const value = 'valid'")
  expect(checkTypeScriptProject(config, cache)).toEqual([])
  expect(checkTypeScriptProject(config, cache)).toEqual([])
  writeFileSync(dependency, 'export const value = 123')
  expect(checkTypeScriptProject(config, cache)).toEqual([expect.stringContaining('TS2322')])
  writeFileSync(dependency, "export const value = 'repaired'")
  expect(checkTypeScriptProject(config, cache)).toEqual([])
  writeFileSync(config, JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], skipLibCheck: true, noUnusedLocals: true }, files: ['main.ts', 'value.ts'] }))
  expect(checkTypeScriptProject(config, cache)).toEqual([expect.stringContaining('TS6133')])
})
