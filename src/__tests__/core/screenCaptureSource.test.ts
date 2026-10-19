import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'

// Run the registered Electron handler with fake source enumeration, without opening Electron.
const source = ts.createSourceFile('main.ts', readFileSync('electron/main.ts', 'utf8'), ts.ScriptTarget.Latest, true)
let handlerSource = ''
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'setDisplayMediaRequestHandler') {
    handlerSource = node.arguments[0].getText(source)
  }
  ts.forEachChild(node, visit)
}
visit(source)
const javascript = ts.transpileModule(`const handler = ${handlerSource}; handler`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

async function select(sources: Array<{ id: string; name: string }>, wantedId: string | null, wantedName = 'Google Chrome - Video') {
  const handler = vm.runInNewContext(javascript, {
    pendingScreenCapture: { sourceId: wantedId, sourceName: wantedName, withAudio: false },
    lastSelectedSourceId: null, lastSelectedSourceName: null, lastSelectedSourceTime: 0,
    desktopCapturer: { getSources: vi.fn(async () => sources) },
    console: { info: vi.fn(), warn: vi.fn() },
  })
  return new Promise<any>(resolve => handler({ audio: false }, resolve))
}

describe('Electron desktop capture source selection', () => {
  const desktop = { id: 'screen:0:0', name: 'Desktop' }
  const selected = { id: 'window:selected', name: 'Google Chrome - Video' }
  it('captures the exact selected window even after its title changes', async () => {
    expect((await select([desktop, { ...selected, name: 'Different title' }], selected.id)).video.id).toBe(selected.id)
  })
  it.each([
    { sources: [desktop] },
    { sources: [desktop, { id: 'window:other', name: selected.name }] },
    { sources: [desktop, { id: 'window:other', name: 'Google Chrome - Other video' }] },
    { sources: [] },
  ])('refuses a missing explicit source instead of picking another window or screen (%j)', async ({ sources }) => {
    expect((await select(sources, selected.id)).video).toBeUndefined()
  })
  it('also refuses a missing selected monitor', async () => {
    expect((await select([desktop, selected], 'screen:missing')).video).toBeUndefined()
  })
  it('keeps the default capture behavior when no source was selected', async () => {
    expect((await select([desktop], null)).video.id).toBe(desktop.id)
  })
})
