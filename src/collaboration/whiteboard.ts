import type { BoardElement, BoardFile } from './boardEditor'
export type Point = { x: number; y: number }
type Base = { id: string; actor: string; clock: number }
export type Stroke = Base & { kind: 'stroke'; color: string; width: number; points: Point[] }
export type ElementOperation = Base & { kind: 'element'; element: BoardElement }
export type FileOperation = Base & { kind: 'file'; file: BoardFile }
export type WhiteboardOperation = Stroke | ElementOperation | FileOperation | (Base & { kind: 'remove'; targetId: string }) | (Base & { kind: 'clear' })
export type WhiteboardDocument = { schemaVersion: 2; operations: Record<string, WhiteboardOperation>; clock: number }
export const createWhiteboard = (): WhiteboardDocument => ({ schemaVersion: 2, operations: {}, clock: 0 })
export const MAX_WHITEBOARD_OPERATIONS = 1000
export const MAX_WHITEBOARD_FILE_SIZE = 2_000_000
const elementTypes = new Set(['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'image', 'frame'])

export function validWhiteboardOperation(op: any): op is WhiteboardOperation {
  if (!op || typeof op.id !== 'string' || !op.id || op.id.length > 160 || typeof op.actor !== 'string' ||
      !op.actor || op.actor.length > 128 || !Number.isSafeInteger(op.clock) || op.clock < 1 || op.clock > 1e12) return false
  if (op.kind === 'clear') return true
  if (op.kind === 'remove') return typeof op.targetId === 'string' && op.targetId.length > 0 && op.targetId.length <= 160
  if (op.kind === 'element') {
    const e = op.element
    if (!e || typeof e.id !== 'string' || !e.id || e.id.length > 160 || !elementTypes.has(e.type) ||
      !['x', 'y', 'width', 'height'].every(key => Number.isFinite(e[key])) ||
      !Number.isSafeInteger(e.version) || e.version < 1 || !Number.isSafeInteger(e.versionNonce) || typeof e.isDeleted !== 'boolean') return false
    if (e.points !== undefined && (!Array.isArray(e.points) || e.points.length > 10000 || !e.points.every((p: any) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)))) return false
    if (e.text !== undefined && typeof e.text !== 'string') return false
    for (const key of ['strokeWidth', 'fontSize', 'opacity', 'angle']) if (e[key] !== undefined && !Number.isFinite(e[key])) return false
    try { return JSON.stringify(e).length <= 250_000 } catch { return false }
  }
  if (op.kind === 'file') {
    const f = op.file
    return !!f && typeof f.id === 'string' && f.id.length > 0 && f.id.length <= 160 && Number.isFinite(f.created) &&
      ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(f.mimeType) &&
      typeof f.dataURL === 'string' && f.dataURL.startsWith(`data:${f.mimeType};base64,`) && f.dataURL.length <= MAX_WHITEBOARD_FILE_SIZE
  }
  return op.kind === 'stroke' && /^#[a-f\d]{6}$/i.test(op.color) && Number.isFinite(op.width) && op.width >= 1 && op.width <= 20 &&
    Array.isArray(op.points) && op.points.length > 0 && op.points.length <= 512 &&
    op.points.every((p: any) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
}
export function applyWhiteboardOperation(doc: WhiteboardDocument, op: unknown): WhiteboardDocument {
  if (!validWhiteboardOperation(op) || Object.prototype.hasOwnProperty.call(doc.operations, op.id)) return doc
  // Keep immutable revisions while the editor handles gestures.
  const accepted: WhiteboardOperation = op.kind === 'element' ? { ...op, element: structuredClone(op.element) } : op
  const operations = Object.values(doc.operations)
  const clear = operations.filter(item => item.kind === 'clear').sort(order).pop()
  if (clear && order(op, clear) <= 0) return doc
  // A clear is a compaction barrier. Late packets cannot restore erased strokes,
  // and even a full board can be cleared to start drawing again.
  if (op.kind === 'clear') return {
    schemaVersion: 2, operations: Object.fromEntries([...operations.filter(item => order(item, op) > 0), op].map(item => [item.id, item])),
    clock: Math.max(doc.clock, op.clock),
  }
  // Compact each object independently; retain deletion tombstones for late packets.
  if (op.kind === 'element' || op.kind === 'file') {
    const previous = operations.find(item => op.kind === 'element'
      ? item.kind === 'element' && item.element.id === op.element.id
      : item.kind === 'file' && item.file.id === op.file.id)
    if (previous) {
      const comparison = op.kind === 'element' && previous.kind === 'element'
        ? op.element.version - previous.element.version || previous.element.versionNonce - op.element.versionNonce || order(op, previous)
        : order(op, previous)
      if (comparison <= 0) return doc
      const next = { ...doc.operations }
      delete next[previous.id]
      next[op.id] = accepted
      return { schemaVersion: 2, operations: next, clock: Math.max(doc.clock, op.clock) }
    }
  }
  if (operations.length >= MAX_WHITEBOARD_OPERATIONS) return doc
  return { schemaVersion: 2, operations: { ...doc.operations, [op.id]: accepted }, clock: Math.max(doc.clock, op.clock) }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const order = (a: WhiteboardOperation, b: WhiteboardOperation) => a.clock - b.clock || compare(a.actor, b.actor) || compare(a.id, b.id)
export function visibleStrokes(doc: WhiteboardDocument): Stroke[] {
  const ops = Object.values(doc.operations).sort(order)
  const clear = ops.filter(op => op.kind === 'clear').pop()
  const removed = new Set(ops.flatMap(op => op.kind === 'remove' ? [op.targetId] : []))
  return ops.filter((op): op is Stroke => op.kind === 'stroke' && !removed.has(op.id) && (!clear || order(op, clear) > 0))
}
