import { describe, it, expect } from 'vitest'
import { formatDigest, formatReport, groupReports, parseReportLines } from '../utils/reportDigest'
import { buildErrorReport } from '../utils/errorReport'
import type { ErrorReport } from '../utils/errorReport'

const at = (minute: number, second = 0) => new Date(Date.UTC(2026, 9, 4, 10, minute, second))

const errorAt = (message: string, fn: string) => {
  const error = new Error(message)
  error.stack = [
    `Error: ${message}`,
    `    at ${fn} (http://localhost:5173/src/p2p/PeerManager.ts:883:15)`,
    '    at _socket.onmessage (http://localhost:5173/node_modules/.vite/deps/peerjs.js?v=2:5329:12)',
  ].join('\n')
  return error
}

const hostTaken = (minute: number, session: string, count = 1): ErrorReport =>
  buildErrorReport({
    source: 'renderer',
    session,
    kind: 'console',
    scope: 'P2P Failover',
    message: 'Error claiming host: Error: ID "lira-ROOM-host" is taken',
    error: errorAt('ID "lira-ROOM-host" is taken', 'PeerManager.promoteToHost'),
    data: { attempt: 2 },
    context: { room: { inRoom: true, role: 'guest', players: 2 }, p2p: { signaling: 'open' } },
    breadcrumbs: [
      { t: at(minute - 1, 50).toISOString(), cat: 'room', event: 'peer-disconnected', data: { roomCode: 'ROOM' } },
      { t: at(minute - 1, 58).toISOString(), cat: 'log', event: 'warn', data: { scope: 'P2P Failover', message: 'Host disconnected' }, n: 3 },
    ],
    stats: { 'p2p/sender-stats': { t: at(minute - 1, 30).toISOString(), cat: 'p2p', event: 'sender-stats', data: { kbps: 300 } } },
    count,
    now: at(minute),
    random: () => 0,
  })

const renderCrash = (minute: number): ErrorReport =>
  buildErrorReport({
    source: 'renderer',
    session: 'bbbb2222',
    kind: 'react',
    severity: 'fatal',
    scope: 'ErrorBoundary',
    message: 'the screen failed to render Error: Cannot read properties of undefined',
    error: errorAt('Cannot read properties of undefined', 'ChatDrawer'),
    componentStack: '\n    at ChatDrawer (http://localhost:5173/src/components/ChatDrawer.tsx:120:5)\n    at App (http://localhost:5173/src/App.tsx:47:33)',
    now: at(minute),
    random: () => 0,
  })

describe('parseReportLines', () => {
  it('reads one report per line and skips what is not one', () => {
    const text = [JSON.stringify(hostTaken(1, 'aaaa1111')), '', 'not json', '{"half":', JSON.stringify({ no: 'fingerprint' }), JSON.stringify(renderCrash(2))].join('\n')
    expect(parseReportLines(text).map((report) => report.kind)).toEqual(['console', 'react'])
  })

  it('reads Windows line endings', () => {
    const text = `${JSON.stringify(hostTaken(1, 'aaaa1111'))}\r\n${JSON.stringify(renderCrash(2))}\r\n`
    expect(parseReportLines(text)).toHaveLength(2)
  })
})

describe('groupReports', () => {
  it('groups the occurrences of one error and adds up what each report stands for', () => {
    const groups = groupReports([hostTaken(1, 'aaaa1111'), hostTaken(5, 'aaaa1111', 12), hostTaken(9, 'cccc3333')])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      fingerprint: hostTaken(1, 'x').fingerprint,
      occurrences: 14,
      reports: 3,
      first: at(1).toISOString(),
      last: at(9).toISOString(),
      sessions: ['aaaa1111', 'cccc3333'],
      scope: 'P2P Failover',
    })
    expect(groups[0].latest.t).toBe(at(9).toISOString())
  })

  it('does not depend on the order the reports come in', () => {
    const [group] = groupReports([hostTaken(9, 'cccc3333'), hostTaken(1, 'aaaa1111'), hostTaken(5, 'aaaa1111')])

    expect(group).toMatchObject({ first: at(1).toISOString(), last: at(9).toISOString(), sessions: ['cccc3333', 'aaaa1111'] })
    expect(group.latest.session).toBe('cccc3333')
  })

  it('lists fatal errors first, then the most frequent, then the most recent', () => {
    const quiet = buildErrorReport({ source: 'main', session: 'electron-1', scope: 'Updater', message: 'download failed', now: at(30), random: () => 0 })
    const groups = groupReports([hostTaken(1, 'aaaa1111', 20), quiet, renderCrash(2)])

    expect(groups.map((group) => group.scope)).toEqual(['ErrorBoundary', 'P2P Failover', 'Updater'])
  })
})

describe('formatReport', () => {
  it('writes everything needed to understand one error, in reading order', () => {
    expect(formatReport(hostTaken(5, 'aaaa1111', 3)).split('\n')).toEqual([
      `ERROR  [P2P Failover] Error claiming host: Error: ID "lira-ROOM-host" is taken`,
      `  report r-${at(5).getTime().toString(36)}-0000  fp ${hostTaken(5, 'x').fingerprint}  x3  console  renderer aaaa1111  2026-10-04T10:05:00.000Z`,
      '',
      '  Error: ID "lira-ROOM-host" is taken',
      '    > PeerManager.promoteToHost (src/p2p/PeerManager.ts:883:15)',
      '      _socket.onmessage (node_modules/.vite/deps/peerjs.js:5329:12)',
      '',
      '  data',
      '    {"attempt":2}',
      '',
      '  context',
      '    room  {"inRoom":true,"role":"guest","players":2}',
      '    p2p   {"signaling":"open"}',
      '',
      '  before  (oldest first)',
      '    -10.0s  room/peer-disconnected  {"roomCode":"ROOM"}',
      '     -2.0s  log/warn x3  {"scope":"P2P Failover","message":"Host disconnected"}',
      '',
      '  latest measurements',
      '    -30.0s  p2p/sender-stats  {"kbps":300}',
    ])
  })

  it('shows the component stack of a render error and marks it fatal', () => {
    const lines = formatReport(renderCrash(2)).split('\n')
    expect(lines[0]).toBe('FATAL  [ErrorBoundary] the screen failed to render Error: Cannot read properties of undefined')
    expect(lines).toContain('  components')
    expect(lines).toContain('    > ChatDrawer (src/components/ChatDrawer.tsx:120:5)')
    expect(lines).toContain('    > App (src/App.tsx:47:33)')
  })

  it('says when context and trail were read after the fact', () => {
    const late = { ...hostTaken(5, 'aaaa1111', 4), late: true }
    expect(formatReport(late)).toContain('context  (read when the report was written, not when the error happened)')
  })

  it('shows where a message without an error was logged, and a cause', () => {
    const cause = new Error('disk full')
    cause.stack = 'Error: disk full\n    at write (http://localhost:5173/src/utils/save.ts:3:1)'
    const failure = Object.assign(new Error('could not save'), { cause })
    failure.stack = 'Error: could not save\n    at save (http://localhost:5173/src/utils/save.ts:9:1)'
    const withCause = formatReport(buildErrorReport({ source: 'renderer', session: 's', error: failure, now: at(1), random: () => 0 }))
    expect(withCause).toContain('  caused by Error: disk full')
    expect(withCause).toContain('    > write (src/utils/save.ts:3:1)')

    const logged = formatReport(
      buildErrorReport({
        source: 'renderer',
        session: 's',
        scope: 'Tray',
        message: 'icon missing',
        loggedAt: [{ fn: 'loadIcon', file: 'electron/trayManager.ts', line: 40, col: 5, app: true }],
        now: at(1),
        random: () => 0,
      })
    )
    expect(logged).toContain('  logged at')
    expect(logged).toContain('    > loadIcon (electron/trayManager.ts:40:5)')
  })

  it('survives a report with missing parts', () => {
    expect(() => formatReport({ message: 'bare' } as never)).not.toThrow()
    expect(formatReport({ message: 'bare' } as never).split('\n')[0]).toBe('ERROR  bare')
  })
})

describe('formatDigest', () => {
  const groups = groupReports([hostTaken(1, 'aaaa1111'), hostTaken(5, 'aaaa1111', 12), renderCrash(2)])

  it('gives one block per error, with how often, when and where in our code', () => {
    expect(formatDigest(groups).split('\n')).toEqual([
      '2 different errors, 14 occurrences',
      '',
      `FATAL  fp ${renderCrash(2).fingerprint}  x1  [ErrorBoundary] the screen failed to render Error: Cannot read properties of undefined`,
      '       react, renderer  2026-10-04T10:02:00.000Z  session bbbb2222',
      '       at ChatDrawer (src/p2p/PeerManager.ts:883:15)',
      '',
      `ERROR  fp ${hostTaken(1, 'x').fingerprint}  x13  [P2P Failover] Error claiming host: Error: ID "lira-ROOM-host" is taken`,
      '       console, renderer  2026-10-04T10:01:00.000Z .. 2026-10-04T10:05:00.000Z  session aaaa1111',
      '       at PeerManager.promoteToHost (src/p2p/PeerManager.ts:883:15)',
    ])
  })

  it('points at our own code, not at the dependency that threw', () => {
    const error = new Error('ID is taken')
    error.stack = [
      'Error: ID is taken',
      '    at _socket.onmessage (http://localhost:5173/node_modules/.vite/deps/peerjs.js?v=2:5329:12)',
      '    at PeerManager.promoteToHost (http://localhost:5173/src/p2p/PeerManager.ts:883:15)',
    ].join('\n')
    const report = buildErrorReport({ source: 'renderer', session: 's', error, now: at(1), random: () => 0 })

    expect(formatDigest(groupReports([report]))).toContain('       at PeerManager.promoteToHost (src/p2p/PeerManager.ts:883:15)')
  })

  it('can be limited to the first errors', () => {
    const text = formatDigest(groups, { limit: 1 })
    expect(text).toContain('FATAL')
    expect(text).not.toContain('P2P Failover')
    expect(text).toContain('(1 more not shown)')
  })

  it('says so when there is nothing', () => {
    expect(formatDigest([])).toBe('No error reports.')
  })
})
