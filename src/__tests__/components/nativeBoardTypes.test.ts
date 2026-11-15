import ts from 'typescript'
import path from 'node:path'
import { expect, it } from 'vitest'

it('keeps the native editor type-safe without any external drawing SDK', () => {
  const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd())
  const files = ['src/collaboration/whiteboard.ts', 'src/collaboration/boardScene.ts', 'src/collaboration/boardEditor.ts', 'src/collaboration/boardFile.ts',
    'src/components/collaboration/WhiteboardPanel.tsx', 'src/components/collaboration/NativeBoard.tsx',
    'src/store/useWhiteboardStore.ts', 'src/services/whiteboardNetwork.ts', 'src/store/useBoardPointerStore.ts',
    'src/services/boardPointerNetwork.ts', 'src/components/collaboration/BoardPointerOverlay.tsx']
  const targets = new Set(files.map(file => path.resolve(file).replaceAll('\\', '/')))
  const program = ts.createProgram([...files, 'src/vite-env.d.ts'], options)
  const errors = ts.getPreEmitDiagnostics(program).filter(d => d.file && targets.has(path.resolve(d.file.fileName).replaceAll('\\', '/')))
  expect(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
}, 30_000)
