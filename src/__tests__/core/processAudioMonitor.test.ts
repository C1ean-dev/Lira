import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

const source = ts.createSourceFile('main.ts', readFileSync('electron/main.ts', 'utf8'), ts.ScriptTarget.Latest, true)
const declarations = source.statements.filter(node => {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.some(item => /^processAudioCapture/.test(item.name.getText(source)))
  return ts.isFunctionDeclaration(node) && ['startProcessAudioCapture', 'stopProcessAudioCapture'].includes(node.name?.text ?? '')
}).map(node => node.getText(source)).join('\n')
const javascript = ts.transpileModule(declarations, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function setup(resolveScreenAudioPoint = vi.fn(async (_id: string) => ({ x: -960, y: 540 }))) {
  const child = () => Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(), stderr: new EventEmitter(), kill: vi.fn(), killed: false,
  })
  const first = child()
  const second = child()
  const spawn = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second)
  const send = vi.fn()
  const controller = vm.runInNewContext(javascript + '\n;({ start: startProcessAudioCapture, stop: stopProcessAudioCapture })', {
    resolveScreenAudioPoint,
    spawn, fs: { existsSync: () => true },
    getOsRelease: () => '', getProcessAudioHelperPath: () => 'helper',
    process: { pid: 10 }, mainWindow: { isDestroyed: () => false, webContents: { send } },
    writeMainAudioDiagnostic: vi.fn(), emitProcessAudioStatus: vi.fn(), console,
    setTimeout: vi.fn(), setInterval: vi.fn(), clearTimeout: vi.fn(), clearInterval: vi.fn(),
  })
  return { ...controller, send, spawn, first, second }
}

describe('process audio during a monitor change', () => {
  it('ignores delayed PCM packets from the previously shared source', async () => {
    const { start, stop, first, second, send, spawn } = setup()
    const previous = start('window:123:0')
    first.stderr.emit('data', Buffer.from('READY'))
    expect(await previous).toMatchObject({ ok: true })
    const current = start('screen:2:0')
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(spawn).toHaveBeenLastCalledWith('helper', [
      '--source-id', 'screen:2:0', '--exclude-process-tree', '10', '--screen-point', '-960', '540',
    ], expect.anything())
    second.stderr.emit('data', Buffer.from('READY'))
    expect(await current).toMatchObject({ ok: true })
    const packet = Buffer.from([2, 2])
    first.stdout.emit('data', Buffer.from([1, 1]))
    second.stdout.emit('data', packet)
    expect(send).toHaveBeenCalledExactlyOnceWith('process-audio-data', packet)
    stop()
  })

  it('does not spawn the former monitor after its lookup resolves late', async () => {
    let finish!: (point: { x: number; y: number }) => void
    const resolvePoint = vi.fn((_id: string) => new Promise<{ x: number; y: number }>(resolve => { finish = resolve }))
    const { start, stop, first, spawn } = setup(resolvePoint)
    const lookup = start('screen:0:0')
    const current = start('window:42:0')
    first.stderr.emit('data', Buffer.from('READY'))
    expect(await current).toMatchObject({ ok: true })
    finish({ x: 500, y: 500 })
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(spawn).toHaveBeenCalledOnce()
    expect(await lookup).toMatchObject({ ok: false })
    stop()
  })
})
