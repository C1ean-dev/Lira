import { restoreElements } from '@excalidraw/excalidraw'
import { getWhiteboardElements } from './boardScene'
import { createWhiteboard, applyWhiteboardOperation, type WhiteboardDocument } from './whiteboard'
import type { BoardElement } from './boardEditor'

export function restoreSceneElements(elements: readonly BoardElement[]) {
  const revisions = new Map(elements.map(element => [element.id, element]))
  const restored = restoreElements(elements.map(element => ({ ...element, seed: element.seed ?? 1, updated: element.updated ?? 0,
    ...(['line', 'arrow', 'freedraw'].includes(element.type) && 'points' in element && element.points.length === 1 ? { points: [element.points[0], element.points[0]] } : {}),
  })) as unknown as Parameters<typeof restoreElements>[0], null)
  // The SDK repairs missing fractional indices by bumping random revision nonces.
  // Restoration is not an edit: keep our persisted revisions deterministic.
  return restored.map(element => ({ ...element, version: revisions.get(element.id)!.version, versionNonce: revisions.get(element.id)!.versionNonce, updated: revisions.get(element.id)!.updated ?? 0 }))
}

/** Normalize legacy geometry through the SDK while keeping stable IDs and revisions. */
export function restoreBoardDocument(document: WhiteboardDocument): WhiteboardDocument {
  const elements = restoreSceneElements(getWhiteboardElements(document))
  const normalized = new Map(elements.map(element => [element.id, element]))
  let result = createWhiteboard()
  for (const operation of Object.values(document.operations)) {
    if (operation.kind === 'stroke' || operation.kind === 'element') {
      const element = normalized.get(operation.kind === 'element' ? operation.element.id : operation.id)
      if (element) result = applyWhiteboardOperation(result, { ...operation, kind: 'element', element })
    } else result = applyWhiteboardOperation(result, operation)
  }
  return result
}
