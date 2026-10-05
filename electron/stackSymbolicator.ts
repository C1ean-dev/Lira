import type { ErrorReport, ReportedError } from '../src/utils/errorReport'
import { RawSourceMap, lookupPositions } from '../src/utils/sourceMapLookup'
import { StackFrame, isAppPath, normalizeFramePath } from '../src/utils/stackFrames'

/**
 * In the installed app the code runs from minified bundles, so a stack frame
 * says `dist/assets/bootstrap-B3a7.js:412:3301`. The build ships a source map
 * next to each bundle (vite.config.ts); this turns such a frame back into the
 * source file and line before the error report is written. The frame keeps the
 * bundle position in `min`, and the function name the bundle gave it.
 *
 * A dev run needs none of this (its frames already point at the sources) and
 * no map is read for it. Never throws: what cannot be translated stays as it is.
 */

const BUNDLE_FILE = /^(?:dist|dist-electron)\/.+\.(?:js|mjs|cjs)$/
const MAX_ERROR_CHAIN = 4

export interface Symbolicator {
  /** The same frames, with those inside a bundle translated to the sources. */
  frames(frames: StackFrame[]): StackFrame[]
  /** Translates every stack of a report, in place. */
  report(report: ErrorReport): ErrorReport
  /** Drops the maps read so far (they are large): the next use reads them again. */
  forget(): void
}

export interface SymbolicatorOptions {
  /** The source map of a bundle (`dist/assets/x.js`), or null when it has none. */
  loadMap(file: string): RawSourceMap | null
}

/** A source of the map, as a path of the project. */
function sourcePath(bundle: string, source: string): string {
  // A helper the bundler made up ("\0vite/preload-helper.js"): not a file of the project.
  if (source.includes('\u0000')) return source.slice(source.lastIndexOf('/') + 1)
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('/')) return normalizeFramePath(source)
  // Relative to the folder of the bundle: dist/assets + ../../src/a.ts = src/a.ts
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
      // no map for this bundle
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
      // the report is written as it came
    }
    return target
  }

  return { frames, report, forget: () => maps.clear() }
}
