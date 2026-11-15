import React, { useEffect, useRef, useState } from 'react'
import { MousePointer2, Hand, Square, Diamond, Circle, ArrowUpRight, Minus, Pencil, Type, Eraser, ImagePlus, Menu, Undo2, Redo2, Minus as ZoomOut, Plus, Copy, Trash2, ArrowUp, ArrowDown, Lock, Unlock, RotateCw, Wand2 } from 'lucide-react'
import { useWhiteboardStore } from '../../store/useWhiteboardStore'
import { useGameStore } from '../../store/useGameStore'
import { PeerManager } from '../../p2p/PeerManager'
import { sendWhiteboardOperation } from '../../services/whiteboardNetwork'
import { getWhiteboardElements, getWhiteboardFiles } from '../../collaboration/boardScene'
import { BoardHistory, makeElement, drawElement, resizeElement, hitElement, elementBounds, screenToBoard, revision, type BoardElement, type BoardFile, type BoardPoint, type BoardTool, type BoardView } from '../../collaboration/boardEditor'
import { boardSvg, elementSvg, parseBoardFile } from '../../collaboration/boardFile'
import { validWhiteboardOperation } from '../../collaboration/whiteboard'
import { generateUUID } from '../../utils/uuid'
import { downloadText } from './downloadText'
import { BoardPointerOverlay } from './BoardPointerOverlay'
import { LOCAL_BOARD_POINTER, useBoardPointerStore } from '../../store/useBoardPointerStore'
import { sendBoardPointer } from '../../services/boardPointerNetwork'
import './whiteboard.css'

const tools: [BoardTool, string, React.ElementType, string][] = [
  ['selection', 'Selecionar', MousePointer2, 'V'], ['hand', 'Mover tela', Hand, 'H'], ['rectangle', 'Retângulo', Square, 'R'],
  ['diamond', 'Losango', Diamond, 'D'], ['ellipse', 'Elipse', Circle, 'E'], ['arrow', 'Seta', ArrowUpRight, 'A'],
  ['line', 'Linha', Minus, 'L'], ['freedraw', 'Desenhar', Pencil, 'P'], ['text', 'Texto', Type, 'T'], ['eraser', 'Borracha', Eraser, 'X'],
  ['laser', 'Ponteiro laser', Wand2, 'K'],
]
const palette = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#7048e8', '#f08c00']
type Gesture = { kind: 'draw' | 'move' | 'resize' | 'rotate' | 'pan' | 'erase' | 'marquee' | 'laser'; start: BoardPoint; screen: BoardPoint; view: BoardView; before: BoardElement[]; draft: BoardElement[]; shape?: BoardElement }

export default function NativeBoard() {
  const { document: doc, synchronized, storageError, dark, setDark } = useWhiteboardStore()
  const connected = useGameStore(s => s.isConnected)
  const ready = !connected || synchronized
  const [tool, setTool] = useState<BoardTool>('selection')
  const [style, setStyle] = useState<Partial<BoardElement>>({ strokeColor: '#1e1e1e', backgroundColor: 'transparent', strokeWidth: 2, fontSize: 24, opacity: 100, strokeStyle: 'solid' })
  const [view, setView] = useState<BoardView>({ x: 0, y: 0, zoom: 1 })
  const [selection, setSelection] = useState<string[]>([])
  const [draft, setDraft] = useState<BoardElement[]>([])
  const [marquee, setMarquee] = useState<BoardElement | null>(null)
  const [textEdit, setTextEdit] = useState<{ element: BoardElement; value: string } | null>(null)
  const [background, setBackground] = useState(dark ? '#18181b' : '#ffffff')
  const [grid, setGrid] = useState(false)
  const themeStroke = (color = '#1e1e1e') => dark && color.toLowerCase() === '#1e1e1e' ? '#f1f5f9' : color
  const themeElement = (element: BoardElement): BoardElement => ({ ...element, strokeColor: themeStroke(element.strokeColor) })
  const toggleTheme = () => { setDark(!dark); setBackground(dark ? '#ffffff' : '#18181b') }
  const [confirmClear, setConfirmClear] = useState(false), [error, setError] = useState('')
  const [, refresh] = useState(0)
  const history = useRef(new BoardHistory()), gesture = useRef<Gesture | null>(null), space = useRef(false)
  const svg = useRef<SVGSVGElement>(null), openFile = useRef<HTMLInputElement>(null), imageFile = useRef<HTMLInputElement>(null), menu = useRef<HTMLDetailsElement>(null)
  const elements = getWhiteboardElements(doc), files = getWhiteboardFiles(doc)
  const visible = elements.filter(e => !e.isDeleted), selected = visible.filter(e => selection.includes(e.id))
  const combined = [...elements.filter(e => !draft.some(d => d.id === e.id)), ...draft.map(e =>
    gesture.current?.kind === 'erase' ? { ...e, isDeleted: false, opacity: (e.opacity ?? 100) * .2 } : e)].filter(e => !e.isDeleted)
  const localPointerSequence = useRef(0)
  const clearPointer = () => {
    useBoardPointerStore.getState().remove(LOCAL_BOARD_POINTER)
    if (gesture.current?.kind === 'laser') sendBoardPointer(null)
  }
  const cancelGesture = () => { clearPointer(); gesture.current = null; setDraft([]); setMarquee(null) }
  useEffect(() => {
    window.addEventListener('blur', cancelGesture)
    return () => { window.removeEventListener('blur', cancelGesture); cancelGesture() }
  }, [tool])
  const updatePointer = (point: BoardPoint, tracing = false) => {
    if (tool !== 'eraser' && tool !== 'laser') return
    const roomId = useWhiteboardStore.getState().roomId
    const pointers = useBoardPointerStore.getState()
    pointers.selectRoom(roomId)
    localPointerSequence.current = Math.max(localPointerSequence.current + 1, Date.now())
    pointers.update(LOCAL_BOARD_POINTER, point, localPointerSequence.current, Date.now(), tool, '', tracing)
    if (tool === 'laser' && tracing) sendBoardPointer(point)
  }
  const current = () => getWhiteboardElements(useWhiteboardStore.getState().document)
  const base = () => {
    const game = useGameStore.getState()
    const actor = game.isConnected ? PeerManager.getInstance().getPeerId() || game.localPlayer.id : game.localPlayer.id
    return { id: `${actor}:${generateUUID()}`, actor, clock: useWhiteboardStore.getState().document.clock + 1 }
  }
  const commit = (changes: BoardElement[], record = true) => {
    if (!ready || !changes.length) return
    const before = current().filter(e => changes.some(c => c.id === e.id))
    const accepted: BoardElement[] = []
    for (const element of changes) {
      const previous = current().find(e => e.id === element.id)
      const next = { ...element, version: Math.max(element.version, previous?.version || 0) + 1, versionNonce: revision() }
      if (sendWhiteboardOperation({ ...base(), kind: 'element', element: next })) accepted.push(next)
      else setError('Não foi possível salvar a alteração. Exporte o quadro para preservar o desenho; o limite é de 1.000 objetos e imagens de até 2 MB.')
    }
    if (record && accepted.length) history.current.record(before.filter(e => accepted.some(a => a.id === e.id)), accepted)
    refresh(n => n + 1)
  }
  const changeSelected = (patch: Partial<BoardElement>) => {
    setStyle(s => ({ ...s, ...patch }))
    commit(selected.filter(e => !e.locked).map(e => ({ ...e, ...patch })))
  }
  const undo = () => commit(history.current.undo(current()), false)
  const redo = () => commit(history.current.redo(current()), false)
  const remove = () => { commit(selected.filter(e => !e.locked).map(e => ({ ...e, isDeleted: true }))); setSelection([]) }
  const duplicate = () => {
    const copies = selected.map(e => ({ ...structuredClone(e), id: generateUUID(), x: e.x + 24, y: e.y + 24, locked: false, index: `z${Date.now()}${generateUUID()}` }))
    commit(copies); setSelection(copies.map(e => e.id))
  }
  const clear = () => {
    if (!ready) return
    const before = current(), retainedFiles = Object.values(getWhiteboardFiles(useWhiteboardStore.getState().document))
    if (!sendWhiteboardOperation({ ...base(), kind: 'clear' })) { setError('Não foi possível limpar o quadro.'); return }
    // Retain local image bytes so undo can restore images without any download.
    for (const file of retainedFiles) sendWhiteboardOperation({ ...base(), kind: 'file', file })
    history.current.record(before, [])
    setSelection([]); setConfirmClear(false); refresh(n => n + 1)
  }
  const fit = () => {
    const box = svg.current?.getBoundingClientRect()
    if (!box || !visible.length) { setView({ x: 0, y: 0, zoom: 1 }); return }
    const bounds = visible.map(elementBounds), left = Math.min(...bounds.map(b => b.x)), top = Math.min(...bounds.map(b => b.y))
    const w = Math.max(...bounds.map(b => b.x + b.width)) - left, h = Math.max(...bounds.map(b => b.y + b.height)) - top
    const zoom = Math.max(.1, Math.min(2, (box.width - 100) / Math.max(1, w), (box.height - 100) / Math.max(1, h)))
    setView({ x: (box.width - w * zoom) / 2 - left * zoom, y: (box.height - h * zoom) / 2 - top * zoom, zoom })
  }
  const zoomAt = (factor: number, at?: BoardPoint) => {
    setView(v => {
      const box = svg.current?.getBoundingClientRect(), point = at || { x: (box?.width || 800) / 2, y: (box?.height || 600) / 2 }
      const z = Math.max(.1, Math.min(8, v.zoom * factor)), world = screenToBoard(point, v)
      return { x: point.x - world.x * z, y: point.y - world.y * z, zoom: z }
    })
  }
  const pointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - box.left, y: e.clientY - box.top }
  }
  const pointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    e.preventDefault(); e.currentTarget.focus(); e.currentTarget.setPointerCapture(e.pointerId)
    const screen = pointer(e), p = screenToBoard(screen, view)
    const start: Gesture = { kind: 'draw', start: p, screen, view, before: [], draft: [] }
    if (tool === 'hand' || space.current || e.button === 1) { start.kind = 'pan'; gesture.current = start; return }
    if (tool === 'laser') {
      start.kind = 'laser'; gesture.current = start
      useBoardPointerStore.getState().remove(LOCAL_BOARD_POINTER)
      updatePointer(p, true); return
    }
    if (!ready) return
    const hit = [...visible].reverse().find(el => hitElement(el, p, 6 / view.zoom))
    const handle = (e.target as SVGElement | undefined)?.getAttribute?.('data-board-handle')
    if (handle && selected.length === 1 && !selected[0].locked) {
      start.kind = handle === 'rotate' ? 'rotate' : 'resize'; start.before = structuredClone(selected); start.draft = structuredClone(selected)
    } else if (tool === 'selection') {
      if (hit) {
        const ids = e.shiftKey ? selection.includes(hit.id) ? selection.filter(id => id !== hit.id) : [...selection, hit.id] : selection.includes(hit.id) ? selection : [hit.id]
        setSelection(ids); start.kind = 'move'; start.before = structuredClone(visible.filter(el => ids.includes(el.id) && !el.locked)); start.draft = start.before
      } else { setSelection([]); start.kind = 'marquee'; start.shape = makeElement('rectangle', p) }
    } else if (tool === 'eraser') {
      start.kind = 'erase'
      if (hit && !hit.locked) { start.before = [hit]; start.draft = [{ ...hit, isDeleted: true }]; setDraft(start.draft) }
    } else if (tool === 'text') {
      const element = hit?.type === 'text' && !hit.locked ? hit : makeElement('text', p, style)
      setTextEdit({ element, value: element.text || '' }); return
    } else if (tool !== 'image') {
      start.shape = makeElement(tool as BoardElement['type'], p, style)
      if (tool === 'freedraw') start.shape.points = [[0, 0]]
      start.draft = [start.shape]; setDraft(start.draft); setSelection([])
    }
    gesture.current = start
    if (start.kind === 'erase') { useBoardPointerStore.getState().remove(LOCAL_BOARD_POINTER); updatePointer(p, true) }
  }
  const pointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    updatePointer(screenToBoard(pointer(e), g?.view || view), g?.kind === 'erase' || g?.kind === 'laser')
    if (!g) return
    const screen = pointer(e), p = screenToBoard(screen, g.view), dx = p.x - g.start.x, dy = p.y - g.start.y
    if (g.kind === 'pan') { setView({ ...g.view, x: g.view.x + screen.x - g.screen.x, y: g.view.y + screen.y - g.screen.y }); return }
    if (g.kind === 'move') g.draft = g.before.map(el => ({ ...el, x: el.x + dx, y: el.y + dy }))
    if (g.kind === 'resize') g.draft = g.before.map(el => resizeElement(el, el.width + dx, e.shiftKey ? (el.width + dx) * el.height / Math.max(1, el.width) : el.height + dy))
    if (g.kind === 'rotate') g.draft = g.before.map(el => {
      const b = elementBounds(el), angle = Math.atan2(p.y - b.y - b.height / 2, p.x - b.x - b.width / 2) + Math.PI / 2
      return { ...el, angle: e.shiftKey ? Math.round(angle / (Math.PI / 12)) * Math.PI / 12 : angle }
    })
    if (g.kind === 'erase') {
      for (const el of visible) if (!el.locked && !g.draft.some(d => d.id === el.id) && hitElement(el, p, 8 / view.zoom)) { g.before.push(el); g.draft.push({ ...el, isDeleted: true }) }
    }
    if (g.kind === 'marquee' && g.shape) { setMarquee(drawElement(g.shape, p)); return }
    if (g.kind === 'draw' && g.shape) {
      if (g.shape.type === 'freedraw') {
        const shape = g.draft[0], points = shape.points || [], last = points[points.length - 1]
        if (points.length < 10000 && (!last || Math.hypot(dx - last[0], dy - last[1]) > .6 / view.zoom)) points.push([dx, dy])
        const bounds = elementBounds({ ...shape, points }); g.draft = [{ ...shape, points, width: bounds.width, height: bounds.height }]
      } else g.draft = [drawElement(g.shape, p, e.shiftKey)]
    }
    setDraft([...g.draft])
  }
  const pointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current
    if (!g) return
    if (g.kind === 'marquee' && g.shape) {
      const bounds = drawElement(g.shape, screenToBoard(pointer(e), g.view))
      setSelection(visible.filter(el => { const b = elementBounds(el); return b.x >= bounds.x && b.y >= bounds.y && b.x + b.width <= bounds.x + bounds.width && b.y + b.height <= bounds.y + bounds.height }).map(e => e.id))
    } else if (g.kind !== 'pan' && g.draft.length && (g.kind === 'draw' || g.kind === 'erase' || JSON.stringify(g.before) !== JSON.stringify(g.draft))) {
      commit(g.draft)
      if (g.kind === 'draw') { setSelection(g.draft.map(e => e.id)); setTool('selection') }
    }
    if (g.kind === 'laser') sendBoardPointer(null)
    if (g.kind === 'laser' || g.kind === 'erase') updatePointer(screenToBoard(pointer(e), g.view), false)
    gesture.current = null; setDraft([]); setMarquee(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }
  const finishText = () => {
    if (!textEdit) return
    if (textEdit.value.trim()) {
      const size = textEdit.element.fontSize || 24, lines = textEdit.value.split('\n')
      commit([{ ...textEdit.element, text: textEdit.value, width: Math.max(...lines.map(l => l.length), 1) * size * .65, height: lines.length * size * 1.25 }])
      setSelection([textEdit.element.id]); setTool('selection')
    }
    setTextEdit(null)
  }
  const safe = async (action: () => void | Promise<void>) => { if (menu.current) menu.current.open = false; try { await action() } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir a ação.') } }
  const save = () => downloadText('quadro.lira.json', JSON.stringify({ type: 'lira-whiteboard', version: 1, elements: current(), files: getWhiteboardFiles(useWhiteboardStore.getState().document) }), 'application/json')
  const exportImage = async (format: 'svg' | 'png') => {
    const content = boardSvg(current().map(themeElement), getWhiteboardFiles(useWhiteboardStore.getState().document), background)
    if (format === 'svg') { downloadText('quadro.svg', content, 'image/svg+xml'); return }
    const url = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' }))
    try {
      const image = new Image(); image.src = url; await image.decode()
      const canvas = document.createElement('canvas'), scale = Math.min(1, 8192 / Math.max(image.width, image.height))
      canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext('2d'); if (!context) throw new Error('Exportação de imagem indisponível.')
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Não foi possível exportar a imagem.')), 'image/png'))
      const pngUrl = URL.createObjectURL(png), link = document.createElement('a'); link.href = pngUrl; link.download = 'quadro.png'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(pngUrl), 1000)
    } finally { URL.revokeObjectURL(url) }
  }
  const addImage = async (file: File) => {
    if (!ready) return
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 1_450_000) throw new Error('Escolha PNG, JPEG, WebP ou GIF de até 1,4 MB.')
    const dataURL = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(file) })
    const image = new Image(); image.src = dataURL; await image.decode()
    const boardFile: BoardFile = { id: generateUUID(), mimeType: file.type, dataURL, created: Date.now() }
    if (!sendWhiteboardOperation({ ...base(), kind: 'file', file: boardFile })) throw new Error('Não foi possível salvar a imagem.')
    const box = svg.current?.getBoundingClientRect(), p = screenToBoard({ x: (box?.width || 800) / 2, y: (box?.height || 600) / 2 }, view)
    const scale = Math.min(1, 400 / Math.max(image.width, image.height)), width = image.width * scale, height = image.height * scale
    const element = makeElement('image', { x: p.x - width / 2, y: p.y - height / 2 }, { ...style, width, height, fileId: boardFile.id })
    commit([element]); setSelection([element.id]); setTool('selection')
  }
  const load = async (file: File) => {
    if (!ready) return
    if (file.size > 20_000_000) throw new Error('Arquivo muito grande.')
    const imported = parseBoardFile(await file.text())
    if (!window.confirm('Substituir o desenho atual pelo arquivo?')) return
    for (const boardFile of Object.values(imported.files)) if (!sendWhiteboardOperation({ ...base(), kind: 'file', file: boardFile })) throw new Error('Não foi possível salvar as imagens do arquivo.')
    const ids = new Set(imported.elements.map(e => e.id))
    commit([...current().filter(e => !ids.has(e.id)).map(e => ({ ...e, isDeleted: true })), ...imported.elements]); setSelection([])
  }
  const keyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if ((e.target as HTMLElement).closest?.('input,textarea,select')) return
    const key = e.key.toLowerCase(), command = e.ctrlKey || e.metaKey
    if (e.code === 'Space') { space.current = true; e.preventDefault(); return }
    if (command && key === 's') { e.preventDefault(); save(); return }
    if (command && key === 'o') { e.preventDefault(); openFile.current?.click(); return }
    if (command && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
    if (command && key === 'y') { e.preventDefault(); redo(); return }
    if (command && key === 'a') { e.preventDefault(); setSelection(visible.map(e => e.id)); setTool('selection'); return }
    if (command && key === 'd') { e.preventDefault(); duplicate(); return }
    if (key === 'delete' || key === 'backspace') { e.preventDefault(); remove(); return }
    if (key === 'escape') { gesture.current = null; setDraft([]); setSelection([]); setTextEdit(null); setTool('selection'); return }
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { e.preventDefault(); const step = e.shiftKey ? 10 : 1; commit(selected.filter(e => !e.locked).map(el => ({ ...el, x: el.x + (key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0), y: el.y + (key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0) }))); return }
    if (!command) { const match = tools.find(t => t[3].toLowerCase() === key); if (match) { setTool(match[0]); e.preventDefault() } }
  }
  return <div className={`lira-board ${dark ? 'lira-board-dark' : ''}`} onKeyDown={keyDown} onKeyUp={e => { e.stopPropagation(); if (e.code === 'Space') space.current = false }} onBlur={() => { space.current = false }}>
    <input hidden type="file" ref={openFile} accept=".json,application/json" aria-label="Abrir arquivo de quadro" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void safe(() => load(file)) }} />
    <input hidden type="file" ref={imageFile} accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Arquivo de imagem" onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void safe(() => addImage(file)) }} />
    <div className="board-top">
      <details className="board-menu board-card" ref={menu}><summary aria-label="Menu do quadro"><Menu size={20} /></summary><div className="board-menu-items">
        <button onClick={() => { openFile.current?.click(); if (menu.current) menu.current.open = false }} disabled={!ready}>Abrir quadro</button>
        <button onClick={() => void safe(save)}>Salvar quadro</button><button onClick={() => void safe(() => exportImage('svg'))}>Exportar SVG</button><button onClick={() => void safe(() => exportImage('png'))}>Exportar PNG</button>
        <hr /><button onClick={() => { setConfirmClear(true); if (menu.current) menu.current.open = false }} disabled={!ready}>Limpar quadro</button><hr />
        <button onClick={toggleTheme}>Tema {dark ? 'claro' : 'escuro'}</button><button aria-pressed={grid} onClick={() => setGrid(!grid)}>Grade {grid ? 'ativada' : 'desativada'}</button>
        <label>Cor do quadro<input type="color" value={background} onChange={e => setBackground(e.target.value)} /></label>
      </div></details>
      <div className="board-toolbar board-card" role="toolbar" aria-label="Ferramentas de desenho">
        {tools.map(([name, label, Icon, shortcut]) => <button key={name} type="button" aria-label={label} title={`${label} (${shortcut})`} aria-pressed={tool === name} onClick={() => { finishText(); setTool(name) }}><Icon size={19} /><kbd>{shortcut}</kbd></button>)}
        <button type="button" aria-label="Inserir imagem" title="Inserir imagem do computador" onClick={() => imageFile.current?.click()} disabled={!ready}><ImagePlus size={19} /></button>
      </div>
      <span className="board-local-label">{!connected ? 'Offline · salvo nesta sala' : synchronized ? 'Compartilhado com a sala' : 'Recebendo desenhos…'}</span>
    </div>
    <aside className="board-properties board-card" aria-label="Propriedades do desenho">
      <label>Cor do traço<input type="color" aria-label="Cor do traço" value={themeStroke(style.strokeColor)} onChange={e => changeSelected({ strokeColor: e.target.value })} /></label>
      <div className="board-colors">{palette.map(c => <button type="button" key={c} aria-label={`Cor ${c}`} title={c} style={{ background: themeStroke(c) }} onClick={() => changeSelected({ strokeColor: c })} />)}</div>
      <label>Preenchimento<input type="color" aria-label="Preenchimento" value={style.backgroundColor === 'transparent' ? '#ffffff' : style.backgroundColor} onChange={e => changeSelected({ backgroundColor: e.target.value })} /></label>
      <button className="board-text-button" onClick={() => changeSelected({ backgroundColor: 'transparent' })}>Sem preenchimento</button>
      <label>Espessura<input type="range" aria-label="Espessura" min="1" max="20" value={style.strokeWidth} onChange={e => changeSelected({ strokeWidth: Number(e.target.value) })} /></label>
      <label>Estilo<select aria-label="Estilo do traço" value={style.strokeStyle} onChange={e => changeSelected({ strokeStyle: e.target.value })}><option value="solid">Contínuo</option><option value="dashed">Tracejado</option><option value="dotted">Pontilhado</option></select></label>
      <label>Opacidade<input type="range" aria-label="Opacidade" min="10" max="100" value={style.opacity} onChange={e => changeSelected({ opacity: Number(e.target.value) })} /></label>
      <label>Tamanho do texto<input type="number" aria-label="Tamanho do texto" min="8" max="144" value={style.fontSize} onChange={e => changeSelected({ fontSize: Math.max(8, Math.min(144, Number(e.target.value))) })} /></label>
      {selected.length > 0 && <><hr /><span>{selected.length} selecionado(s)</span><div className="board-object-actions">
        <button aria-label="Duplicar seleção" title="Duplicar (Ctrl+D)" onClick={duplicate}><Copy size={17} /></button><button aria-label="Excluir seleção" title="Excluir" onClick={remove}><Trash2 size={17} /></button>
        <button aria-label="Trazer para frente" title="Trazer para frente" onClick={() => commit(selected.map((e, i) => ({ ...e, index: `z${Date.now()}${i}` })))}><ArrowUp size={17} /></button>
        <button aria-label="Enviar para trás" title="Enviar para trás" onClick={() => commit(selected.map((e, i) => ({ ...e, index: `!${Date.now()}${i}` })))}><ArrowDown size={17} /></button>
        <button aria-label="Girar seleção" title="Girar 15°" onClick={() => commit(selected.filter(e => !e.locked).map(e => ({ ...e, angle: (e.angle || 0) + Math.PI / 12 })))}><RotateCw size={17} /></button>
        <button aria-label="Bloquear ou desbloquear seleção" title="Bloquear ou desbloquear" onClick={() => commit(selected.map(e => ({ ...e, locked: !e.locked })))}>{selected.every(e => e.locked) ? <Unlock size={17} /> : <Lock size={17} />}</button>
      </div></>}
    </aside>
    <svg ref={svg} className="board-canvas" tabIndex={0} role="img" aria-label="Área de desenho" style={{ backgroundColor: background, cursor: tool === 'eraser' || tool === 'laser' ? 'none' : tool === 'hand' ? 'grab' : tool === 'selection' ? 'default' : 'crosshair' }}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerLeave={clearPointer} onPointerCancel={cancelGesture} onLostPointerCapture={() => { if (gesture.current) cancelGesture() }}
      onDoubleClick={e => { const b = e.currentTarget.getBoundingClientRect(), p = screenToBoard({ x: e.clientX - b.left, y: e.clientY - b.top }, view), hit = [...visible].reverse().find(el => hitElement(el, p)); if (ready && hit?.type === 'text' && !hit.locked) setTextEdit({ element: hit, value: hit.text || '' }) }}
      onWheel={e => { e.stopPropagation(); const box = e.currentTarget.getBoundingClientRect(); if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * .002), { x: e.clientX - box.left, y: e.clientY - box.top }); else setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })) }}>
      {grid && <><defs><pattern id="lira-board-grid" width={20 * view.zoom} height={20 * view.zoom} x={view.x} y={view.y} patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#94a3b8" opacity=".4" /></pattern></defs><rect width="100%" height="100%" fill="url(#lira-board-grid)" /></>}
      <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
        {combined.map(e => <g key={e.id} dangerouslySetInnerHTML={{ __html: elementSvg(themeElement(e), files) }} />)}
        {selected.map(e => { const b = elementBounds(draft.find(d => d.id === e.id) || e); return <g key={`selection:${e.id}`}><rect x={b.x - 4} y={b.y - 4} width={b.width + 8} height={b.height + 8} fill="none" stroke="#7965e9" strokeWidth={1 / view.zoom} strokeDasharray={`${4 / view.zoom} ${3 / view.zoom}`} pointerEvents="none" />
          {selected.length === 1 && !e.locked && <><rect data-board-handle="resize" x={b.x + b.width - 5 / view.zoom} y={b.y + b.height - 5 / view.zoom} width={10 / view.zoom} height={10 / view.zoom} fill="white" stroke="#7965e9" style={{ cursor: 'nwse-resize' }} /><circle data-board-handle="rotate" cx={b.x + b.width / 2} cy={b.y - 20 / view.zoom} r={5 / view.zoom} fill="white" stroke="#7965e9" style={{ cursor: 'grab' }} /></>}
        </g> })}
        {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} fill="#7965e922" stroke="#7965e9" strokeWidth={1 / view.zoom} />}
        <BoardPointerOverlay zoom={view.zoom} />
      </g>
    </svg>
    {textEdit && <textarea aria-label="Editar texto do quadro" autoFocus className="board-text-editor" style={{ left: textEdit.element.x * view.zoom + view.x, top: textEdit.element.y * view.zoom + view.y, fontSize: (textEdit.element.fontSize || 24) * view.zoom, color: themeStroke(textEdit.element.strokeColor) }} value={textEdit.value} onChange={e => setTextEdit({ ...textEdit, value: e.target.value })} onBlur={finishText} onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') setTextEdit(null); if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') finishText() }} />}
    <footer className="board-bottom">
      <div className="board-card board-controls"><button aria-label="Diminuir zoom" onClick={() => zoomAt(.8)}><ZoomOut size={17} /></button><button aria-label="Restaurar zoom" onClick={() => setView({ x: 0, y: 0, zoom: 1 })}>{Math.round(view.zoom * 100)}%</button><button aria-label="Aumentar zoom" onClick={() => zoomAt(1.25)}><Plus size={17} /></button><button onClick={fit}>Enquadrar</button></div>
      <span className="board-hint">Shift: proporção · Espaço: mover · Ctrl+Z: desfazer</span>
      <div className="board-card board-controls"><button aria-label="Desfazer" title="Desfazer (Ctrl+Z)" disabled={!ready || !history.current.past.length} onClick={undo}><Undo2 size={18} /></button><button aria-label="Refazer" title="Refazer (Ctrl+Shift+Z)" disabled={!ready || !history.current.future.length} onClick={redo}><Redo2 size={18} /></button></div>
    </footer>
    {(error || storageError) && <div role="alert" className="board-alert">{error || 'O armazenamento local está cheio. Salve um arquivo do quadro para preservar o desenho.'}<button onClick={() => setError('')}>Fechar aviso</button></div>}
    {confirmClear && <div className="board-confirm-backdrop"><div className="board-card board-confirm" role="alertdialog" aria-label="Limpar quadro"><p>Limpar os desenhos desta sala para todos os participantes?</p><button onClick={clear}>Sim, limpar</button><button autoFocus onClick={() => setConfirmClear(false)}>Cancelar</button></div></div>}
  </div>
}
