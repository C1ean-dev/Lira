import ts from 'typescript'
import path from 'node:path'
import { expect, it } from 'vitest'

it('keeps the embedded SDK and P2P adapters type-safe', () => {
  const root = process.cwd()
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const files = ['src/collaboration/whiteboard.ts', 'src/collaboration/boardScene.ts', 'src/collaboration/boardEditor.ts', 'src/collaboration/boardFile.ts',
    'src/components/collaboration/WhiteboardPanel.tsx', 'src/components/collaboration/ExcalidrawBoard.tsx', 'src/collaboration/boardPersistence.ts', 'src/collaboration/boardRestore.ts',
    'src/store/useWhiteboardStore.ts', 'src/services/whiteboardNetwork.ts', 'src/store/useBoardPointerStore.ts',
    'src/services/boardPointerNetwork.ts', 'src/components/collaboration/BoardPointerOverlay.tsx']
  const resolvedFiles = files.map(file => path.resolve(root, file))
  const ambientTypes = parsed.fileNames.filter(file => file.endsWith('.d.ts'))
  const targets = new Set(resolvedFiles.map(file => file.replaceAll('\\', '/').toLowerCase()))
  const program = ts.createIncrementalProgram({
    rootNames: [...new Set([...ambientTypes, ...resolvedFiles])],
    options: {
      ...parsed.options,
      noEmit: true,
      incremental: true,
      tsBuildInfoFile: path.join(root, 'node_modules/.cache/native-board-types.tsbuildinfo'),
    },
  })
  const errors = ts.getPreEmitDiagnostics(program.getProgram())
    .filter(d => d.file && targets.has(path.resolve(d.file.fileName).replaceAll('\\', '/').toLowerCase()))
  program.emit()
  expect(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([])
}, 120_000)
