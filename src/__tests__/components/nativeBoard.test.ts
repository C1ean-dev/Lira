// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
beforeAll(() => { vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ filter: 'none', measureText: (text: string) => ({ width: text.length * 10 }) } as any) })
const shape = { id: 'shape', type: 'rectangle', x: -10, y: 20, width: 80, height: 30, version: 1, versionNonce: 1, isDeleted: false }
describe('SDK scene file migration', () => {
  it('restores legacy geometry and stable object IDs through the real SDK', async () => {
    const { parseBoardFile } = await import('../../collaboration/boardFile')
    const scene = parseBoardFile(JSON.stringify({ type: 'lira-whiteboard', elements: [shape], files: {} }))
    expect(scene.elements).toMatchObject([shape])
    expect(scene.elements[0]).toHaveProperty('seed', 1)
    expect(scene.elements[0]).toHaveProperty('groupIds')
    expect(parseBoardFile(JSON.stringify({ type: 'lira-whiteboard', elements: [shape], files: {} }))).toEqual(scene)
  })
  it('round-trips a restored scene through the native Excalidraw serialization', async () => {
    const { parseBoardFile } = await import('../../collaboration/boardFile')
    const { serializeAsJSON } = await import('@excalidraw/excalidraw')
    const scene = parseBoardFile(JSON.stringify({ type: 'lira-whiteboard', elements: [shape], files: {} }))
    const serialized = serializeAsJSON(scene.elements, {}, scene.files, 'local')
    expect(JSON.parse(serialized).type).toBe('excalidraw')
    expect(parseBoardFile(serialized).elements).toMatchObject([shape])
  })
  it('preserves local image bytes and their references', async () => {
    const { parseBoardFile } = await import('../../collaboration/boardFile')
    const file = { id: 'image', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==', created: 1 }
    const scene = parseBoardFile(JSON.stringify({ type: 'lira-whiteboard', elements: [{ ...shape, type: 'image', fileId: 'image' }], files: { image: file } }))
    expect(scene.files.image).toEqual(file)
    expect(scene.elements[0]).toMatchObject({ type: 'image', fileId: 'image' })
  })
})
