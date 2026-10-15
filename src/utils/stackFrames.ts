
export interface StackFrame {
  fn?: string
  file?: string
  line?: number
  col?: number
  app: boolean
  min?: string
}

export const MAX_STACK_FRAMES = 30

const PROJECT_DIRS = ['src', 'electron', 'dist-electron', 'out', 'dist']

export function isAppPath(file: string): boolean {
  if (file.includes('node_modules/')) return false
  return PROJECT_DIRS.some((dir) => file.startsWith(`${dir}/`))
}

export function normalizeFramePath(raw: string): string {
  let text = String(raw).trim().replace(/\\/g, '/')
  if (text.startsWith('node:')) return text
  const isWeb = /^https?:\/\//i.test(text)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = text.replace(/[?#].*$/, '')

  const packaged = /app\.asar(?:\.unpacked)?\/(.+)$/.exec(text)
  if (packaged) return packaged[1]

  const modules = text.lastIndexOf('node_modules/')
  if (modules !== -1) return text.slice(modules)

  for (const dir of ['dist-electron', 'out']) {
    const mainBuild = text.lastIndexOf(`/${dir}/`)
    if (mainBuild !== -1) return text.slice(mainBuild + 1)
  }
  for (const dir of ['src', 'electron']) {
    const index = text.indexOf(`/${dir}/`)
    if (index !== -1) return text.slice(index + 1)
  }
  const bundle = text.lastIndexOf('/dist/')
  if (bundle !== -1) return text.slice(bundle + 1)

  if (isWeb) return text.replace(/^https?:\/\/[^/]+\/?/i, '')
  return text.slice(text.lastIndexOf('/') + 1)
}

function isLocation(text: string): boolean {
  return /:\d+(?::\d+)?$/.test(text) || text === '<anonymous>' || text === 'native'
}

function readLocation(location: string): Pick<StackFrame, 'file' | 'line' | 'col'> {
  let text = location
  if (text.startsWith('eval at ')) {
    const inner = /\(([^()]+)\)/.exec(text)
    if (inner) text = inner[1]
  }
  if (text === '<anonymous>' || text === 'native') return {}

  const full = /^(.*):(\d+):(\d+)$/.exec(text)
  if (full) return { file: full[1], line: Number(full[2]), col: Number(full[3]) }
  const lineOnly = /^(.*):(\d+)$/.exec(text)
  if (lineOnly) return { file: lineOnly[1], line: Number(lineOnly[2]) }
  return { file: text }
}

function parseLine(line: string): StackFrame | null {
  if (!/^\s+at\s/.test(line)) return null
  const rest = line.trim().slice(3).trim()
  if (!rest) return null

  let fn: string | undefined
  let location: string | undefined
  const open = rest.indexOf(' (')
  if (open !== -1 && rest.endsWith(')')) {
    fn = rest.slice(0, open)
    location = rest.slice(open + 2, -1)
  } else if (isLocation(rest)) {
    location = rest
  } else {
    fn = rest
  }

  const place = location ? readLocation(location) : {}
  const frame: StackFrame = { app: false }
  if (fn) frame.fn = fn.replace(/^async\s+/, '')
  if (place.file && place.file !== '<anonymous>') {
    frame.file = normalizeFramePath(place.file)
    if (place.line !== undefined) frame.line = place.line
    if (place.col !== undefined) frame.col = place.col
    frame.app = isAppPath(frame.file)
  }
  return {
    ...(frame.fn ? { fn: frame.fn } : {}),
    ...(frame.file ? { file: frame.file } : {}),
    ...(frame.line !== undefined ? { line: frame.line } : {}),
    ...(frame.col !== undefined ? { col: frame.col } : {}),
    app: frame.app,
  }
}

export function parseStack(stack: string | null | undefined, max: number = MAX_STACK_FRAMES): StackFrame[] {
  if (typeof stack !== 'string' || !stack) return []
  const frames: StackFrame[] = []
  for (const line of stack.split('\n')) {
    const frame = parseLine(line)
    if (!frame) continue
    frames.push(frame)
    if (frames.length >= max) break
  }
  return frames
}

export function formatFrame(frame: StackFrame): string {
  const place = frame.file
    ? `${frame.file}${frame.line !== undefined ? `:${frame.line}` : ''}${frame.col !== undefined ? `:${frame.col}` : ''}`
    : ''
  if (frame.fn && place) return `${frame.fn} (${place})`
  return frame.fn || place || '<unknown>'
}
