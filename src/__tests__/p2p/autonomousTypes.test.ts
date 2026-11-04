import { expect, it } from 'vitest'
import ts from 'typescript'
import path from 'node:path'

it('keeps the autonomous transport, Electron bridge and connection UI type safe', () => {
  const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd())
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true })
  const files = ['src/p2p/directInvite.ts', 'src/p2p/directSignaling.ts', 'src/p2p/manualConnection.ts',
    'src/p2p/PeerManager.ts', 'src/components/lobby/DirectConnectionPanel.tsx', 'src/components/lobby/DirectConnectTab.tsx',
    'src/components/LobbyModal.tsx', 'src/components/TopNavBar.tsx', 'electron/lanSignaling.ts', 'electron/preload.ts', 'electron/main.ts']
  const targets = new Set(files.map(file => path.resolve(file).toLowerCase()))
  const errors = ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.file && targets.has(path.resolve(diagnostic.file.fileName).toLowerCase()))
  expect(errors.map(error => `${error.file?.fileName}: ${ts.flattenDiagnosticMessageText(error.messageText, '\n')}`)).toEqual([])
}, 60000)
