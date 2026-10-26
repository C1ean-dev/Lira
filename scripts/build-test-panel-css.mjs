import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindConfig from '../tailwind.config.js'

export async function buildTestPanelCss(output, content = [
  './src/components/grid/CallTranscriptPanel.tsx',
  { raw: 'flex justify-end h-screen bg-slate-950', extension: 'html' },
]) {
  await build({
    entryPoints: ['src/index.css'], outfile: output,
    bundle: true, logLevel: 'silent', loader: { '.svg': 'dataurl' },
    plugins: [{ name: 'test-panel-css', setup(builder) {
      builder.onLoad({ filter: /[\\/]src[\\/]index\.css$/ }, async ({ path: file }) => {
        const css = await postcss([tailwindcss({
          ...tailwindConfig,
          content,
        }), autoprefixer()])
          .process(await fs.readFile(file, 'utf8'), { from: file })
        return { contents: css.css, loader: 'css', resolveDir: path.dirname(file) }
      })
    } }],
  })
}
