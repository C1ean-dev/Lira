import { expect, it } from 'vitest'
import ts from 'typescript'
import path from 'node:path'

it('includes the autonomous transport, Electron bridge and connection UI in the production type check', () => {
  const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
  expect(config.error).toBeUndefined()
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd())
  expect(parsed.errors).toEqual([])
  const files = ['src/p2p/directInvite.ts', 'src/p2p/directSignaling.ts', 'src/p2p/manualConnection.ts',
    'src/p2p/PeerManager.ts', 'src/components/lobby/DirectConnectionPanel.tsx', 'src/components/lobby/DirectConnectTab.tsx',
    'src/components/LobbyModal.tsx', 'src/components/TopNavBar.tsx', 'electron/lanSignaling.ts', 'electron/preload.ts', 'electron/main.ts']
  const fileKey = (file: string) => {
    const absolute = path.resolve(file)
    return ts.sys.useCaseSensitiveFileNames ? absolute : absolute.toLowerCase()
  }
  // productionTypes.test.ts checks diagnostics for the entire configuration.
  const checkedFiles = new Set(parsed.fileNames.map(fileKey))
  expect(files.filter(file => !checkedFiles.has(fileKey(file)))).toEqual([])
})
