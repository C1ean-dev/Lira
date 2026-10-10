
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

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const DIGIT = new Int8Array(128).fill(-1)
for (let i = 0; i < BASE64.length; i++) DIGIT[BASE64.charCodeAt(i)] = i

const COMMA = 44
const SEMICOLON = 59

function wholePositive(value: number): boolean {
  return Number.isInteger(value) && value >= 1
}

export function lookupPositions(
  map: RawSourceMap | null | undefined,
  targets: { line: number; col: number }[]
): (OriginalPosition | null)[] {
  const results: (OriginalPosition | null)[] = targets.map(() => null)
  if (!map || typeof map.mappings !== 'string' || !Array.isArray(map.sources) || map.sections !== undefined) return results
  const mappings = map.mappings
  const sources = map.sources as unknown[]
  const names = Array.isArray(map.names) ? (map.names as unknown[]) : []
  const root = typeof map.sourceRoot === 'string' && map.sourceRoot ? map.sourceRoot.replace(/\/+$/, '') + '/' : ''

  const order = targets
    .map((target, index) => ({ index, line: target.line - 1, col: target.col - 1 }))
    .filter((target) => wholePositive(target.line + 1) && wholePositive(target.col + 1))
    .sort((a, b) => a.line - b.line || a.col - b.col)
  if (order.length === 0) return results

  let generatedLine = 0
  let generatedColumn = 0
  let source = 0
  let line = 0
  let column = 0
  let name = 0

  let covered = false
  let coveredSource = 0
  let coveredLine = 0
  let coveredColumn = 0
  let coveredName = -1

  let next = 0
  const answer = (target: { index: number }) => {
    if (!covered) return
    const file = sources[coveredSource]
    if (typeof file !== 'string') return
    const symbol = coveredName >= 0 ? names[coveredName] : undefined
    results[target.index] = {
      source: root + file,
      line: coveredLine + 1,
      col: coveredColumn + 1,
      ...(typeof symbol === 'string' ? { name: symbol } : {}),
    }
  }
  const endLine = () => {
    while (next < order.length && order[next].line === generatedLine) answer(order[next++])
    generatedLine++
    generatedColumn = 0
    covered = false
  }

  const length = mappings.length
  let position = 0
  while (next < order.length) {
    if (position >= length) {
      endLine()
      break
    }
    const code = mappings.charCodeAt(position)
    if (code === SEMICOLON) {
      position++
      endLine()
      continue
    }
    if (code === COMMA) {
      position++
      continue
    }

    let fields = 0
    let first = 0
    let second = 0
    let third = 0
    let fourth = 0
    let fifth = 0
    while (position < length) {
      const start = mappings.charCodeAt(position)
      if (start === COMMA || start === SEMICOLON) break
      let value = 0
      let shift = 0
      let digit: number
      do {
        if (position >= length) return results
        const char = mappings.charCodeAt(position++)
        digit = char < 128 ? DIGIT[char] : -1
        if (digit < 0) return results
        value |= (digit & 31) << shift
        shift += 5
      } while (digit & 32)
      const signed = value & 1 ? -(value >>> 1) : value >>> 1
      if (fields === 0) first = signed
      else if (fields === 1) second = signed
      else if (fields === 2) third = signed
      else if (fields === 3) fourth = signed
      else if (fields === 4) fifth = signed
      fields++
    }

    generatedColumn += first
    while (next < order.length && order[next].line === generatedLine && order[next].col < generatedColumn) answer(order[next++])
    if (fields >= 4) {
      source += second
      line += third
      column += fourth
      if (fields >= 5) name += fifth
      covered = true
      coveredSource = source
      coveredLine = line
      coveredColumn = column
      coveredName = fields >= 5 ? name : -1
    } else {
      covered = false
    }
  }
  return results
}
