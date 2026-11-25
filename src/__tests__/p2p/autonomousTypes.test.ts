import { expect, it } from 'vitest'
import ts from 'typescript'
import path from 'node:path'

it('keeps the autonomous transport, Electron bridge and connection UI type safe', () => {
  const root = process.cwd()
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const files = [
    'src/p2p/directInvite.ts', 'src/p2p/directSignaling.ts', 'src/p2p/manualConnection.ts',
    'src/p2p/PeerManager.ts', 'src/components/lobby/DirectConnectionPanel.tsx', 'src/components/lobby/DirectConnectTab.tsx',
    'src/components/LobbyModal.tsx', 'src/components/TopNavBar.tsx', 'electron/lanSignaling.ts', 'electron/preload.ts', 'electron/main.ts',
  ]
  const resolvedFiles = files.map(file => path.resolve(root, file))
  const targets = new Set(resolvedFiles.map(file => file.toLowerCase()))
  const ambientTypes = parsed.fileNames.filter(file => file.endsWith('.d.ts'))
  const program = ts.createIncrementalProgram({
    rootNames: [...new Set([...ambientTypes, ...resolvedFiles])],
    options: {
      ...parsed.options,
      noEmit: true,
      incremental: true,
      tsBuildInfoFile: path.join(root, 'node_modules/.cache/autonomous-types.tsbuildinfo'),
    },
  })
  const errors = ts.getPreEmitDiagnostics(program.getProgram())
    .filter(diagnostic => diagnostic.file && targets.has(path.resolve(diagnostic.file.fileName).toLowerCase()))
  program.emit()
  expect(errors.map(error => `${error.file?.fileName}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`)).toEqual([])
}, 120000)
