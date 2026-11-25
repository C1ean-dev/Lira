// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
beforeAll(async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ filter: 'none' } as any)
  await import('../../collaboration/boardFile')
})
const shape = { id: 'shape', type: 'rectangle', x: 10, y: 20, width: 80, height: 30, version: 1, versionNonce: 1, isDeleted: false }
describe('local-only imported drawings', () => {
  it('rejects remote image URLs and missing image bytes', async () => {
    const { parseBoardFile } = await import('../../collaboration/boardFile')
    const image = { ...shape, type: 'image', fileId: 'remote' }
    expect(() => parseBoardFile(JSON.stringify({ type: 'excalidraw', elements: [image], files: {} }))).toThrow()
    expect(() => parseBoardFile(JSON.stringify({ type: 'excalidraw', elements: [image], files: { remote: { id: 'remote', created: 1, mimeType: 'image/png', dataURL: 'https://example.com/image.png' } } }))).toThrow()
  })
  it('reserves an operation for the clear barrier before importing any objects', async () => {
    const { parseBoardFile } = await import('../../collaboration/boardFile')
    expect(() => parseBoardFile(JSON.stringify({ type: 'excalidraw', elements: Array.from({ length: 1000 }, (_, i) => ({ ...shape, id: String(i) })), files: {} }))).toThrow()
  })
  it('rejects embeds, oversized objects and invalid coordinates before updating the editor', async () => {
    const { parseBoardFile } = await import('../../collaboration/boardFile')
    for (const element of [{ ...shape, type: 'embeddable', link: 'https://example.com' }, { ...shape, text: 'a'.repeat(300000) }, { ...shape, x: null }]) {
      expect(() => parseBoardFile(JSON.stringify({ type: 'excalidraw', elements: [element], files: {} }))).toThrow()
    }
  })
})
