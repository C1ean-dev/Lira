import type { BoardElement, BoardFiles } from './boardEditor'
import { elementBounds } from './boardEditor'
import { validWhiteboardOperation } from './whiteboard'

const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!))
const color = (value: string | undefined, fallback: string) => value && /^(#[a-f\d]{3,8}|transparent)$/i.test(value) ? value : fallback
const n = (value: number | undefined, fallback = 0) => Number.isFinite(value) ? value! : fallback
export function elementSvg(e: BoardElement, files: BoardFiles): string {
  const stroke = color(e.strokeColor, '#1e1e1e'), fill = color(e.backgroundColor, 'transparent'), w = Math.max(0, n(e.width)), h = Math.max(0, n(e.height))
  const attrs = `stroke="${stroke}" fill="${fill}" stroke-width="${Math.max(.5, n(e.strokeWidth, 2))}" stroke-linecap="round" stroke-linejoin="round"${e.strokeStyle === 'dashed' ? ' stroke-dasharray="8 6"' : e.strokeStyle === 'dotted' ? ' stroke-dasharray="1 6"' : ''}`
  let shape = ''
  if (e.type === 'rectangle' || e.type === 'frame') shape = `<rect width="${w}" height="${h}" rx="3" ${attrs}/>`
  if (e.type === 'ellipse') shape = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" ${attrs}/>`
  if (e.type === 'diamond') shape = `<polygon points="${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}" ${attrs}/>`
  if (e.type === 'line' || e.type === 'arrow' || e.type === 'freedraw') {
    const source = e.points?.length ? e.points : [[0, 0], [w, h]]
    const points = source.length === 1 ? [source[0], source[0]] : source
    const lineAttrs = attrs.replace(/fill="[^"]*"/, 'fill="none"')
    shape = `<polyline points="${points.map(p => `${n(p[0])},${n(p[1])}`).join(' ')}" ${lineAttrs}/>`
    if (e.type === 'arrow' && points.length > 1) {
      const [x, y] = points[points.length - 1], [px, py] = points[points.length - 2], a = Math.atan2(y - py, x - px), size = Math.max(12, (e.strokeWidth || 2) * 4)
      shape += `<polyline points="${x - size * Math.cos(a - .5)},${y - size * Math.sin(a - .5)} ${x},${y} ${x - size * Math.cos(a + .5)},${y - size * Math.sin(a + .5)}" ${lineAttrs}/>`
    }
  }
  if (e.type === 'text') {
    const size = Math.max(8, n(e.fontSize, 24))
    shape = `<text fill="${stroke}" font-family="system-ui, sans-serif" font-size="${size}">${(e.text || '').split('\n').map((line, i) => `<tspan x="0" y="${size + i * size * 1.25}">${escape(line) || ' '}</tspan>`).join('')}</text>`
  }
  if (e.type === 'image' && e.fileId) {
    const file = files[e.fileId]
    if (file && validWhiteboardOperation({ id: 'export', actor: 'local', clock: 1, kind: 'file', file })) shape = `<image width="${w}" height="${h}" href="${escape(file.dataURL)}" preserveAspectRatio="none"/>`
  }
  const b = elementBounds({ ...e, x: 0, y: 0 })
  return `<g transform="translate(${n(e.x)} ${n(e.y)}) rotate(${n(e.angle) * 180 / Math.PI} ${b.x + b.width / 2} ${b.y + b.height / 2})" opacity="${Math.max(0, Math.min(100, n(e.opacity, 100))) / 100}">${shape}</g>`
}
export function boardSvg(elements: BoardElement[], files: BoardFiles, background = '#ffffff'): string {
  const visible = elements.filter(e => !e.isDeleted), bounds = visible.map(elementBounds)
  // Extra room around rotated shapes and arrowheads.
  const pad = 40 + Math.max(0, ...visible.filter(e => e.angle).map(e => Math.max(e.width, e.height)))
  const x = Math.min(0, ...bounds.map(b => b.x)) - pad, y = Math.min(0, ...bounds.map(b => b.y)) - pad
  const w = Math.max(100, ...bounds.map(b => b.x + b.width)) - x + pad, h = Math.max(100, ...bounds.map(b => b.y + b.height)) - y + pad
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color(background, '#ffffff')}"/>${visible.map(e => elementSvg(e, files)).join('')}</svg>`
}
export function parseBoardFile(text: string): { elements: BoardElement[]; files: BoardFiles } {
  const data = JSON.parse(text), base = { id: 'import', actor: 'local', clock: 1 }
  if (!data || data.type !== 'lira-whiteboard' || !Array.isArray(data.elements) || data.elements.length > 1000 || !data.files || typeof data.files !== 'object') throw new Error('Arquivo de quadro inválido.')
  if (!data.elements.every((element: unknown) => validWhiteboardOperation({ ...base, kind: 'element', element })) ||
      !Object.values(data.files).every(file => validWhiteboardOperation({ ...base, kind: 'file', file }))) throw new Error('Arquivo com objetos inválidos ou imagens não locais.')
  return { elements: data.elements, files: data.files }
}
