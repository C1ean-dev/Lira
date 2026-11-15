import { generateUUID } from '../utils/uuid'

export type BoardPoint = { x: number; y: number }
export type BoardTool = 'selection' | 'hand' | 'rectangle' | 'diamond' | 'ellipse' | 'arrow' | 'line' | 'freedraw' | 'text' | 'image' | 'eraser' | 'laser'
export type BoardElement = {
  id: string; type: Exclude<BoardTool, 'selection' | 'hand' | 'eraser' | 'laser'> | 'frame';
  x: number; y: number; width: number; height: number; version: number; versionNonce: number; isDeleted: boolean;
  strokeColor?: string; backgroundColor?: string; strokeWidth?: number; strokeStyle?: string;
  opacity?: number; angle?: number; points?: [number, number][]; text?: string; fontSize?: number;
  fileId?: string | null; index?: string | null; groupIds?: string[]; locked?: boolean;
}
export type BoardFile = { id: string; mimeType: string; dataURL: string; created: number }
export type BoardFiles = Record<string, BoardFile>
export type BoardView = { x: number; y: number; zoom: number }
export const revision = () => Math.floor(Math.random() * 2 ** 31)
export function makeElement(type: BoardElement['type'], point: BoardPoint, style: Partial<BoardElement> = {}): BoardElement {
  return { id: generateUUID(), type, ...point, width: 0, height: 0, version: 1, versionNonce: revision(), isDeleted: false,
    strokeColor: '#1e1e1e', backgroundColor: 'transparent', strokeWidth: 2, opacity: 100, angle: 0, fontSize: 24, index: `m${Date.now()}${generateUUID()}`, ...style }
}
export function screenToBoard(point: BoardPoint, view: BoardView): BoardPoint { return { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom } }
export function drawElement(start: BoardElement, end: BoardPoint, constrained = false): BoardElement {
  let dx = end.x - start.x, dy = end.y - start.y
  if (constrained) {
    if (start.type === 'arrow' || start.type === 'line') {
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, length = Math.hypot(dx, dy)
      dx = Math.cos(a) * length; dy = Math.sin(a) * length
    } else { const size = Math.max(Math.abs(dx), Math.abs(dy)); dx = (dx < 0 ? -1 : 1) * size; dy = (dy < 0 ? -1 : 1) * size }
  }
  if (start.type === 'arrow' || start.type === 'line') return { ...start, width: Math.abs(dx), height: Math.abs(dy), points: [[0, 0], [dx, dy]] }
  return { ...start, x: start.x + Math.min(0, dx), y: start.y + Math.min(0, dy), width: Math.abs(dx), height: Math.abs(dy) }
}
export function resizeElement(element: BoardElement, width: number, height: number): BoardElement {
  const sx = Math.max(1, width) / (element.width || 1), sy = Math.max(1, height) / (element.height || 1)
  return { ...element, width: Math.max(1, width), height: Math.max(1, height),
    ...(element.points ? { points: element.points.map(([x, y]) => [x * sx, y * sy] as [number, number]) } : {}),
    ...(element.type === 'text' ? { fontSize: Math.max(8, (element.fontSize || 24) * sy) } : {}) }
}
export function elementBounds(e: BoardElement) {
  const xs = e.points?.map(p => p[0]) || [0, e.width], ys = e.points?.map(p => p[1]) || [0, e.height]
  return { x: e.x + Math.min(...xs), y: e.y + Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}
export function hitElement(e: BoardElement, point: BoardPoint, tolerance = 6): boolean {
  const b = elementBounds(e), cx = b.x + b.width / 2, cy = b.y + b.height / 2, angle = -(e.angle || 0)
  const x = cx + (point.x - cx) * Math.cos(angle) - (point.y - cy) * Math.sin(angle)
  const y = cy + (point.x - cx) * Math.sin(angle) + (point.y - cy) * Math.cos(angle)
  if (e.points?.length) {
    return e.points.some(([px, py], i, points) => {
      const [ax, ay] = points[Math.max(0, i - 1)], dx = px - ax, dy = py - ay
      const t = Math.max(0, Math.min(1, ((x - e.x - ax) * dx + (y - e.y - ay) * dy) / (dx * dx + dy * dy || 1)))
      return Math.hypot(x - e.x - ax - t * dx, y - e.y - ay - t * dy) <= tolerance + (e.strokeWidth || 2)
    })
  }
  return x >= b.x - tolerance && x <= b.x + b.width + tolerance && y >= b.y - tolerance && y <= b.y + b.height + tolerance
}
type HistoryEntry = { before: BoardElement[]; after: BoardElement[] }
export class BoardHistory {
  past: HistoryEntry[] = []; future: HistoryEntry[] = []
  record(before: BoardElement[], after: BoardElement[]) { this.past.push(structuredClone({ before, after })); if (this.past.length > 100) this.past.shift(); this.future = [] }
  private restore(entry: HistoryEntry, current: BoardElement[], direction: 'before' | 'after') {
    const target = new Map(entry[direction].map(e => [e.id, e])), ids = new Set([...entry.before, ...entry.after].map(e => e.id))
    return [...ids].flatMap(id => {
      const latest = current.find(e => e.id === id), desired = target.get(id)
      if (!latest && !desired) return []
      return [{ ...(desired || latest!), isDeleted: desired?.isDeleted ?? true, version: Math.max(latest?.version || 0, desired?.version || 0) + 1, versionNonce: revision() }]
    })
  }
  undo(current: BoardElement[]) { const e = this.past.pop(); if (!e) return []; this.future.push(e); return this.restore(e, current, 'before') }
  redo(current: BoardElement[]) { const e = this.future.pop(); if (!e) return []; this.past.push(e); return this.restore(e, current, 'after') }
}
