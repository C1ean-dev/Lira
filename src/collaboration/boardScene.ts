import type { BoardElement, BoardFiles } from './boardEditor'

import { visibleStrokes, type WhiteboardDocument } from './whiteboard'

export function getWhiteboardElements(doc: WhiteboardDocument): BoardElement[] {
  const elements = Object.values(doc.operations).flatMap(op => op.kind === 'element' ? [op.element] : [])
  const ids = new Set(elements.map(e => e.id))
  for (const stroke of visibleStrokes(doc)) {
    if (ids.has(stroke.id)) continue
    const x = stroke.points[0].x * 1000, y = stroke.points[0].y * 600
    const points = stroke.points.map<[number, number]>(p => [p.x * 1000 - x, p.y * 600 - y])
    // A legacy click is a visible dot. The SDK requires at least two points.
    if (points.length === 1) points.push([...points[0]])
    elements.push({ id: stroke.id, type: 'freedraw', x, y,
      width: Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0])),
      height: Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])),
      points, strokeColor: stroke.color, strokeWidth: stroke.width,
      backgroundColor: 'transparent', strokeStyle: 'solid',
      opacity: 100, angle: 0, version: 1, versionNonce: 0, isDeleted: false,
      groupIds: [], locked: false,
      index: null,
    } as unknown as BoardElement)
  }
  return elements.sort((a, b) => {
    const ai = a.index || '', bi = b.index || ''
    return ai < bi ? -1 : ai > bi ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

export function getChangedElements(doc: WhiteboardDocument, elements: readonly BoardElement[]): BoardElement[] {
  const known = new Map(getWhiteboardElements(doc).map(e => [e.id, e]))
  return elements.filter(e => {
    const previous = known.get(e.id)
    return !previous || e.version > previous.version || (e.version === previous.version && e.versionNonce < previous.versionNonce)
  })
}

export function getWhiteboardFiles(doc: WhiteboardDocument): BoardFiles {
  return Object.fromEntries(Object.values(doc.operations).flatMap(op => op.kind === 'file' ? [[op.file.id, op.file]] : []))
}

