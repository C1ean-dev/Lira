import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'


export interface RawSourceMap {
  sources?: unknown
  names?: unknown
  mappings?: unknown
  sourceRoot?: unknown
  sections?: unknown
}

export interface OriginalPosition {
  source: string
  line: number
  col: number
  name?: string
}

const cache = new WeakMap<RawSourceMap, { trace: TraceMap; lines: number }>()

export function lookupPositions(map: RawSourceMap | null | undefined, targets: { line: number; col: number }[]): (OriginalPosition | null)[] {
  if (!map || typeof map.mappings !== 'string' || !Array.isArray(map.sources) || map.sections !== undefined) return targets.map(() => null)
  try {
    let entry = cache.get(map)
    if (!entry) {
      // Validate VLQ framing only; numerical decoding is entirely the library's job.
      // Keep valid preceding lines when a downloaded map has a truncated suffix.
      const lines = map.mappings.split(';')
      let validLines = 0
      for (const line of lines) {
        const valid = !line || line.split(',').every(segment => {
          if (!segment) return true
          if (!/^(?:[g-z0-9+/]*[A-Za-f])+$/.test(segment)) return false
          const fields = (segment.match(/[A-Za-f]/g) || []).length
          return fields === 1 || fields === 4 || fields === 5
        })
        if (!valid) break
        validLines++
      }
      entry = { trace: new TraceMap({ version: 3, sources: map.sources.map(source => typeof source === 'string' ? source : ''),
        names: Array.isArray(map.names) ? map.names.map(name => typeof name === 'string' ? name : '') : [],
        mappings: lines.slice(0, validLines).join(';'),
      }), lines: validLines }
      cache.set(map, entry)
    }
    const root = typeof map.sourceRoot === 'string' && map.sourceRoot ? map.sourceRoot.replace(/\/+$/, '') + '/' : ''
    return targets.map(({ line, col }) => {
      if (!Number.isInteger(line) || !Number.isInteger(col) || line < 1 || col < 1 || line > entry.lines) return null
      const result = originalPositionFor(entry.trace, { line, column: col - 1 })
      return typeof result.source === 'string' && result.source && result.line !== null && result.column !== null ? {
        source: root + result.source, line: result.line, col: result.column + 1,
        ...(result.name ? { name: result.name } : {}),
      } : null
    })
  } catch { return targets.map(() => null) }
}
