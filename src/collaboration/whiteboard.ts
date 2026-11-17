import { z } from 'zod'
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
const finite = z.number().finite()
const base = { id: z.string().min(1).max(160), actor: z.string().min(1).max(128), clock: finite.int().min(1).max(1e12) }
const elementSchema = z.object({
  id: z.string().min(1).max(160), type: z.enum(['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'freedraw', 'text', 'image', 'frame']),
  x: finite, y: finite, width: finite, height: finite, version: finite.int().min(1), versionNonce: finite.int(), isDeleted: z.boolean(),
  points: z.array(z.tuple([finite, finite])).max(10000).optional(), text: z.string().optional(),
  strokeWidth: finite.optional(), fontSize: finite.optional(), opacity: finite.optional(), angle: finite.optional(),
  strokeColor: z.string().optional(), backgroundColor: z.string().optional(),
  groupIds: z.array(z.string()).optional(), boundElements: z.array(z.object({ id: z.string(), type: z.string() })).nullable().optional(),
  fileId: z.string().nullable().optional(),
}).passthrough().refine(element => !['arrow', 'line', 'freedraw'].includes(element.type) || !!element.points?.length,
  'A line must include its points').refine(element => { try { return JSON.stringify(element).length <= 250_000 } catch { return false } }, 'Element too large')
const fileSchema = z.object({ id: z.string().min(1).max(160), created: finite,
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), dataURL: z.string().max(MAX_WHITEBOARD_FILE_SIZE),
}).passthrough().refine(file => file.dataURL.startsWith(`data:${file.mimeType};base64,`), 'Images must be inline data')
export const whiteboardOperationSchema = z.discriminatedUnion('kind', [
  z.object({ ...base, kind: z.literal('clear') }),
  z.object({ ...base, kind: z.literal('remove'), targetId: z.string().min(1).max(160) }),
  z.object({ ...base, kind: z.literal('element'), element: elementSchema }),
  z.object({ ...base, kind: z.literal('file'), file: fileSchema }),
  z.object({ ...base, kind: z.literal('stroke'), color: z.string().regex(/^#[a-f\d]{6}$/i), width: finite.min(1).max(20),
    points: z.array(z.object({ x: finite.min(0).max(1), y: finite.min(0).max(1) })).min(1).max(512) }),
]) as unknown as z.ZodType<WhiteboardOperation>

export function validWhiteboardOperation(op: unknown): op is WhiteboardOperation {
  return whiteboardOperationSchema.safeParse(op).success
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
