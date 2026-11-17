import fs from 'node:fs'
import path from 'node:path'

/** The pinned SDK unconditionally adds a CDN fallback, even with an asset path. */
export function localizeBoardFontFallback(source: string): string {
  return source.replace(/("ASSETS_FALLBACK_URL",\s*)`https:\/\/esm\.sh\/[\s\S]*?\/dist\/prod\/`/g, '$1window.EXCALIDRAW_ASSET_PATH')
}

export function copyBoardFonts(fontsDirectory: string, outputDirectory: string): void {
  fs.cpSync(fontsDirectory, path.join(outputDirectory, 'excalidraw-assets', 'fonts'), { recursive: true })
}
export function boardFontPath(fontsDirectory: string, url: string): string | null {
  try {
    const prefix = '/excalidraw-assets/fonts/'
    const pathname = decodeURIComponent(url.split('?')[0])
    if (!pathname.startsWith(prefix)) return null
    const name = pathname.slice(prefix.length)
    if (!/^[a-z\d_./-]+\.(?:woff2?|ttf|otf)$/i.test(name) || name.split('/').some(part => part === '..' || part === '.')) return null
    const target = path.resolve(fontsDirectory, name)
    const relative = path.relative(path.resolve(fontsDirectory), target)
    return relative.startsWith('..') || path.isAbsolute(relative) ? null : target
  } catch { return null }
}
