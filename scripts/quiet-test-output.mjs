export const SLOW_TEST_MS = 5000
export const isNotice = text => /warning|\bwarn\b|\berror\b|\berro\b|\bfatal\b|\balerta\b|\baviso\b/i.test(text)
export const slowTestLine = (name, duration) => `[LENTO] ${name} (${duration.toFixed(1)}ms)\n`

// Console output often includes simulated errors in otherwise passing tests.
// Keep each notice once, without dumping its stack, JSON payload or normal logs.
// Real test failures are reported separately with their complete diagnostics.
export function compactNotices(content, type, seen) {
  const output = []
  for (const raw of String(content).replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/)) {
    if (!raw || /^\s|^[{}\],]|^\[diag:/i.test(raw)) continue
    if (type !== 'stderr' && !isNotice(raw)) continue
    const message = raw.trim()
    if (seen.has(message)) continue
    seen.add(message)
    const level = /\berror\b|\berro\b|\bfatal\b|\bfailed\b|\bfalha\b|exception/i.test(message) ? 'ERRO' : 'AVISO'
    output.push(`[${level}] ${message.length > 240 ? message.slice(0, 237) + '...' : message}`)
  }
  return output
}
