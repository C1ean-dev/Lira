import { describe, it, expect } from 'vitest'
import {
  MAX_REPORT_BREADCRUMBS,
  MAX_REPORT_CHARS,
  REPORT_VERSION,
  buildErrorReport,
  describeError,
  fingerprintOf,
  makeReportId,
  normalizeErrorMessage,
  reportReference,
  sanitizeErrorReport,
} from '../utils/errorReport'

const NOW = new Date('2026-10-04T10:20:30.456Z')

const errorAt = (message: string, frames: string[], name = 'Error') => {
  const error = new Error(message)
  error.name = name
  error.stack = [`${name}: ${message}`, ...frames.map((frame) => `    at ${frame}`)].join('\n')
  return error
}

const HOST_TAKEN = errorAt('ID "lira-F8FEA8DF-BC1D-468A-8740-6F6437982CCD-host" is taken', [
  'PeerManager.promoteToHost (http://localhost:5173/src/p2p/PeerManager.ts?t=1:883:15)',
  '_socket.onmessage (http://localhost:5173/node_modules/.vite/deps/peerjs.js?v=2:5329:12)',
])

describe('normalizeErrorMessage', () => {
  it('replaces what changes from one occurrence to the next', () => {
    expect(normalizeErrorMessage('ID "lira-F8FEA8DF-BC1D-468A-8740-6F6437982CCD-host" is taken')).toBe('ID "<peer>" is taken')
    expect(normalizeErrorMessage('Could not connect to peer lira-F8FEA8DF-BC1D-468A-8740-6F6437982CCD-peer-c5sjk')).toBe(
      'Could not connect to peer <peer>'
    )
    expect(normalizeErrorMessage('Timed out after 5000ms (attempt 3)')).toBe('Timed out after <n>ms (attempt <n>)')
    expect(normalizeErrorMessage('Failed to fetch https://api.github.com/repos/x/releases?per_page=5')).toBe('Failed to fetch <url>')
    expect(normalizeErrorMessage('space 0d9f2c1e-1111-4222-8333-444455556666 not found')).toBe('space <uuid> not found')
    expect(normalizeErrorMessage('user u-abcdefghij0123456789 left')).toBe('user <user> left')
    expect(normalizeErrorMessage('track 411c90aa3be7 ended')).toBe('track <hex> ended')
  })

  it('keeps what tells one error from another', () => {
    expect(normalizeErrorMessage("Cannot read properties of undefined (reading 'roomId')")).toBe(
      "Cannot read properties of undefined (reading 'roomId')"
    )
    expect(normalizeErrorMessage('H264 over P2P is not supported')).toBe('H264 over P2P is not supported')
  })

  it('collapses whitespace and bounds the length', () => {
    expect(normalizeErrorMessage('a\n   b\t c')).toBe('a b c')
    expect(normalizeErrorMessage('x'.repeat(1000)).length).toBe(200)
  })
})

describe('fingerprintOf', () => {
  it('is eight hex characters', () => {
    expect(fingerprintOf({ message: 'boom' })).toMatch(/^[0-9a-f]{8}$/)
  })

  it('is the same for the same error with other ids, lines and dependency frames', () => {
    const first = describeError(HOST_TAKEN)
    const second = describeError(
      errorAt('ID "lira-AAAAAAAA-BC1D-468A-8740-6F6437982CCD-host" is taken', [
        'PeerManager.promoteToHost (http://localhost:5173/src/p2p/PeerManager.ts?t=9:901:3)',
        'other.vendor (http://localhost:5173/node_modules/.vite/deps/peerjs.js?v=7:1:1)',
      ])
    )
    expect(fingerprintOf({ ...first, scope: 'P2P Failover' })).toBe(fingerprintOf({ ...second, scope: 'P2P Failover' }))
  })

  it('differs with the message, the kind of error, the scope and the place in our code', () => {
    const base = { name: 'Error', message: 'boom', scope: 'P2P', frames: describeError(HOST_TAKEN).frames }
    const print = fingerprintOf(base)
    expect(fingerprintOf({ ...base, message: 'other' })).not.toBe(print)
    expect(fingerprintOf({ ...base, name: 'TypeError' })).not.toBe(print)
    expect(fingerprintOf({ ...base, scope: 'Media' })).not.toBe(print)
    expect(
      fingerprintOf({
        ...base,
        frames: [{ fn: 'PeerManager.joinRoom', file: 'src/p2p/PeerManager.ts', line: 883, col: 15, app: true }],
      })
    ).not.toBe(print)
  })
})

describe('describeError', () => {
  it('reads name, message and frames of an error', () => {
    expect(describeError(HOST_TAKEN)).toEqual({
      name: 'Error',
      message: 'ID "lira-F8FEA8DF-BC1D-468A-8740-6F6437982CCD-host" is taken',
      frames: [
        { fn: 'PeerManager.promoteToHost', file: 'src/p2p/PeerManager.ts', line: 883, col: 15, app: true },
        { fn: '_socket.onmessage', file: 'node_modules/.vite/deps/peerjs.js', line: 5329, col: 12, app: false },
      ],
    })
  })

  it('keeps the code of the error (DOMException code, PeerJS type, Node code)', () => {
    expect(describeError(Object.assign(new Error('taken'), { type: 'unavailable-id' })).code).toBe('unavailable-id')
    expect(describeError(Object.assign(new Error('nope'), { code: 'ENOENT' })).code).toBe('ENOENT')
    expect(describeError(Object.assign(new Error('denied'), { name: 'NotAllowedError', code: 0 })).code).toBe('0')
  })

  it('follows the chain of causes, up to a limit', () => {
    const root = new Error('disk full')
    const middle = new Error('could not save', { cause: root })
    const top = new Error('sync failed', { cause: middle })
    const described = describeError(top)

    expect(described.message).toBe('sync failed')
    expect(described.cause?.message).toBe('could not save')
    expect(described.cause?.cause?.message).toBe('disk full')

    const loop: Error & { cause?: unknown } = new Error('loop')
    loop.cause = loop
    expect(() => JSON.stringify(describeError(loop))).not.toThrow()
  })

  it('reads error-like objects that are not Error instances', () => {
    expect(describeError({ name: 'PeerError', message: 'lost', stack: 'PeerError: lost\n    at run (http://localhost:5173/src/a.ts:1:2)' })).toEqual({
      name: 'PeerError',
      message: 'lost',
      frames: [{ fn: 'run', file: 'src/a.ts', line: 1, col: 2, app: true }],
    })
  })

  it('turns anything else into a message', () => {
    expect(describeError('plain text')).toEqual({ name: 'Error', message: 'plain text', frames: [] })
    expect(describeError({ status: 500 })).toEqual({ name: 'Error', message: '{"status":500}', frames: [] })
    expect(describeError(undefined)).toEqual({ name: 'Error', message: 'undefined', frames: [] })
  })

  it('bounds the message', () => {
    expect(describeError(new Error('x'.repeat(10000))).message.length).toBeLessThanOrEqual(2001)
  })
})

describe('makeReportId', () => {
  it('is made of the time and a random part', () => {
    expect(makeReportId(NOW, () => 0)).toBe(`r-${NOW.getTime().toString(36)}-0000`)
    expect(makeReportId(NOW, () => 0.9999999)).toBe(`r-${NOW.getTime().toString(36)}-zzzz`)
  })
})

describe('buildErrorReport', () => {
  it('builds the full report of an error', () => {
    const report = buildErrorReport({
      source: 'renderer',
      session: '9008ec95',
      kind: 'console',
      scope: 'P2P Failover',
      message: 'Error claiming host: Error: ID "lira-ROOM-host" is taken',
      error: HOST_TAKEN,
      data: { roomCode: 'ROOM', attempt: 2 },
      context: { room: { inRoom: true, role: 'guest' } },
      breadcrumbs: [{ t: '2026-10-04T10:20:29.000Z', cat: 'room', event: 'peer-disconnected' }],
      stats: { 'p2p/sender-stats': { t: '2026-10-04T10:20:28.000Z', cat: 'p2p', event: 'sender-stats', data: { kbps: 300 } } },
      now: NOW,
      random: () => 0,
    })

    expect(report).toEqual({
      v: REPORT_VERSION,
      id: `r-${NOW.getTime().toString(36)}-0000`,
      t: '2026-10-04T10:20:30.456Z',
      fingerprint: fingerprintOf({
        ...describeError(HOST_TAKEN),
        scope: 'P2P Failover',
        logged: 'Error claiming host: Error: ID "lira-ROOM-host" is taken',
      }),
      kind: 'console',
      severity: 'error',
      source: 'renderer',
      session: '9008ec95',
      scope: 'P2P Failover',
      message: 'Error claiming host: Error: ID "lira-ROOM-host" is taken',
      count: 1,
      error: describeError(HOST_TAKEN),
      data: { roomCode: 'ROOM', attempt: 2 },
      context: { room: { inRoom: true, role: 'guest' } },
      breadcrumbs: [{ t: '2026-10-04T10:20:29.000Z', cat: 'room', event: 'peer-disconnected' }],
      stats: { 'p2p/sender-stats': { t: '2026-10-04T10:20:28.000Z', cat: 'p2p', event: 'sender-stats', data: { kbps: 300 } } },
    })
  })

  it('tells apart the same error logged for different operations', () => {
    const failure = () => new SyntaxError('Unexpected token } in JSON at position 12')
    const read = (key: string) =>
      buildErrorReport({ source: 'renderer', session: 's', scope: 'Storage', message: `could not read ${key} SyntaxError: bad`, error: failure(), now: NOW })

    expect(read('lira_friends_list').fingerprint).toBe(read('lira_friends_list').fingerprint)
    expect(read('lira_friends_list').fingerprint).not.toBe(read('lira_saved_dms').fingerprint)
  })

  it('has sensible defaults', () => {
    const report = buildErrorReport({ source: 'main', session: 'electron-1', error: new TypeError('boom'), now: NOW })

    expect(report).toMatchObject({
      kind: 'handled',
      severity: 'error',
      message: 'TypeError: boom',
      count: 1,
      context: {},
      breadcrumbs: [],
    })
    expect(report).not.toHaveProperty('scope')
    expect(report).not.toHaveProperty('data')
    expect(report).not.toHaveProperty('stats')
    expect(report).not.toHaveProperty('componentStack')
  })

  it('reports a message that came without an error, grouped by where it was logged', () => {
    const loggedAt = [{ fn: 'saveSpaces', file: 'src/store/useSavedSpacesStore.ts', line: 40, col: 5, app: true }]
    const report = buildErrorReport({ source: 'renderer', session: 's', scope: 'Storage', message: 'quota exceeded', loggedAt, now: NOW })

    expect(report).not.toHaveProperty('error')
    expect(report.loggedAt).toEqual(loggedAt)
    expect(report.fingerprint).toBe(fingerprintOf({ message: 'quota exceeded', scope: 'Storage', frames: loggedAt }))
  })

  it('reads a React component stack and groups by it when the error has no frames', () => {
    const componentStack = '\n    at div\n    at CustomDropdown (http://localhost:5173/src/components/common/CustomDropdown.tsx:49:3)'
    const report = buildErrorReport({
      source: 'renderer',
      session: 's',
      kind: 'console',
      message: 'Warning: Encountered two children with the same key, `default`.',
      componentStack,
      now: NOW,
    })

    expect(report.componentStack).toEqual([
      { fn: 'div', app: false },
      { fn: 'CustomDropdown', file: 'src/components/common/CustomDropdown.tsx', line: 49, col: 3, app: true },
    ])
    expect(report.fingerprint).toBe(
      fingerprintOf({ message: 'Warning: Encountered two children with the same key, `default`.', frames: report.componentStack })
    )
  })

  it('makes the caller data safe to write', () => {
    const data: Record<string, unknown> = { stream: new Map(), big: 'x'.repeat(5000) }
    data.self = data
    const report = buildErrorReport({ source: 'renderer', session: 's', message: 'm', data, now: NOW })

    expect(report.data).toMatchObject({ stream: '[Map(0)]', self: '[Circular]' })
    expect(() => JSON.stringify(report)).not.toThrow()
    expect(JSON.stringify(report).length).toBeLessThan(2000)
  })

  it('marks a fatal error and a report written after the fact', () => {
    const report = buildErrorReport({ source: 'renderer', session: 's', message: 'm', severity: 'fatal', count: 7, late: true, now: NOW })
    expect(report).toMatchObject({ severity: 'fatal', count: 7, late: true })
  })
})

describe('sanitizeErrorReport', () => {
  const valid = () =>
    buildErrorReport({
      source: 'renderer',
      session: '9008ec95',
      kind: 'uncaught',
      scope: 'P2P',
      message: 'boom',
      error: HOST_TAKEN,
      context: { room: { inRoom: true } },
      breadcrumbs: [{ t: '2026-10-04T10:20:29.000Z', cat: 'room', event: 'join-open', data: { roomCode: 'R' } }],
      now: NOW,
      random: () => 0,
    })

  it('keeps a well-formed report as it is', () => {
    expect(sanitizeErrorReport(JSON.parse(JSON.stringify(valid())), 'renderer')).toEqual(valid())
  })

  it('does not trust where the report says it came from', () => {
    expect(sanitizeErrorReport({ ...valid(), source: 'main' }, 'renderer')?.source).toBe('renderer')
  })

  it('refuses what is not a report', () => {
    expect(sanitizeErrorReport(null, 'renderer')).toBeNull()
    expect(sanitizeErrorReport('report', 'renderer')).toBeNull()
    expect(sanitizeErrorReport([], 'renderer')).toBeNull()
    expect(sanitizeErrorReport({ id: 'r-1' }, 'renderer')).toBeNull()
  })

  it('replaces malformed fields with safe ones', () => {
    const report = sanitizeErrorReport(
      {
        message: 'boom',
        id: '../../etc/passwd',
        t: 'yesterday',
        fingerprint: 'not-hex',
        kind: 'DROP TABLE',
        severity: 'apocalyptic',
        session: 'a b c',
        scope: 42,
        count: -3,
        error: { name: 7, message: {}, frames: 'none', cause: 'x' },
        breadcrumbs: 'none',
        context: 'none',
      },
      'renderer'
    )!

    expect(report.id).toBe('r-unknown')
    expect(Number.isNaN(Date.parse(report.t))).toBe(false)
    expect(report.fingerprint).toMatch(/^[0-9a-f]{8}$/)
    expect(report.kind).toBe('handled')
    expect(report.severity).toBe('error')
    expect(report.session).toBe('unknown')
    expect(report).not.toHaveProperty('scope')
    expect(report.count).toBe(1)
    expect(report.error).toEqual({ name: 'Error', message: '', frames: [] })
    expect(report.breadcrumbs).toEqual([])
    expect(report.context).toEqual({})
  })

  it('accepts only whole, positive numbers where a number is expected', () => {
    const numbers = (count: unknown, line: unknown, n: unknown) =>
      sanitizeErrorReport(
        {
          ...valid(),
          count,
          error: { name: 'Error', message: 'm', frames: [{ fn: 'run', file: 'src/a.ts', line, col: line, app: true }] },
          breadcrumbs: [{ t: NOW.toISOString(), cat: 'room', event: 'join-open', n }],
        },
        'renderer'
      )!

    expect(numbers(12, 40, 3)).toMatchObject({ count: 12, error: { frames: [{ line: 40, col: 40 }] }, breadcrumbs: [{ n: 3 }] })
    for (const bad of [0, -3, 2.5, 5_000_000_000, '7', null]) {
      const report = numbers(bad, bad === 0 ? -1 : bad, bad)
      expect(report.count).toBe(1)
      expect(report.error!.frames[0]).toEqual({ fn: 'run', file: 'src/a.ts', app: true })
      expect(report.breadcrumbs[0]).not.toHaveProperty('n')
    }
  })

  it('bounds every part of a report', () => {
    const frame = { fn: 'f'.repeat(500), file: 'src/' + 'a'.repeat(500), line: 1, col: 2, app: true, extra: 'dropped' }
    const report = sanitizeErrorReport(
      {
        ...valid(),
        message: 'm'.repeat(10000),
        scope: 's'.repeat(100),
        error: { name: 'n'.repeat(500), message: 'e'.repeat(10000), frames: Array.from({ length: 200 }, () => frame) },
        breadcrumbs: Array.from({ length: 500 }, (_v, i) => ({ t: NOW.toISOString(), cat: 'c'.repeat(100), event: `e${i}`, n: 2 })),
      },
      'renderer'
    )!

    expect(report.message.length).toBeLessThanOrEqual(2001)
    expect(report.scope!.length).toBe(40)
    expect(report.error!.name.length).toBe(80)
    expect(report.error!.message.length).toBeLessThanOrEqual(2001)
    expect(report.error!.frames).toHaveLength(30)
    expect(report.error!.frames[0]).toEqual({ fn: 'f'.repeat(120), file: ('src/' + 'a'.repeat(500)).slice(0, 200), line: 1, col: 2, app: true })
    expect(report.breadcrumbs).toHaveLength(MAX_REPORT_BREADCRUMBS)
    expect(report.breadcrumbs[MAX_REPORT_BREADCRUMBS - 1].event).toBe('e499')
    expect(report.breadcrumbs[0].cat.length).toBe(40)
    expect(report.breadcrumbs[0].n).toBe(2)
  })

  it('keeps the whole report under the size limit, giving up the least useful parts first', () => {
    const heavy = (prefix: string) => Object.fromEntries(Array.from({ length: 40 }, (_v, i) => [`${prefix}${i}`, 'x'.repeat(480)]))
    const report = sanitizeErrorReport(
      {
        ...valid(),
        context: { a: heavy('a'), b: heavy('b'), c: heavy('c'), d: heavy('d') },
        breadcrumbs: Array.from({ length: 80 }, (_v, i) => ({ t: NOW.toISOString(), cat: 'x', event: `e${i}`, data: heavy('k') })),
      },
      'renderer'
    )!

    expect(JSON.stringify(report).length).toBeLessThanOrEqual(MAX_REPORT_CHARS)
    expect(report.error?.frames.length).toBe(2)
    expect(report.breadcrumbs).toHaveLength(80)
  })
})

describe('reportReference', () => {
  it('points a log line at its report', () => {
    expect(reportReference({ id: 'r-abc', fingerprint: '1a2b3c4d', count: 1 })).toBe('report r-abc fp=1a2b3c4d')
  })

  it('says how many occurrences the report stands for', () => {
    expect(reportReference({ id: 'r-abc', fingerprint: '1a2b3c4d', count: 12 })).toBe('report r-abc fp=1a2b3c4d x12')
  })
})
