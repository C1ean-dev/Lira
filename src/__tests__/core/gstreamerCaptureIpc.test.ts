import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { expect, it, vi } from 'vitest'
import { resolveGStreamerSource } from '../../../electron/gstreamerLive'
import { gstreamerSignalSchema } from '../../media/gstreamerProtocol'

const file = ts.createSourceFile('main.ts', readFileSync('electron/main.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const ipcCode = file.statements.filter(node => {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.some(declaration => /^nativeLive[s]?$/.test(declaration.name.getText(file)))
  if (ts.isFunctionDeclaration(node)) return ['isNativeLiveOwner', 'stopNativeLive'].includes(node.name?.text ?? '')
  return ts.isExpressionStatement(node) && /^ipcMain\.handle\('gstreamer-/.test(node.getText(file))
}).map(node => node.getText(file)).join('\n')
const javascript = ts.transpileModule(ipcCode, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

it('keeps independent IPC sessions for the live window and its replacement monitor', async () => {
  const handlers = new Map<string, (...args: any[]) => any>()
  const frame = {}
  const publisher = { mainFrame: frame, send: vi.fn(), isDestroyed: () => false }
  const sourceWindow = { id: 'window:123:0', display_id: '' }
  const sourceScreen = { id: 'screen:2:0', display_id: '2' }
  let monitorReady!: (success: boolean) => void
  const first = { ready: Promise.resolve(true), stop: vi.fn(), signal: vi.fn(() => true) }
  const second = { ready: new Promise<boolean>(resolve => { monitorReady = resolve }), stop: vi.fn(), signal: vi.fn(() => true) }
  const launchGStreamer = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
  vm.runInNewContext(javascript, {
    mainWindow: { webContents: publisher },
    ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
    desktopCapturer: { getSources: async () => [sourceWindow, sourceScreen] },
    screen: { getAllDisplays: () => [{ id: 2 }] },
    findGStreamerRuntime: () => 'runtime', resolveGStreamerSource, launchGStreamer, gstreamerSignalSchema,
    app: { getPath: () => 'data' }, path: { join: (...parts: string[]) => parts.join('/') },
    process: { resourcesPath: '' }, writeMainDiagnostic: vi.fn(),
  })
  const event = { sender: publisher, senderFrame: frame }
  const start = (id: string, sourceId: string) =>
    handlers.get('gstreamer-start')!(event, id, { sourceId, width: 1920, height: 1080, fps: 60 })
  const stop = (id: string) => handlers.get('gstreamer-stop')!(event, id)
  const firstId = 'ee4cdfd3-1d62-447c-a155-50348760fe30'
  const secondId = 'a87cdfd3-1d62-447c-a155-50348760fe30'
  expect(await start(firstId, sourceWindow.id)).toBe(true)
  const replacing = start(secondId, sourceScreen.id)
  await Promise.resolve()
  expect(first.stop).not.toHaveBeenCalled()
  const signal = { kind: 'watch', session: firstId }
  expect(handlers.get('gstreamer-signal')!(event, firstId, signal)).toBe(true)
  expect(first.signal).toHaveBeenCalledWith(signal)
  monitorReady(true)
  expect(await replacing).toBe(true)
  stop(firstId)
  expect(first.stop).toHaveBeenCalledOnce()
  expect(second.stop).not.toHaveBeenCalled()
  stop(secondId)
  expect(second.stop).toHaveBeenCalledOnce()
})
