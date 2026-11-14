export type Point = { x: number; y: number }
type Base = { id: string; actor: string; clock: number }
export type Stroke = Base & { kind: 'stroke'; color: string; width: number; points: Point[] }
export type WhiteboardOperation = Stroke | (Base & { kind: 'remove'; targetId: string }) | (Base & { kind: 'clear' })
export type WhiteboardDocument = { operations: Record<string, WhiteboardOperation>; clock: number }
export const createWhiteboard = (): WhiteboardDocument => ({ operations: {}, clock: 0 })
export const MAX_WHITEBOARD_OPERATIONS = 1000

export function validWhiteboardOperation(op: any): op is WhiteboardOperation {
  if (!op || typeof op.id !== 'string' || !op.id || op.id.length > 160 || typeof op.actor !== 'string' ||
      !op.actor || op.actor.length > 128 || !Number.isSafeInteger(op.clock) || op.clock < 1 || op.clock > 1e12) return false
  if (op.kind === 'clear') return true
  if (op.kind === 'remove') return typeof op.targetId === 'string' && op.targetId.length > 0 && op.targetId.length <= 160
  return op.kind === 'stroke' && /^#[a-f\d]{6}$/i.test(op.color) && Number.isFinite(op.width) && op.width >= 1 && op.width <= 20 &&
    Array.isArray(op.points) && op.points.length > 0 && op.points.length <= 512 &&
    op.points.every((p: any) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)
}
export function applyWhiteboardOperation(doc: WhiteboardDocument, op: unknown): WhiteboardDocument {
  if (!validWhiteboardOperation(op) || Object.prototype.hasOwnProperty.call(doc.operations, op.id)) return doc
  const operations = Object.values(doc.operations)
  const clear = operations.filter(item => item.kind === 'clear').sort(order).pop()
  if (clear && order(op, clear) <= 0) return doc
  // A clear is a compaction barrier. Late packets cannot restore erased strokes,
  // and even a full board can be cleared to start drawing again.
  if (op.kind === 'clear') return {
    operations: Object.fromEntries([...operations.filter(item => order(item, op) > 0), op].map(item => [item.id, item])),
    clock: Math.max(doc.clock, op.clock),
  }
  if (operations.length >= MAX_WHITEBOARD_OPERATIONS) return doc
  return { operations: { ...doc.operations, [op.id]: op }, clock: Math.max(doc.clock, op.clock) }
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const order = (a: WhiteboardOperation, b: WhiteboardOperation) => a.clock - b.clock || compare(a.actor, b.actor) || compare(a.id, b.id)
export function visibleStrokes(doc: WhiteboardDocument): Stroke[] {
  const ops = Object.values(doc.operations).sort(order)
  const clear = ops.filter(op => op.kind === 'clear').pop()
  const removed = new Set(ops.flatMap(op => op.kind === 'remove' ? [op.targetId] : []))
  return ops.filter((op): op is Stroke => op.kind === 'stroke' && !removed.has(op.id) && (!clear || order(op, clear) > 0))
}
