import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Bound open files while allowing independent disk reads to overlap. */
export async function findSourceMentions(root: string, files: string[], pattern: RegExp, extensions: Set<string>): Promise<string[]> {
  const sources = files.filter(file => extensions.has(path.extname(file).toLowerCase()))
  const results: string[][] = new Array(sources.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(16, sources.length) }, async () => {
    // Each worker owns its regexp so global/sticky state cannot leak between files.
    const matcher = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''))
    while (next < sources.length) {
      const index = next++
      const file = sources[index]
      const text = await readFile(path.join(root, file), 'utf8')
      const mentions: string[] = []
      // Most sources are clean: avoid allocating a string for every line.
      if (matcher.test(text)) {
        text.split(/\r?\n/).forEach((line, lineIndex) => {
          if (matcher.test(line)) mentions.push(`${file}:${lineIndex + 1}`)
        })
      }
      results[index] = mentions
    }
  }))
  return results.flat()
}
