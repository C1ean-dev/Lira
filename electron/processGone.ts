
export interface ProcessGoneDetails {
  type?: string
  reason?: string
  exitCode?: number
  name?: string
  serviceName?: string
}

export interface ProcessGoneReport {
  level: 'info' | 'warn' | 'error'
  severity?: 'fatal'
  message: string
  data: Record<string, unknown>
}

const EXIT_CODE_NAMES: Record<number, string> = {
  0x80000003: 'BREAKPOINT',
  0xc0000005: 'ACCESS_VIOLATION',
  0xc000001d: 'ILLEGAL_INSTRUCTION',
  0xc00000fd: 'STACK_OVERFLOW',
  0xc000012d: 'COMMITMENT_LIMIT',
  0xc000013a: 'CONTROL_C_EXIT',
  0xc0000142: 'DLL_INIT_FAILED',
  0xc0000374: 'HEAP_CORRUPTION',
  0xc0000409: 'STACK_BUFFER_OVERRUN',
  0xe0000008: 'OUT_OF_MEMORY',
}

export function exitCodeName(code: number | undefined): string | undefined {
  if (typeof code !== 'number' || !Number.isInteger(code)) return undefined
  return EXIT_CODE_NAMES[code >>> 0]
}

function exitCodeHex(code: number): string {
  return `0x${(code >>> 0).toString(16).toUpperCase().padStart(8, '0')}`
}

export function describeProcessGone(kind: 'renderer' | 'child', details: ProcessGoneDetails): ProcessGoneReport {
  const reason = details?.reason || 'unknown'
  const code = typeof details?.exitCode === 'number' ? details.exitCode : undefined
  const name = exitCodeName(code)
  const hex = code !== undefined && (name || code < 0 || code > 0xffff) ? exitCodeHex(code) : undefined
  const exit = code === undefined ? '' : hex ? `${hex}${name ? ` ${name}` : ''}` : String(code)

  const data: Record<string, unknown> = {
    process: kind === 'renderer' ? 'renderer' : details?.type || 'unknown',
    reason,
    ...(code !== undefined ? { exitCode: code } : {}),
    ...(hex ? { exitCodeHex: hex } : {}),
    ...(name ? { exitCodeName: name } : {}),
    ...(details?.name ? { name: details.name } : {}),
    ...(details?.serviceName ? { serviceName: details.serviceName } : {}),
  }

  const message =
    kind === 'renderer'
      ? `Render process gone: ${reason}${exit ? ` (exit ${exit})` : ''}`
      : `Child process gone: ${data.process}${details?.name ? ` ${details.name}` : ''} (${reason}${exit ? `, exit ${exit}` : ''})`

  if (reason === 'clean-exit') return { level: 'info', message, data }
  if (reason === 'killed') return { level: 'warn', message, data }
  return { level: 'error', ...(kind === 'renderer' ? { severity: 'fatal' as const } : {}), message, data }
}
