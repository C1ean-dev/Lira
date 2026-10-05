/**
 * Builds source maps for tests: the `mappings` string from a list of segments,
 * the same encoding (base64 VLQ, relative values) a bundler writes.
 */

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function encodeVlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1
  let out = ''
  do {
    let digit = rest & 31
    rest >>>= 5
    if (rest > 0) digit |= 32
    out += BASE64[digit]
  } while (rest > 0)
  return out
}

/**
 * One segment: the column in the generated line (0-based) and, when the code
 * came from a source, the source index, original line and column (0-based) and
 * optionally a name index.
 */
export type Segment = [generatedColumn: number, source?: number, line?: number, column?: number, name?: number]

/** `lines[i]` are the segments of generated line i, in column order. */
export function encodeMappings(lines: Segment[][]): string {
  let source = 0
  let line = 0
  let column = 0
  let name = 0
  return lines
    .map((segments) => {
      let generatedColumn = 0
      return segments
        .map((segment) => {
          let out = encodeVlq(segment[0] - generatedColumn)
          generatedColumn = segment[0]
          if (segment.length > 1) {
            out += encodeVlq(segment[1]! - source) + encodeVlq(segment[2]! - line) + encodeVlq(segment[3]! - column)
            source = segment[1]!
            line = segment[2]!
            column = segment[3]!
            if (segment.length > 4) {
              out += encodeVlq(segment[4]! - name)
              name = segment[4]!
            }
          }
          return out
        })
        .join(',')
    })
    .join(';')
}

export function makeSourceMap(sources: string[], lines: Segment[][], names: string[] = []) {
  return { version: 3, sources, names, mappings: encodeMappings(lines) }
}
