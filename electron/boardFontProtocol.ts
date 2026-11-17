import fs from 'node:fs/promises'
import { boardFontPath } from '../build/boardFonts'

/** Fetchable local fonts also let the SDK embed fonts in exported SVG files. */
export function createBoardFontHandler(fontsDirectory: string) {
  return async (request: { url: string; method: string }): Promise<Response> => {
    try {
      const url = new URL(request.url)
      const file = url.protocol === 'lira-board-font:' && url.host === 'local' && !url.username && !url.password
        ? boardFontPath(fontsDirectory, `/excalidraw-assets${url.pathname}`) : null
      if (!file || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 })
      const bytes = await fs.readFile(file)
      return new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes), { headers: {
        'content-type': file.endsWith('.woff2') ? 'font/woff2' : 'font/woff',
        'access-control-allow-origin': '*', 'cache-control': 'public, max-age=31536000, immutable',
      } })
    } catch { return new Response(null, { status: 404 }) }
  }
}
