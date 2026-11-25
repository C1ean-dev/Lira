import { mergeDrawingRaster, type DrawingRasterPixels } from './losslessDrawingRaster'
import type { PreservedDrawingRaster } from '../../types/customAsset'
import { pixelToolPreview, type PixelPreviewRect } from './pixelToolPreview'
import { drawingToolCursor } from './drawingToolCursor'
import { fitPixelViewport, zoomPixelViewport, pixelFromViewport, type PixelViewport } from './pixelViewport'
import React, { useEffect, useRef, useState } from 'react'
import { Pencil, Eraser, PaintBucket, Pipette, Move, Undo2, Redo2, ZoomIn, ZoomOut, Grid2X2, Crop, Maximize2 } from 'lucide-react'
import { PixelEditor, type RGBA } from './pixelEditor'
import type { PixelLayerEdit } from './assetStudioDraft'
import { loadRasterImage } from '../../utils/loadRasterImage'

interface Props { width: number; height: number; source?: string; preservedRaster?: PreservedDrawingRaster; layerName?: string; onChange(edit: PixelLayerEdit): void }
type Tool = 'pencil' | 'eraser' | 'fill' | 'picker' | 'move'
const tools = [{ id: 'pencil', name: 'Lápis', icon: Pencil }, { id: 'eraser', name: 'Borracha', icon: Eraser }, { id: 'fill', name: 'Preencher', icon: PaintBucket }, { id: 'picker', name: 'Conta-gotas', icon: Pipette }, { id: 'move', name: 'Mover pixels', icon: Move }] as const
export const AssetDrawingStudio: React.FC<Props> = ({ width, height, source, preservedRaster, layerName, onChange }) => {
  const canvas = useRef<HTMLCanvasElement>(null), editor = useRef<PixelEditor>()
  const backing = useRef<DrawingRasterPixels>(), rasterOrigin = useRef({ x: 0, y: 0 })
  const emitted = useRef(''), published = useRef({ width, height, x: 0, y: 0 })
  const gesture = useRef<{ start: { x: number; y: number }; last: { x: number; y: number }; pointer: number }>()
  const [tool, setTool] = useState<Tool>('pencil'), [color, setColor] = useState('#6366f1'), [size, setSize] = useState(1)
  const viewport = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<PixelViewport>({ x: 0, y: 0, zoom: 1 })
  const liveView = useRef(view), autoFit = useRef(true), spaceHeld = useRef(false)
  const lastPointer = useRef<{ x: number; y: number }>()
  const pan = useRef<{ x: number; y: number; pointer: number }>()
  const [isPanning, setIsPanning] = useState(false)
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  const hoverClient = useRef<{ x: number; y: number } | null>(null)
  const bitmapRevision = useRef(0)
  const previewCache = useRef<{ key: string; image: unknown; rectangles: PixelPreviewRect[] }>()
  const hideHover = () => { hoverClient.current = null; setHover(null) }
  const refreshHover = (next = liveView.current) => {
    const point = hoverClient.current, image = editor.current?.image
    if (!point || !image) return
    const x = Math.floor((point.x - next.x) / next.zoom), y = Math.floor((point.y - next.y) / next.zoom)
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) { setHover(null); return }
    setHover(previous => previous?.x === x && previous?.y === y ? previous : { x, y })
  }
  const trackHover = (event: { clientX: number; clientY: number; buttons?: number }) => {
    if (pan.current || (event.buttons || 0) & 6 || spaceHeld.current) { hideHover(); return }
    const bounds = viewport.current?.getBoundingClientRect()
    if (!bounds) return
    hoverClient.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
    refreshHover()
  }
  const zoom = view.zoom
  const updateView = (next: PixelViewport) => { liveView.current = next; setView(next); refreshHover(next) }
  const fit = () => {
    const node = viewport.current
    if (!node) return
    const bounds = node.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    autoFit.current = true
    updateView(fitPixelViewport(bounds.width, bounds.height, editor.current?.image.width || width, editor.current?.image.height || height))
  }
  const changeZoom = (nextZoom: number, cursor?: { x: number; y: number }) => {
    const bounds = viewport.current?.getBoundingClientRect()
    autoFit.current = false
    updateView(zoomPixelViewport(liveView.current, cursor || { x: (bounds?.width || 0) / 2, y: (bounds?.height || 0) / 2 }, nextZoom))
  }
  useEffect(() => {
    const node = viewport.current
    if (!node) return
    if (autoFit.current) fit()
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const bounds = node.getBoundingClientRect()
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1)
      changeZoom(liveView.current.zoom * Math.exp(-Math.max(-500, Math.min(500, delta)) * .002), { x: event.clientX - bounds.left, y: event.clientY - bounds.top })
    }
    // React wheel handlers can be passive. This listener must suppress scrolling
    // and browser zoom while navigating the drawing viewport.
    node.addEventListener('wheel', wheel, { passive: false })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { if (autoFit.current) fit() })
    observer?.observe(node)
    return () => { node.removeEventListener('wheel', wheel); observer?.disconnect() }
  }, [width, height])
  const [grid, setGrid] = useState(true), [ready, setReady] = useState(false), [error, setError] = useState('')
  const [, render] = useState(0)
  const redraw = () => {
    const node = canvas.current, image = editor.current?.image
    if (!node || !image) return
    bitmapRevision.current++
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
    let preserved: PreservedDrawingRaster | undefined
    if (backing.current) {
      const merged = mergeDrawingRaster(backing.current, image, rasterOrigin.current.x + image.x, rasterOrigin.current.y + image.y)
      backing.current = merged
      rasterOrigin.current = { x: merged.x - image.x, y: merged.y - image.y }
      if (merged.width !== image.width || merged.height !== image.height || merged.x || merged.y) {
        // Encode the full raster using the existing canvas, then restore the visible
        // bitmap immediately. Hidden pixels never enter the displayed composition.
        const node = canvas.current
        node.width = merged.width; node.height = merged.height
        const context = node.getContext('2d')
        if (!context) { setError('Não foi possível preservar a imagem completa.'); return }
        context.putImageData(new ImageData(merged.data, merged.width, merged.height), 0, 0)
        preserved = { dataUrl: node.toDataURL('image/png'), width: merged.width, height: merged.height, x: merged.x, y: merged.y }
        redraw()
      }
    }
    emitted.current = canvas.current.toDataURL('image/png')
    published.current = { width: image.width, height: image.height, x: image.x, y: image.y }
    onChange({ dataUrl: emitted.current, width: image.width, height: image.height, bounds, preservedRaster: preserved })
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
        const rasterSource = preservedRaster?.dataUrl || source
        const image = rasterSource ? await loadRasterImage(rasterSource) : null
        if (cancelled) return
        const node = canvas.current
        if (!node) return
        node.width = preservedRaster?.width || width; node.height = preservedRaster?.height || height
        const ctx = node.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('Canvas indisponível')
        ctx.imageSmoothingEnabled = false
        if (preservedRaster) {
          if (image) ctx.drawImage(image, 0, 0)
          backing.current = { width: node.width, height: node.height, data: ctx.getImageData(0, 0, node.width, node.height).data.slice() }
          rasterOrigin.current = { x: preservedRaster.x, y: preservedRaster.y }
          node.width = width; node.height = height
          if (image) ctx.drawImage(image, -preservedRaster.x, -preservedRaster.y)
        } else {
          if (image) ctx.drawImage(image, 0, 0, width, height)
          backing.current = { width, height, data: ctx.getImageData(0, 0, width, height).data.slice() }
          rasterOrigin.current = { x: 0, y: 0 }
        }
        editor.current = new PixelEditor(width, height, ctx.getImageData(0, 0, width, height).data)
        published.current = { width, height, x: 0, y: 0 }
        setReady(true); redraw()
      } catch { if (!cancelled) setError('Não foi possível carregar esta camada. A imagem original foi preservada.') }
    })()
    return () => { cancelled = true }
  }, [source, width, height, preservedRaster])
  const finish = () => { if (gesture.current) { gesture.current = undefined; if (editor.current?.commit()) publish() } }
  const pixel = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const box = viewport.current!.getBoundingClientRect(), image = editor.current!.image
    return pixelFromViewport(liveView.current, { x: event.clientX - box.left, y: event.clientY - box.top }, image.width, image.height)
  }
  const rgba = (): RGBA => tool === 'eraser' ? [0, 0, 0, 0] : [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 255]
  const undo = () => { finish(); if (editor.current?.canUndo) { editor.current.undo(); publish() } }
  const redo = () => { finish(); if (editor.current?.canRedo) { editor.current.redo(); publish() } }
  let preview: PixelPreviewRect[] = []
  if (ready && hover && !isPanning && editor.current) {
    const key = `${tool}:${size}:${color}:${hover.x}:${hover.y}:${bitmapRevision.current}`
    if (previewCache.current?.key !== key || previewCache.current.image !== editor.current.image) {
      previewCache.current = { key, image: editor.current.image, rectangles: pixelToolPreview(editor.current.image, tool, hover, size, rgba()) }
    }
    preview = previewCache.current.rectangles
  }
  return <section aria-label="Desenho da camada" className="flex min-h-0 flex-1 flex-col gap-3 font-mono text-lira-ink" onKeyDown={event => {
    if (!(event.ctrlKey || event.metaKey) || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement).tagName)) return
    if (event.key.toLowerCase() === 'z') { event.preventDefault(); event.stopPropagation(); event.shiftKey ? redo() : undo() }
    if (event.key.toLowerCase() === 'y') { event.preventDefault(); event.stopPropagation(); redo() }
  }}>
    <div role="toolbar" aria-label="Ferramentas de desenho" className="flex flex-wrap items-center gap-2 rounded-[12px] border border-lira-quiet bg-lira-sidebar p-2">
      {tools.map(item => <button type="button" key={item.id} aria-label={item.name} title={item.name} aria-pressed={tool === item.id} onClick={() => setTool(item.id)} className={`rounded-[8px] p-2 ${tool === item.id ? 'bg-lira-accent text-lira-ground' : 'text-lira-muted hover:text-lira-ink hover:bg-lira-surface'}`}><item.icon size={17} /></button>)}
      <span className="mx-1 h-6 border-l border-lira-quiet" />
      <button type="button" disabled={!editor.current?.canUndo} onClick={undo} aria-label="Desfazer" title="Desfazer (Ctrl/Cmd+Z)" className="p-1 text-lira-muted hover:text-lira-ink disabled:opacity-30"><Undo2 size={17} /></button>
      <button type="button" disabled={!editor.current?.canRedo} onClick={redo} aria-label="Refazer" title="Refazer (Ctrl/Cmd+Shift+Z)" className="p-1 text-lira-muted hover:text-lira-ink disabled:opacity-30"><Redo2 size={17} /></button>
      <button type="button" onClick={() => changeZoom(liveView.current.zoom / 1.5)} aria-label="Diminuir zoom" className="text-lira-muted hover:text-lira-ink"><ZoomOut size={17} /></button><span className="w-9 text-center text-xs font-mono text-lira-ink tabular-nums">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => changeZoom(liveView.current.zoom * 1.5)} aria-label="Aumentar zoom" className="text-lira-muted hover:text-lira-ink"><ZoomIn size={17} /></button>
      <button type="button" onClick={fit} aria-label="Ajustar desenho à área" title="Ajustar desenho à área" className="p-1 text-lira-muted hover:text-lira-ink"><Maximize2 size={17} /></button>
      <button type="button" aria-label="Grade de pixels" aria-pressed={grid} onClick={() => setGrid(value => !value)} className={`p-1 ${grid ? 'text-lira-accent' : 'text-lira-muted'}`}><Grid2X2 size={17} /></button>
      <button type="button" disabled={!ready} onClick={() => { finish(); if (editor.current?.trim()) publish() }} className="flex gap-1 items-center rounded-[8px] bg-lira-surface border border-lira-rule hover:border-lira-accent p-2 text-xs font-mono text-lira-ink disabled:opacity-30"><Crop size={15} />Aparar bordas</button>
      <label className="ml-auto flex items-center gap-2 text-xs font-mono text-lira-muted">
        Cor do desenho
        <input type="color" aria-label="Escolher cor do desenho" title="Escolher qualquer cor para desenhar" value={color} onChange={event => setColor(event.target.value)} className="h-7 w-9 cursor-pointer rounded-[6px] border border-lira-rule bg-transparent" />
        <span className="font-mono text-[11px] text-lira-muted">{color.toUpperCase()}</span>
      </label>
      <label className="flex items-center gap-1 text-xs font-mono text-lira-muted">Pincel <select aria-label="Tamanho do pincel" value={size} onChange={event => setSize(Number(event.target.value))} className="rounded-[6px] bg-lira-ground border border-lira-rule text-lira-ink p-1">{[1, 2, 4, 8].map(value => <option key={value} value={value}>{value}px</option>)}</select></label>
    </div>
    <div ref={viewport} tabIndex={0} aria-label="Área de navegação do desenho"
      className="relative flex-1 min-h-40 overflow-hidden rounded-[12px] border border-lira-quiet bg-lira-ground touch-none outline-none focus-visible:ring-2 focus-visible:ring-lira-accent"
      style={{ cursor: isPanning ? 'grabbing' : undefined }}
      onContextMenu={event => event.preventDefault()}
      onKeyDown={event => { if (event.code === 'Space' || event.key === ' ') { event.preventDefault(); spaceHeld.current = true; hideHover() } }}
      onKeyUp={event => { if (event.code === 'Space' || event.key === ' ') { event.preventDefault(); spaceHeld.current = false } }}
      onBlur={() => { hideHover(); spaceHeld.current = false; pan.current = undefined; setIsPanning(false); finish() }}
      onPointerDownCapture={event => {
        lastPointer.current = { x: event.clientX, y: event.clientY }
        if (event.button !== 2 && event.button !== 1 && !(event.button === 0 && spaceHeld.current)) return
        event.preventDefault(); event.stopPropagation()
        hideHover()
        event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
        pan.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId }
        setIsPanning(true)
      }}
      onPointerMoveCapture={event => {
        const previous = lastPointer.current
        lastPointer.current = { x: event.clientX, y: event.clientY }
        // Chording right/middle with left produces pointermove, not pointerdown.
        if (!(event.buttons & 6) && !(spaceHeld.current && event.buttons & 1)) {
          pan.current = undefined; setIsPanning(false); return
        }
        event.preventDefault(); event.stopPropagation()
        hideHover()
        const start = pan.current?.pointer === event.pointerId ? pan.current : previous
        if (start) {
          autoFit.current = false
          updateView({ ...liveView.current, x: liveView.current.x + event.clientX - start.x, y: liveView.current.y + event.clientY - start.y })
        }
        pan.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId }
        setIsPanning(true)
        // Resume an existing left-button stroke at its new image coordinate,
        // without drawing a diagonal line across the pan.
        if (gesture.current && editor.current) {
          const bounds = event.currentTarget.getBoundingClientRect()
          gesture.current.last = pixelFromViewport(liveView.current, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, editor.current.image.width, editor.current.image.height)
        }
      }}
      onPointerUp={() => { pan.current = undefined; setIsPanning(false); finish() }}
      onPointerCancel={() => { pan.current = undefined; spaceHeld.current = false; setIsPanning(false); finish() }}
      onLostPointerCapture={() => { pan.current = undefined; setIsPanning(false) }}>
      <div data-pixel-board className="absolute" style={{ left: view.x, top: view.y, backgroundColor: '#1e162b', backgroundImage: 'conic-gradient(#100c18 25%, transparent 0 50%, #100c18 0 75%, transparent 0)', backgroundSize: '16px 16px' }}>
        <canvas ref={canvas} width={width} height={height} tabIndex={0} aria-label="Tela de desenho de pixels" className="block touch-none outline-none focus:ring-2 focus:ring-lira-accent" style={{ width: (editor.current?.image.width || width) * zoom, height: (editor.current?.image.height || height) * zoom, imageRendering: 'pixelated', cursor: isPanning ? 'grabbing' : drawingToolCursor(tool) }}
          onPointerEnter={trackHover} onPointerLeave={hideHover}
          onPointerDown={event => {
            trackHover(event)
            if (!ready || event.button !== 0 || !editor.current) return
            event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId)
            const at = pixel(event), doc = editor.current
            if (tool === 'picker') { const sampled = doc.pick(at.x, at.y); setColor('#' + sampled.slice(0, 3).map(value => value.toString(16).padStart(2, '0')).join('')); return }
            doc.begin(); gesture.current = { start: at, last: at, pointer: event.pointerId }
            if (tool === 'fill') { doc.fill(at.x, at.y, rgba()); finish() }
            else if (tool !== 'move') { doc.line(at.x, at.y, at.x, at.y, rgba(), size); redraw() }
          }}
          onPointerMove={event => {
            trackHover(event)
            const drag = gesture.current, doc = editor.current
            if (!drag || drag.pointer !== event.pointerId || !doc) return
            const at = pixel(event)
            if (tool === 'move') doc.move(at.x - drag.start.x, at.y - drag.start.y)
            else doc.line(drag.last.x, drag.last.y, at.x, at.y, rgba(), size)
            drag.last = at; redraw()
          }} onPointerUp={finish} onLostPointerCapture={finish} onPointerCancel={finish} />
        {grid && zoom >= 4 && <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'linear-gradient(to right, #ffffff18 1px, transparent 1px), linear-gradient(to bottom, #ffffff18 1px, transparent 1px)', backgroundSize: `${zoom}px ${zoom}px` }} />}
        {preview.length > 0 && <svg data-pixel-preview data-tool={tool} aria-hidden={true}
          className="pointer-events-none absolute inset-0" width={(editor.current?.image.width || width) * zoom} height={(editor.current?.image.height || height) * zoom}
          viewBox={`0 0 ${editor.current?.image.width || width} ${editor.current?.image.height || height}`} fill="white" fillOpacity={.12}
          stroke={preview.length === 1 ? 'white' : 'none'} strokeOpacity={.45} strokeWidth={1} shapeRendering="crispEdges">
          {preview.map((rect, index) => <rect key={index} x={rect.x} y={rect.y} width={rect.width} height={rect.height} vectorEffect="non-scaling-stroke" />)}
        </svg>}
      </div>
    </div>
    {error && <p role="alert" className="text-xs font-mono text-lira-error">{error}</p>}
    <p className="text-xs font-mono text-lira-muted">Roda do mouse: zoom no cursor · Botão direito ou Espaço + arraste: mover a tela · Esquerdo: desenhar</p>
    <p className="text-xs font-mono text-lira-muted">{layerName ? `Editando: ${layerName}.` : 'Desenhe para criar a primeira camada.'} As outras camadas, direções, animações e colisões são preservadas.</p>
  </section>
}
