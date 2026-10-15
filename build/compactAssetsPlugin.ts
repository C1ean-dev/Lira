import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { createImageDistribution } from './imageDistribution'

const CATALOG_NAMES = ['nativeAssets.json', 'nativeAvatarPresets.json']
const VIRTUAL_CATALOG = '\0lira-catalog:'

export function compactAssetsPlugin(): Plugin {
  let root = ''
  let distribution: ReturnType<typeof createImageDistribution>
  const inputs: string[] = []
  return {
    name: 'lira-compact-assets', enforce: 'pre', apply: 'build',
    config: () => ({ publicDir: false, base: './' }),
    configResolved(config) { root = config.root },
    buildStart() {
      inputs.length = 0
      const catalogs = Object.fromEntries(CATALOG_NAMES.map(name => {
        const file = path.join(root, 'src/data', name)
        inputs.push(file)
        return [name, JSON.parse(fs.readFileSync(file, 'utf8'))]
      }))
      const publicFiles: Record<string, Buffer> = {}
      const visit = (dir: string, relative = '') => {
        for (const name of fs.readdirSync(dir).sort()) {
          const absolute = path.join(dir, name)
          const output = relative + name
          if (fs.statSync(absolute).isDirectory()) visit(absolute, output + '/')
          else { inputs.push(absolute); publicFiles[output] = fs.readFileSync(absolute) }
        }
      }
      visit(path.join(root, 'public'))
      distribution = createImageDistribution(catalogs, publicFiles)
      for (const input of inputs) this.addWatchFile(input)
      for (const [fileName, source] of Object.entries(distribution.files)) this.emitFile({ type: 'asset', fileName, source })
      this.emitFile({ type: 'asset', fileName: 'assets/bundled-images.json', source: JSON.stringify(distribution.manifest) })
    },
    resolveId(source, importer) {
      if (!importer || !CATALOG_NAMES.some(name => source.endsWith('/' + name))) return null
      // Only rewrite the shipped catalogs, never arbitrary JSON imports.
      const resolved = path.posix.normalize(path.posix.join(importer.replace(/\\/g, '/').split('/').slice(0, -1).join('/'), source))
      if (!resolved.endsWith('/src/data/' + path.posix.basename(source))) return null
      if (root && resolved !== path.posix.join(root.replace(/\\/g, '/'), 'src/data', path.posix.basename(source))) return null
      return VIRTUAL_CATALOG + path.posix.basename(source) + '.js'
    },
    load(id) {
      if (id.startsWith(VIRTUAL_CATALOG)) {
        const name = id.slice(VIRTUAL_CATALOG.length, -3)
        return 'export default ' + JSON.stringify(distribution.catalogs[name])
      }
      if (id.replace(/\\/g, '/').endsWith('/src/media/bundledImageManifest.ts')) return 'export default ' + JSON.stringify(distribution.manifest)
      return null
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return html.replace(/((?:src|href)=['"])(\/[^'"\s]+)(['"])/g, (match, start, source, end) => {
          const mapped = distribution.manifest.aliases[source]
          return mapped ? `${start}./${mapped}${end}` : match
        })
      },
    },
  }
}
