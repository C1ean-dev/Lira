import { generateUUID } from '../../utils/uuid'
import React, { useEffect, useRef, useState } from 'react'
import { X, Undo2, Eraser, Download } from 'lucide-react'
import { useWhiteboardStore } from '../../store/useWhiteboardStore'
import { useGameStore } from '../../store/useGameStore'
import { PeerManager } from '../../p2p/PeerManager'
import { visibleStrokes, type Point, type Stroke } from '../../collaboration/whiteboard'
import { sendWhiteboardOperation } from '../../services/whiteboardNetwork'
import { downloadText } from './downloadText'

export const WhiteboardPanel: React.FC = () => {
  const { document: board, isOpen, setOpen, synchronized } = useWhiteboardStore()
  const [color, setColor] = useState('#4338ca'), [width, setWidth] = useState(3)
  const [draft, setDraft] = useState<Point[]>([]), [confirmClear, setConfirmClear] = useState(false)
  const [error, setError] = useState('')
  const points = useRef<Point[]>([])
  const dialog = useRef<HTMLDialogElement>(null), svg = useRef<SVGSVGElement>(null)
  useEffect(() => { if (isOpen) dialog.current?.showModal() }, [isOpen])
  if (!isOpen) return null
  const actor = PeerManager.getInstance().getPeerId() || useGameStore.getState().localPlayer.id
  const strokes = visibleStrokes(board)
  const base = () => ({ id: `${actor}:${generateUUID()}`, actor, clock: useWhiteboardStore.getState().document.clock + 1 })
  const commit = () => {
    if (!points.current.length) return
    const op: Stroke = { ...base(), kind: 'stroke', color, width, points: points.current }
    if (!sendWhiteboardOperation(op)) setError('O quadro atingiu seu limite. Limpe o quadro para continuar.')
    points.current = []; setDraft([])
  }
  const point = (e: React.PointerEvent<SVGSVGElement>): Point => {
    const box = e.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)) }
  }
  const mine = [...strokes].reverse().find(stroke => stroke.actor === actor)
  const draw = (stroke: { points: Point[]; color: string; width: number }, id: string) => <polyline key={id} points={(stroke.points.length === 1 ? [stroke.points[0], stroke.points[0]] : stroke.points).map(p => `${p.x * 1000},${p.y * 600}`).join(' ')} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeLinecap="round" strokeLinejoin="round" />
  return <dialog ref={dialog} onCancel={() => { commit(); setOpen(false) }} aria-labelledby="whiteboard-title" className="m-auto w-[min(1100px,96vw)] max-h-[94vh] overflow-auto rounded-2xl border border-slate-700 bg-[#12151d] p-4 text-slate-100 backdrop:bg-black/70">
    <header className="flex items-center justify-between gap-2 mb-3"><h2 id="whiteboard-title" className="font-semibold">Quadro branco colaborativo</h2><button type="button" onClick={() => { commit(); setOpen(false) }} aria-label="Fechar quadro branco"><X size={20} /></button></header>
    <div className="flex flex-wrap items-center gap-3 text-xs mb-3">
      <label className="flex items-center gap-2">Cor do traço <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-8 h-7" /></label>
      <label className="flex items-center gap-2">Espessura <input type="range" aria-label="Espessura do traço" min="1" max="20" value={width} onChange={e => setWidth(Number(e.target.value))} className="w-24" /></label>
      <button type="button" disabled={!mine || !synchronized} onClick={() => { if (mine) sendWhiteboardOperation({ ...base(), kind: 'remove', targetId: mine.id }) }} className="flex gap-1 items-center disabled:opacity-40"><Undo2 size={14} />Desfazer meu traço</button>
      <button type="button" disabled={!synchronized} onClick={() => setConfirmClear(true)} className="flex gap-1 items-center disabled:opacity-40"><Eraser size={14} />Limpar quadro</button>
      <button type="button" onClick={() => { if (svg.current) downloadText('quadro-branco.svg', svg.current.outerHTML, 'image/svg+xml') }} className="flex gap-1 items-center"><Download size={14} />Exportar SVG</button>
    </div>
    {confirmClear && <div className="flex flex-wrap items-center gap-3 text-xs mb-3 p-3 rounded-lg bg-amber-950 text-amber-200"><span>Limpar os desenhos de todos os participantes?</span><button type="button" onClick={() => { commit(); sendWhiteboardOperation({ ...base(), kind: 'clear' }); setConfirmClear(false); setError('') }}>Sim, limpar para todos</button><button type="button" onClick={() => setConfirmClear(false)}>Cancelar</button></div>}
    <svg ref={svg} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600" preserveAspectRatio="none" role="img" aria-label="Área de desenho compartilhada" className="w-full aspect-[5/3] max-h-[70vh] bg-white rounded-lg touch-none cursor-crosshair"
      onPointerDown={e => { if (e.button !== 0 || !synchronized) return; e.currentTarget.setPointerCapture(e.pointerId); points.current = [point(e)]; setDraft([...points.current]) }}
      onPointerMove={e => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId) || !points.current.length) return
        const next = point(e), last = points.current[points.current.length - 1]
        if (Math.hypot(next.x - last.x, next.y - last.y) < .001) return
        if (points.current.length >= 512) { commit(); points.current = [last] }
        points.current = [...points.current, next]; setDraft(points.current)
      }}
      onPointerUp={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) { commit(); e.currentTarget.releasePointerCapture(e.pointerId) } }}
      onPointerCancel={() => { points.current = []; setDraft([]) }}>
      <rect width="1000" height="600" fill="white" />
      {strokes.map(stroke => draw(stroke, stroke.id))}
      {draft.length > 0 && draw({ points: draft, color, width }, 'draft')}
    </svg>
    <p className="text-xs text-slate-400 mt-3">Desenhe com o mouse, caneta ou toque. Os traços são compartilhados com as pessoas do espaço e ficam disponíveis durante esta sessão.</p>
    {!synchronized && <p role="status" className="text-xs text-amber-300 mt-2">Sincronizando o quadro com o anfitrião… Se a conexão cair, feche e abra o quadro para tentar novamente.</p>}
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
  </dialog>
}
