import { expect, it } from 'vitest'
import path from 'node:path'
import { checkTypeScriptProject } from '../../../scripts/checkTypeScriptProject'

it('type-checks the renderer and Electron bridge with the production configuration', () => {
  const root = process.cwd()
  const diagnostics = checkTypeScriptProject(path.join(root, 'tsconfig.json'), path.join(root, 'node_modules/.cache/production-types.tsbuildinfo'))
  expect(diagnostics).toEqual([])
}, 60000)
