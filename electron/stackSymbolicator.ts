import type { ErrorReport, ReportedError } from '../src/utils/errorReport'
import { RawSourceMap, lookupPositions } from '../src/utils/sourceMapLookup'
import { StackFrame, isAppPath, normalizeFramePath } from '../src/utils/stackFrames'

const BUNDLE_FILE = /^(?:dist|dist-electron)\/.+\.(?:js|mjs|cjs)$/
const MAX_ERROR_CHAIN = 4

export interface Symbolicator {
  frames(frames: StackFrame[]): StackFrame[]
  report(report: ErrorReport): ErrorReport
  forget(): void
}

export interface SymbolicatorOptions {
  loadMap(file: string): RawSourceMap | null
}

function sourcePath(bundle: string, source: string): string {
  if (source.includes('\u0000')) return source.slice(source.lastIndexOf('/') + 1)
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('/')) return normalizeFramePath(source)
  const parts = bundle.split('/').slice(0, -1)
  for (const part of source.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return normalizeFramePath(`/${parts.join('/')}`)
}

const isPosition = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1

export function createSymbolicator(options: SymbolicatorOptions): Symbolicator {
  const maps = new Map<string, RawSourceMap | null>()

  const mapOf = (file: string): RawSourceMap | null => {
    if (maps.has(file)) return maps.get(file) ?? null
    let map: RawSourceMap | null = null
    try {
      map = options.loadMap(file)
    } catch {
    }
    maps.set(file, map)
    return map
  }

  const frames = (input: StackFrame[]): StackFrame[] => {
    if (!Array.isArray(input)) return []
    try {
      const byBundle = new Map<string, number[]>()
      input.forEach((frame, index) => {
        if (!frame || typeof frame.file !== 'string' || !BUNDLE_FILE.test(frame.file)) return
        if (!isPosition(frame.line) || !isPosition(frame.col)) return
        byBundle.set(frame.file, [...(byBundle.get(frame.file) ?? []), index])
      })
      if (byBundle.size === 0) return input

      const output = input.slice()
      for (const [bundle, indexes] of byBundle) {
        const map = mapOf(bundle)
        if (!map) continue
        const positions = lookupPositions(
          map,
          indexes.map((index) => ({ line: input[index].line as number, col: input[index].col as number }))
        )
        positions.forEach((position, i) => {
          if (!position) return
          const frame = input[indexes[i]]
          const file = sourcePath(bundle, position.source)
          output[indexes[i]] = {
            ...(frame.fn ? { fn: frame.fn } : {}),
            file,
            line: position.line,
            col: position.col,
            app: isAppPath(file),
            min: `${bundle}:${frame.line}:${frame.col}`,
          }
        })
      }
      return output
    } catch {
      return input
    }
  }

  const report = (target: ErrorReport): ErrorReport => {
    try {
      if (!target || typeof target !== 'object') return target
      let error: ReportedError | undefined = target.error
      for (let depth = 0; error && depth < MAX_ERROR_CHAIN; depth++) {
        error.frames = frames(error.frames)
        error = error.cause
      }
      if (target.loggedAt) target.loggedAt = frames(target.loggedAt)
      if (target.componentStack) target.componentStack = frames(target.componentStack)
    } catch {
    }
    return target
  }

  return { frames, report, forget: () => maps.clear() }
}
