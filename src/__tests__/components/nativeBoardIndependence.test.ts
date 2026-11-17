import { afterEach, describe, expect, it, vi } from 'vitest'
import { prepareBoardAssets } from '../../collaboration/boardAssets'
afterEach(() => vi.unstubAllGlobals())
describe('self-hosted drawing SDK resources', () => {
  it('loads web fonts from the current application origin', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:', href: 'https://lira.example/space/' } })
    prepareBoardAssets()
    expect((window as any).EXCALIDRAW_ASSET_PATH).toBe('https://lira.example/excalidraw-assets/')
  })
  it('supports local font fetches for SVG export in installed Electron', () => {
    vi.stubGlobal('window', { electronAPI: {}, location: { protocol: 'file:', href: 'file:///C:/Lira/dist/index.html' } })
    prepareBoardAssets()
    expect((window as any).EXCALIDRAW_ASSET_PATH).toBe('lira-board-font://local/')
  })
  it('loads installed desktop fonts from the distribution without a CDN', () => {
    vi.stubGlobal('window', { location: { protocol: 'file:', href: 'file:///C:/Lira/dist/index.html' } })
    prepareBoardAssets()
    expect((window as any).EXCALIDRAW_ASSET_PATH).toBe('file:///C:/Lira/dist/excalidraw-assets/')
  })
})
