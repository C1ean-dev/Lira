// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
beforeAll(async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ filter: 'none', measureText: (text: string) => ({ width: text.length * 10 }) } as any)
  await Promise.all([
    import('../../collaboration/boardFile'),
    import('../../collaboration/boardRestore'),
    import('@excalidraw/excalidraw'),
  ])
})
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
  it('keeps an in-progress one-point SDK stroke when restoring a scene', async () => {
    const { restoreSceneElements } = await import('../../collaboration/boardRestore')
    const dot = { ...shape, type: 'freedraw', points: [[0, 0]] }
    expect(restoreSceneElements([dot] as any)).toMatchObject([{ id: 'shape', points: [[0, 0], [0, 0]] }])
  })
  it('exports restored geometry with the real SVG exporter without fetching assets', async () => {
    const { parseBoardFile } = await import('../../collaboration/boardFile')
    const { exportToSvg } = await import('@excalidraw/excalidraw')
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('external resource'))
    try {
      const scene = parseBoardFile(JSON.stringify({ type: 'lira-whiteboard', elements: [shape], files: {} }))
      const svg = await exportToSvg({ elements: scene.elements, appState: {}, files: scene.files })
      expect(svg.tagName.toLowerCase()).toBe('svg')
      expect(svg.querySelector('path')).not.toBeNull()
      expect(fetch).not.toHaveBeenCalled()
    } finally { fetch.mockRestore() }
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
