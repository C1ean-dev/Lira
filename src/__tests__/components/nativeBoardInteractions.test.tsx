import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import NativeBoard from '../../components/collaboration/NativeBoard'
import { useGameStore } from '../../store/useGameStore'
import { useWhiteboardStore } from '../../store/useWhiteboardStore'
import { getWhiteboardElements } from '../../collaboration/boardScene'
import { LOCAL_BOARD_POINTER, useBoardPointerStore } from '../../store/useBoardPointerStore'
import { PeerManager } from '../../p2p/PeerManager'

const hooks = vi.hoisted(() => ({ slots: [] as any[], index: 0 }))
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual,
    useEffect: () => {},
    useState(initial: any) { const i = hooks.index++; if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial; return [hooks.slots[i], (v: any) => { hooks.slots[i] = typeof v === 'function' ? v(hooks.slots[i]) : v }] },
    useRef(initial: any) { const i = hooks.index++; if (!(i in hooks.slots)) hooks.slots[i] = { current: initial }; return hooks.slots[i] },
  }
})
vi.mock('../../components/collaboration/downloadText', () => ({ downloadText: vi.fn() }))
import { downloadText } from '../../components/collaboration/downloadText'
vi.mock('../../store/useWhiteboardStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../../store/useWhiteboardStore')>()
  return { useWhiteboardStore: Object.assign((select?: any) => select ? select(actual.useWhiteboardStore.getState()) : actual.useWhiteboardStore.getState(), actual.useWhiteboardStore) }
})
vi.mock('../../store/useGameStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../../store/useGameStore')>()
  return { ...actual, useGameStore: Object.assign((select: any) => select(actual.useGameStore.getState()), actual.useGameStore) }
})
const game = useGameStore.getState()
beforeEach(() => { hooks.slots = []; hooks.index = 0; useGameStore.setState({ roomId: 'local', isConnected: false }); useWhiteboardStore.getState().selectRoom('local') })
afterEach(() => { useWhiteboardStore.getState().reset(); useGameStore.setState(game); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function render() {
  hooks.index = 0
  const tree = NativeBoard(), nodes: React.ReactElement<any>[] = []
  const visit = (node: any) => React.Children.forEach(node, child => { if (React.isValidElement(child)) { nodes.push(child); visit((child.props as any).children) } })
  visit(tree)
  return {
    nodes, svg: nodes.find(n => n.type === 'svg' && n.props.onPointerDown)!, root: tree,
    button: (label: string) => nodes.find(n => n.type === 'button' && n.props['aria-label'] === label)!,
  }
}
const target = { focus: vi.fn(), setPointerCapture: vi.fn(), hasPointerCapture: () => true, releasePointerCapture: vi.fn(), getBoundingClientRect: () => ({ left: 0, top: 0 }) }
const pointer = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, shiftKey: false, currentTarget: target, preventDefault: vi.fn() })
function draw(tool: string, start = [300, 200], end = [400, 250]) {
  render().button(tool).props.onClick()
  const { svg } = render()
  svg.props.onPointerDown(pointer(start[0], start[1])); svg.props.onPointerMove(pointer(end[0], end[1])); svg.props.onPointerUp(pointer(end[0], end[1]))
}
const visible = () => getWhiteboardElements(useWhiteboardStore.getState().document).filter(e => !e.isDeleted)
describe('local editor interactions', () => {
  it('switches the canvas background with the theme and exports the same dark background', () => {
    const toggleTheme = () => render().nodes.find(n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children[0] === 'Tema ')!.props.onClick()
    expect(render().svg.props.style.backgroundColor).toBe('#ffffff')
    toggleTheme()
    expect(render().svg.props.style.backgroundColor).toBe('#18181b')
    expect(useWhiteboardStore.getState().dark).toBe(true)
    render().nodes.find(n => n.type === 'button' && n.props.children === 'Exportar SVG')!.props.onClick()
    expect(downloadText).toHaveBeenLastCalledWith('quadro.svg', expect.stringContaining('fill="#18181b"'), 'image/svg+xml')
    hooks.slots = []
    expect(render().svg.props.style.backgroundColor).toBe('#18181b')
    toggleTheme()
    expect(render().svg.props.style.backgroundColor).toBe('#ffffff')
    expect(useWhiteboardStore.getState().dark).toBe(false)
  })
  it('keeps default strokes legible in either theme without editing the saved drawing', () => {
    draw('Retângulo')
    const before = structuredClone(visible())
    const toggleTheme = () => render().nodes.find(n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children[0] === 'Tema ')!.props.onClick()
    const shapeMarkup = () => render().nodes.find(n => n.props.dangerouslySetInnerHTML)?.props.dangerouslySetInnerHTML.__html
    toggleTheme()
    expect(shapeMarkup()).toContain('stroke="#f1f5f9"')
    expect(visible()).toEqual(before)
    toggleTheme()
    expect(shapeMarkup()).toContain('stroke="#1e1e1e"')
  })
  it('opens in selection mode and selects an existing object by clicking without creating an edit', () => {
    draw('Retângulo')
    hooks.slots = []
    const opened = render()
    expect(opened.button('Selecionar').props['aria-pressed']).toBe(true)
    const clock = useWhiteboardStore.getState().document.clock
    opened.svg.props.onPointerDown(pointer(320, 220)); opened.svg.props.onPointerUp(pointer(320, 220))
    expect(render().button('Duplicar seleção')).toBeDefined()
    expect(visible()).toHaveLength(1)
    expect(useWhiteboardStore.getState().document.clock).toBe(clock)
  })
  it('selects a freehand drawing after creation and drags the whole object', () => {
    draw('Desenhar')
    expect(render().button('Selecionar').props['aria-pressed']).toBe(true)
    const { svg } = render()
    svg.props.onPointerDown(pointer(350, 225)); svg.props.onPointerMove(pointer(380, 265)); svg.props.onPointerUp(pointer(380, 265))
    expect(visible()).toMatchObject([{ type: 'freedraw', x: 330, y: 240, points: [[0, 0], [100, 50]] }])
    expect(visible()).toHaveLength(1)
    render().button('Desfazer').props.onClick()
    expect(visible()).toMatchObject([{ x: 300, y: 200 }])
  })
  it('draws a rectangle, moves it, then undoes and redoes the move', () => {
    draw('Retângulo')
    expect(visible()).toMatchObject([{ type: 'rectangle', x: 300, y: 200, width: 100, height: 50 }])
    const { svg } = render()
    svg.props.onPointerDown(pointer(320, 220)); svg.props.onPointerMove(pointer(350, 260)); svg.props.onPointerUp(pointer(350, 260))
    expect(visible()).toMatchObject([{ x: 330, y: 240 }])
    render().button('Desfazer').props.onClick()
    expect(visible()).toMatchObject([{ x: 300, y: 200 }])
    render().button('Refazer').props.onClick()
    expect(visible()).toMatchObject([{ x: 330, y: 240 }])
  })
  it('creates every shape with the native tools and erases without losing undo', () => {
    for (const tool of ['Losango', 'Elipse', 'Seta', 'Linha']) draw(tool)
    expect(visible().map(e => e.type).sort()).toEqual(['arrow', 'diamond', 'ellipse', 'line'])
    draw('Borracha', [350, 225], [350, 225])
    expect(visible().length).toBeLessThan(4)
    render().button('Desfazer').props.onClick()
    expect(visible()).toHaveLength(4)
  })
  it('previews erasing with reduced opacity and only deletes on release', () => {
    draw('Retângulo')
    render().button('Borracha').props.onClick()
    const { svg } = render(), clock = useWhiteboardStore.getState().document.clock
    svg.props.onPointerDown(pointer(350, 225))
    expect(visible()).toHaveLength(1)
    expect(useWhiteboardStore.getState().document.clock).toBe(clock)
    const preview = render().nodes.find(n => n.props.dangerouslySetInnerHTML)!
    expect(preview.props.dangerouslySetInnerHTML.__html).toContain('opacity="0.2"')
    svg.props.onPointerUp(pointer(350, 225))
    expect(visible()).toEqual([])
    render().button('Desfazer').props.onClick()
    expect(visible()).toHaveLength(1)
  })
  it('restores the eraser preview when a gesture is canceled', () => {
    draw('Retângulo')
    render().button('Borracha').props.onClick()
    const { svg } = render(), clock = useWhiteboardStore.getState().document.clock
    svg.props.onPointerDown(pointer(350, 225)); svg.props.onPointerCancel()
    expect(visible()).toHaveLength(1)
    expect(useWhiteboardStore.getState().document.clock).toBe(clock)
    expect(render().nodes.find(n => n.props.dangerouslySetInnerHTML)!.props.dangerouslySetInnerHTML.__html).toContain('opacity="1"')
  })
  it('uses the laser without creating drawing operations or history entries', () => {
    render().button('Ponteiro laser').props.onClick()
    const { svg } = render(), clock = useWhiteboardStore.getState().document.clock
    svg.props.onPointerDown(pointer(300, 200)); svg.props.onPointerMove(pointer(400, 250)); svg.props.onPointerUp(pointer(400, 250))
    expect(useWhiteboardStore.getState().document.clock).toBe(clock)
    expect(visible()).toEqual([])
    expect(render().button('Desfazer').props.disabled).toBe(true)
  })
  it('tracks the eraser cursor on hover and clears its effect when leaving the canvas', () => {
    render().button('Borracha').props.onClick()
    const { svg } = render()
    svg.props.onPointerMove(pointer(320, 220))
    expect(useBoardPointerStore.getState().pointers[LOCAL_BOARD_POINTER]).toMatchObject({ kind: 'eraser', points: [{ x: 320, y: 220 }] })
    expect(svg.props.style.cursor).toBe('none')
    svg.props.onPointerLeave()
    expect(useBoardPointerStore.getState().pointers[LOCAL_BOARD_POINTER]).toBeUndefined()
  })
  it.each(['Borracha', 'Ponteiro laser'])('only leaves a %s trail while the mouse button is held', label => {
    render().button(label).props.onClick()
    const { svg } = render()
    svg.props.onPointerMove(pointer(300, 200)); svg.props.onPointerMove(pointer(320, 220))
    expect(useBoardPointerStore.getState().pointers[LOCAL_BOARD_POINTER].points).toHaveLength(1)
    svg.props.onPointerDown(pointer(330, 230)); svg.props.onPointerMove(pointer(350, 250))
    expect(useBoardPointerStore.getState().pointers[LOCAL_BOARD_POINTER].points).toHaveLength(2)
    svg.props.onPointerUp(pointer(350, 250)); svg.props.onPointerMove(pointer(370, 270)); svg.props.onPointerMove(pointer(390, 290))
    expect(useBoardPointerStore.getState().pointers[LOCAL_BOARD_POINTER].points).toHaveLength(1)
    svg.props.onPointerDown(pointer(400, 300)); svg.props.onPointerMove(pointer(420, 320))
    expect(useBoardPointerStore.getState().pointers[LOCAL_BOARD_POINTER].points).toHaveLength(2)
    expect(useBoardPointerStore.getState().pointers[LOCAL_BOARD_POINTER].points[0]).toMatchObject({ x: 400, y: 300 })
  })
  it('only broadcasts laser positions during a pressed gesture and sends a stop on release', () => {
    useGameStore.setState({ isConnected: true })
    useWhiteboardStore.setState({ synchronized: true })
    const broadcast = vi.fn()
    vi.spyOn(PeerManager, 'getInstance').mockReturnValue({ broadcast, getPeerId: () => 'self' } as any)
    render().button('Ponteiro laser').props.onClick()
    const { svg } = render()
    svg.props.onPointerMove(pointer(300, 200)); svg.props.onPointerMove(pointer(320, 220))
    expect(broadcast).not.toHaveBeenCalled()
    svg.props.onPointerDown(pointer(330, 230))
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'WHITEBOARD_POINTER', payload: expect.objectContaining({ point: { x: 330, y: 230 } }) }))
    svg.props.onPointerUp(pointer(330, 230))
    expect(broadcast).toHaveBeenLastCalledWith(expect.objectContaining({ payload: expect.objectContaining({ point: null }) }))
    const calls = broadcast.mock.calls.length
    svg.props.onPointerMove(pointer(400, 300))
    expect(broadcast).toHaveBeenCalledTimes(calls)
  })
  it('compacts the document when clearing the room and still supports undo', () => {
    draw('Retângulo')
    render().nodes.find(n => n.type === 'button' && n.props.children === 'Limpar quadro')!.props.onClick()
    render().nodes.find(n => n.type === 'button' && n.props.children === 'Sim, limpar')!.props.onClick()
    expect(Object.values(useWhiteboardStore.getState().document.operations).map(op => op.kind)).toEqual(['clear'])
    expect(visible()).toEqual([])
    render().button('Desfazer').props.onClick()
    expect(visible()).toMatchObject([{ type: 'rectangle' }])
  })
  it('edits text locally through the inline editor', () => {
    render().button('Texto').props.onClick()
    render().svg.props.onPointerDown(pointer(300, 200))
    render().nodes.find(n => n.type === 'textarea')!.props.onChange({ target: { value: 'Sala offline' } })
    render().nodes.find(n => n.type === 'textarea')!.props.onBlur()
    expect(visible()).toMatchObject([{ type: 'text', text: 'Sala offline', x: 300, y: 200 }])
    expect(render().button('Selecionar').props['aria-pressed']).toBe(true)
    const { svg } = render()
    svg.props.onPointerDown(pointer(310, 210)); svg.props.onPointerMove(pointer(340, 250)); svg.props.onPointerUp(pointer(340, 250))
    expect(visible()).toMatchObject([{ type: 'text', text: 'Sala offline', x: 330, y: 240 }])
  })
  it('resizes through the visible handle and duplicates the selection', () => {
    draw('Retângulo')
    const { svg } = render(), down = pointer(400, 250)
    svg.props.onPointerDown({ ...down, target: { getAttribute: () => 'resize' } })
    svg.props.onPointerMove(pointer(440, 280)); svg.props.onPointerUp(pointer(440, 280))
    expect(visible()).toMatchObject([{ width: 140, height: 80 }])
    render().button('Duplicar seleção').props.onClick()
    expect(visible()).toHaveLength(2)
  })
  it('saves and exports actual local drawing data from the menu', () => {
    draw('Retângulo')
    const nodes = render().nodes
    nodes.find(n => n.type === 'button' && n.props.children === 'Salvar quadro')!.props.onClick()
    expect(downloadText).toHaveBeenCalledWith('quadro.lira.json', expect.any(String), 'application/json')
    const saved = JSON.parse(vi.mocked(downloadText).mock.calls.at(-1)![1])
    expect(saved.elements).toMatchObject([{ type: 'rectangle', width: 100, height: 50 }])
    nodes.find(n => n.type === 'button' && n.props.children === 'Exportar SVG')!.props.onClick()
    expect(downloadText).toHaveBeenLastCalledWith('quadro.svg', expect.stringContaining('<rect width="100" height="50"'), 'image/svg+xml')
  })
  it('imports a file from the computer and preserves the change in local history', async () => {
    draw('Retângulo')
    const saved = { type: 'lira-whiteboard', elements: [{ ...visible()[0], id: 'new', type: 'ellipse' }], files: {} }
    vi.stubGlobal('window', { confirm: () => true })
    const input = render().nodes.find(n => n.type === 'input' && n.props['aria-label'] === 'Abrir arquivo de quadro')!
    input.props.onChange({ target: { files: [{ size: 1000, text: async () => JSON.stringify(saved) }], value: '' } })
    await vi.waitFor(() => expect(visible()).toMatchObject([{ id: 'new', type: 'ellipse' }]))
    render().button('Desfazer').props.onClick()
    expect(visible()).toMatchObject([{ type: 'rectangle' }])
  })
  it('exports PNG by rendering the standalone local SVG, with no remote resource requests', async () => {
    draw('Retângulo')
    const drawImage = vi.fn(), link = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('Image', class { src = ''; width = 200; height = 100; async decode() {} })
    vi.stubGlobal('document', { createElement: (tag: string) => tag === 'canvas' ? { getContext: () => ({ drawImage }), toBlob: (callback: any) => callback(new Blob(['image'])) } : link, body: { appendChild: vi.fn() } })
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:local')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    render().nodes.find(n => n.type === 'button' && n.props.children === 'Exportar PNG')!.props.onClick()
    await vi.waitFor(() => expect(link.click).toHaveBeenCalledOnce())
    expect(drawImage).toHaveBeenCalledOnce()
    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(link.download).toBe('quadro.png')
  })
})
