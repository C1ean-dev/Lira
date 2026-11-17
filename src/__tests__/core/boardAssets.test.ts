import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { boardFontPath, copyBoardFonts, localizeBoardFontFallback } from '../../../build/boardFonts'
import { createBoardFontHandler } from '../../../electron/boardFontProtocol'
import { prepareBoardAssets } from '../../collaboration/boardAssets'

describe('local drawing editor assets', () => {
  it('copies the SDK fonts into the distributable asset tree', () => {
    const output = fs.mkdtempSync(path.join(tmpdir(), 'lira-board-fonts-'))
    try {
      const source = path.resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts')
      copyBoardFonts(source, output)
      const copied = path.join(output, 'excalidraw-assets/fonts')
      expect(fs.readdirSync(copied)).toContain('Excalifont')
      const files = fs.readdirSync(copied, { recursive: true }) as string[]
      expect(files.some(file => file.endsWith('.woff2'))).toBe(true)
      expect(fs.readdirSync(output)).toEqual(['excalidraw-assets'])
    } finally { fs.rmSync(output, { recursive: true, force: true }) }
  })
  it('removes the SDK remote CDN fallback from both installed bundles', () => {
    for (const variant of ['dev', 'prod']) {
      const directory = path.resolve(`node_modules/@excalidraw/excalidraw/dist/${variant}`)
      const source = fs.readdirSync(directory).filter(file => file.endsWith('.js')).map(file => fs.readFileSync(path.join(directory, file), 'utf8')).find(code => code.includes('https://esm.sh/'))!
      expect(source).toBeTruthy()
      const localized = localizeBoardFontFallback(source)
      expect(localized).not.toContain('https://esm.sh/')
      expect(localized).toContain('window.EXCALIDRAW_ASSET_PATH')
    }
  })
  it('serves only font files within the SDK font directory', () => {
    const root = path.resolve('fonts')
    expect(boardFontPath(root, '/excalidraw-assets/fonts/Excalifont/font.woff2')).toBe(path.join(root, 'Excalifont/font.woff2'))
    for (const value of ['/excalidraw-assets/fonts/../../private.woff2', '/excalidraw-assets/fonts/%2e%2e/private.woff2',
      '/excalidraw-assets/fonts/a.js', '/excalidraw-assets/fonts/C:/secret.woff2']) expect(boardFontPath(root, value)).toBeNull()
  })
  it('makes only bundled fonts fetchable from the installed desktop renderer', async () => {
    const root = fs.mkdtempSync(path.join(tmpdir(), 'lira-font-handler-'))
    try {
      fs.writeFileSync(path.join(root, 'test.woff2'), Buffer.from([1, 2, 3]))
      const handle = createBoardFontHandler(root)
      const response = await handle({ url: 'lira-board-font://local/fonts/test.woff2', method: 'GET' })
      expect(response.headers.get('content-type')).toBe('font/woff2')
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
      for (const url of ['lira-board-font://evil/fonts/test.woff2', 'lira-board-font://local/fonts/%2e%2e/test.woff2', 'lira-board-font://local/fonts/test.js', 'lira-board-font://local/fonts/missing.woff2']) expect((await handle({ url, method: 'GET' })).status).toBe(404)
      expect((await handle({ url: 'lira-board-font://local/fonts/test.woff2', method: 'POST' })).status).toBe(404)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
  it('sets the SDK asset location relative to the installed file renderer', () => {
    vi.stubGlobal('window', { location: { protocol: 'file:', href: 'file:///application/dist/index.html' } })
    try {
      prepareBoardAssets()
      expect((window as any).EXCALIDRAW_ASSET_PATH).toBe('file:///application/dist/excalidraw-assets/')
    } finally { vi.unstubAllGlobals() }
  })
})
