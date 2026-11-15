import React, { useEffect, useRef, useState } from 'react'
import { Pencil, Eraser, PaintBucket, Pipette, Move, Undo2, Redo2, ZoomIn, ZoomOut, Grid2X2, Crop } from 'lucide-react'
import { PixelEditor, type RGBA } from './pixelEditor'
import type { PixelLayerEdit } from './assetStudioDraft'
import { loadRasterImage } from '../../utils/loadRasterImage'

interface Props { width: number; height: number; source?: string; layerName?: string; onChange(edit: PixelLayerEdit): void }
const palette = ['#000000', '#1e293b', '#64748b', '#cbd5e1', '#ffffff', '#7f1d1d', '#ef4444', '#fb923c', '#facc15', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899']
type Tool = 'pencil' | 'eraser' | 'fill' | 'picker' | 'move'
const tools = [{ id: 'pencil', name: 'Lápis', icon: Pencil }, { id: 'eraser', name: 'Borracha', icon: Eraser }, { id: 'fill', name: 'Preencher', icon: PaintBucket }, { id: 'picker', name: 'Conta-gotas', icon: Pipette }, { id: 'move', name: 'Mover pixels', icon: Move }] as const
export const AssetDrawingStudio: React.FC<Props> = ({ width, height, source, layerName, onChange }) => {
  const canvas = useRef<HTMLCanvasElement>(null), editor = useRef<PixelEditor>()
  const emitted = useRef(''), published = useRef({ width, height, x: 0, y: 0 })
  const gesture = useRef<{ start: { x: number; y: number }; last: { x: number; y: number }; pointer: number }>()
  const [tool, setTool] = useState<Tool>('pencil'), [color, setColor] = useState('#6366f1'), [size, setSize] = useState(1)
  const [zoom, setZoom] = useState(Math.max(1, Math.min(14, Math.floor(360 / Math.max(width, height)))))
  const [grid, setGrid] = useState(true), [ready, setReady] = useState(false), [error, setError] = useState('')
  const [, render] = useState(0)
  const redraw = () => {
    const node = canvas.current, image = editor.current?.image
    if (!node || !image) return
    node.width = image.width; node.height = image.height
    node.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0)
    render(value => value + 1)
  }
  const publish = () => {
    redraw()
    if (!canvas.current || !editor.current) return
    const image = editor.current.image, previous = published.current
    const bounds = image.width !== previous.width || image.height !== previous.height || image.x !== previous.x || image.y !== previous.y
      ? { x: image.x - previous.x, y: image.y - previous.y, width: image.width, height: image.height, sourceWidth: previous.width, sourceHeight: previous.height } : undefined
    emitted.current = canvas.current.toDataURL('image/png')
    published.current = { width: image.width, height: image.height, x: image.x, y: image.y }
    onChange({ dataUrl: emitted.current, width: image.width, height: image.height, bounds })
  }
  useEffect(() => {
    if (source && source === emitted.current && editor.current?.image.width === width && editor.current?.image.height === height) {
      // React updates the intrinsic dimensions after trimming; that clears a canvas.
      // Restore the live bitmap after the shared document has applied that resize.
      redraw()
      return
    }
    let cancelled = false
    setReady(false); setError('')
    void (async () => {
      try {
        const image = source ? await loadRasterImage(source) : null
        if (cancelled) return
        const node = canvas.current
        if (!node) return
        node.width = width; node.height = height
        const ctx = node.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('Canvas indisponível')
        ctx.imageSmoothingEnabled = false
        if (image) ctx.drawImage(image, 0, 0, width, height)
        editor.current = new PixelEditor(width, height, ctx.getImageData(0, 0, width, height).data)
        published.current = { width, height, x: 0, y: 0 }
        setReady(true); redraw()
      } catch { if (!cancelled) setError('Não foi possível carregar esta camada. A imagem original foi preservada.') }
    })()
    return () => { cancelled = true }
  }, [source, width, height])
  const finish = () => { if (gesture.current) { gesture.current = undefined; if (editor.current?.commit()) publish() } }
  const pixel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect(), image = editor.current!.image
    return { x: Math.min(image.width - 1, Math.max(0, Math.floor((event.clientX - box.left) / box.width * image.width))), y: Math.min(image.height - 1, Math.max(0, Math.floor((event.clientY - box.top) / box.height * image.height))) }
  }
  const rgba = (): RGBA => tool === 'eraser' ? [0, 0, 0, 0] : [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 255]
  const undo = () => { finish(); if (editor.current?.canUndo) { editor.current.undo(); publish() } }
  const redo = () => { finish(); if (editor.current?.canRedo) { editor.current.redo(); publish() } }
  return <section aria-label="Desenho da camada" className="flex min-h-0 flex-1 flex-col gap-3" onKeyDown={event => {
    if (!(event.ctrlKey || event.metaKey) || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName)) return
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); event.shiftKey ? redo() : undo() }
    if (event.key.toLowerCase() === 'y') { event.preventDefault(); event.stopPropagation(); redo() }
  }}>
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-700 bg-[#18191c] p-2">
      {tools.map(item => <button type="button" key={item.id} aria-label={item.name} title={item.name} aria-pressed={tool === item.id} onClick={() => setTool(item.id)} className={`rounded-lg p-2 ${tool === item.id ? 'bg-indigo-600 text-white' : 'text-slate-300 hover:bg-slate-700'}`}><item.icon size={17} /></button>)}
      <span className="mx-1 h-6 border-l border-slate-700" />
      <button type="button" disabled={!editor.current?.canUndo} onClick={undo} aria-label="Desfazer" title="Desfazer (Ctrl/Cmd+Z)" className="p-1 disabled:opacity-30"><Undo2 size={17} /></button>
      <button type="button" disabled={!editor.current?.canRedo} onClick={redo} aria-label="Refazer" title="Refazer (Ctrl/Cmd+Shift+Z)" className="p-1 disabled:opacity-30"><Redo2 size={17} /></button>
      <button type="button" onClick={() => setZoom(value => Math.max(.25, value / 1.5))} aria-label="Diminuir zoom"><ZoomOut size={17} /></button><span className="w-9 text-center text-xs">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => setZoom(value => Math.min(32, value * 1.5))} aria-label="Aumentar zoom"><ZoomIn size={17} /></button>
      <button type="button" aria-label="Grade de pixels" aria-pressed={grid} onClick={() => setGrid(value => !value)} className={`p-1 ${grid ? 'text-indigo-400' : 'text-slate-400'}`}><Grid2X2 size={17} /></button>
      <button type="button" disabled={!ready} onClick={() => { finish(); if (editor.current?.trim()) publish() }} className="flex gap-1 items-center rounded-lg bg-slate-800 p-2 text-xs disabled:opacity-30"><Crop size={15} />Aparar bordas</button>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs"><label className="flex items-center gap-2">Cor do desenho <input type="color" value={color} onChange={event => setColor(event.target.value)} className="h-7 w-8" /></label>
      {palette.map(value => <button type="button" key={value} aria-label={`Cor ${value}`} onClick={() => setColor(value)} style={{ backgroundColor: value }} className={`h-6 w-6 rounded-md border ${value === color ? 'border-white ring-1 ring-indigo-400' : 'border-slate-600'}`} />)}
      <label className="ml-auto">Pincel <select aria-label="Tamanho do pincel" value={size} onChange={event => setSize(Number(event.target.value))} className="rounded bg-slate-800 p-1">{[1, 2, 4, 8].map(value => <option key={value} value={value}>{value}px</option>)}</select></label>
    </div>
    <div className="relative flex-1 min-h-40 overflow-auto rounded-2xl border border-slate-700 bg-[#111318] p-5">
      <div className="relative m-auto w-fit" style={{ backgroundColor: '#22252e', backgroundImage: 'conic-gradient(#181a20 25%, transparent 0 50%, #181a20 0 75%, transparent 0)', backgroundSize: '16px 16px' }}>
        <canvas ref={canvas} width={width} height={height} tabIndex={0} aria-label="Tela de desenho de pixels" className="block touch-none outline-none focus:ring-2 focus:ring-indigo-400" style={{ width: (editor.current?.image.width || width) * zoom, height: (editor.current?.image.height || height) * zoom, imageRendering: 'pixelated', cursor: tool === 'move' ? 'move' : 'crosshair' }}
          onPointerDown={event => {
            if (!ready || event.button !== 0 || !editor.current) return
            event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
            const at = pixel(event), doc = editor.current
            if (tool === 'picker') { const sampled = doc.pick(at.x, at.y); setColor('#' + sampled.slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('')); return }
            doc.begin(); gesture.current = { start: at, last: at, pointer: event.pointerId }
            if (tool === 'fill') { doc.fill(at.x, at.y, rgba()); finish() }
            else if (tool !== 'move') { doc.line(at.x, at.y, at.x, at.y, rgba(), size); redraw() }
          }}
          onPointerMove={event => {
            const drag = gesture.current, doc = editor.current
            if (!drag || drag.pointer !== event.pointerId || !doc) return
            const at = pixel(event)
            if (tool === 'move') doc.move(at.x - drag.start.x, at.y - drag.start.y)
            else doc.line(drag.last.x, drag.last.y, at.x, at.y, rgba(), size)
            drag.last = at; redraw()
          }} onPointerUp={finish} onLostPointerCapture={finish} onPointerCancel={finish} />
        {grid && zoom >= 4 && <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'linear-gradient(to right, #ffffff18 1px, transparent 1px), linear-gradient(to bottom, #ffffff18 1px, transparent 1px)', backgroundSize: `${zoom}px ${zoom}px` }} />}
      </div>
    </div>
    {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
    <p className="text-xs text-slate-400">{layerName ? `Editando: ${layerName}.` : 'Desenhe para criar a primeira camada.'} As outras camadas, direções, animações e colisões são preservadas.</p>
  </section>
}
