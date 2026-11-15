import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NativeBoard from '../../components/collaboration/NativeBoard'
import { useWhiteboardStore } from '../../store/useWhiteboardStore'
import { useGameStore } from '../../store/useGameStore'
import { PeerManager } from '../../p2p/PeerManager'
import { getWhiteboardElements } from '../../collaboration/boardScene'
import { makeElement } from '../../collaboration/boardEditor'
vi.mock('../../store/useWhiteboardStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../../store/useWhiteboardStore')>()
  return { ...actual, useWhiteboardStore: Object.assign((selector?: any) => selector ? selector(actual.useWhiteboardStore.getState()) : actual.useWhiteboardStore.getState(), actual.useWhiteboardStore) }
})
const original = useGameStore.getState()
afterEach(() => { useWhiteboardStore.getState().reset(); useGameStore.setState(original); vi.restoreAllMocks() })
describe('native board interface', () => {
  it('renders every local drawing and file tool without external links', () => {
    const html = renderToStaticMarkup(<NativeBoard />)
    for (const label of ['Selecionar', 'Mover tela', 'Retângulo', 'Losango', 'Elipse', 'Seta', 'Linha', 'Desenhar', 'Texto', 'Borracha', 'Inserir imagem', 'Abrir quadro', 'Salvar quadro', 'Exportar SVG', 'Exportar PNG', 'Limpar quadro', 'Desfazer', 'Refazer', 'Cor do traço', 'Preenchimento']) expect(html).toContain(label)
    expect(html).not.toMatch(/excalidraw|href="https?:\/\//i)
    expect(html).toContain('Área de desenho')
  })
  it('commits a pointer gesture while offline without initializing any network client', () => {
    useGameStore.setState({ roomId: 'offline', isConnected: false })
    useWhiteboardStore.getState().selectRoom('offline')
    const element = makeElement('freedraw', { x: 300, y: 200 }, { width: 70, height: 70, points: [[0, 0], [70, 70]] })
    useWhiteboardStore.getState().apply('offline', { id: 'seed', actor: 'local', clock: 1, kind: 'element', element })
    const peer = vi.spyOn(PeerManager, 'getInstance')
    let tree: React.ReactElement<any>
    function Probe() { tree = NativeBoard(); return null }
    renderToStaticMarkup(<Probe />)
    const nodes: React.ReactElement<any>[] = []
    const visit = (node: any) => React.Children.forEach(node, child => { if (React.isValidElement(child)) { nodes.push(child); visit((child.props as any).children) } })
    visit(tree!)
    const svg = nodes.find(n => n.type === 'svg' && n.props.onPointerDown)!
    const target = { focus: vi.fn(), getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn() }
    const event = (x: number, y: number) => ({ currentTarget: target, clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault: vi.fn(), shiftKey: false })
    svg.props.onPointerDown(event(310, 210))
    svg.props.onPointerMove(event(380, 280))
    svg.props.onPointerUp(event(380, 280))
    expect(getWhiteboardElements(useWhiteboardStore.getState().document)).toMatchObject([{ type: 'freedraw', x: 370, y: 270, points: [[0, 0], [70, 70]] }])
    expect(peer).not.toHaveBeenCalled()
  })
})
