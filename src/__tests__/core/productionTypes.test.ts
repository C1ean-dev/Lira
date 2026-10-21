import { expect, it } from 'vitest'
import ts from 'typescript'
import path from 'node:path'

it('type-checks the renderer and Electron bridge with the production configuration', () => {
  const root = process.cwd()
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true })
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map(diagnostic => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    if (!diagnostic.file || diagnostic.start === undefined) return `TS${diagnostic.code}: ${message}`
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    return `${path.relative(root, diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} TS${diagnostic.code}: ${message}`
  })
  expect(diagnostics).toEqual([])
}, 60000)
