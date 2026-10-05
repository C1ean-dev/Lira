import { describe, it, expect } from 'vitest'
import {
  MAX_MESSAGE_LENGTH,
  buildRecord,
  consoleErrorInput,
  extractScope,
  formatArgs,
  formatLogRecord,
  logFileName,
  sanitizeRecords,
  serializeError,
  shouldPersist,
} from '../utils/logFormat'
import { buildErrorReport } from '../utils/errorReport'

const T = new Date('2026-10-04T10:20:30.456Z')

describe('serializeError', () => {
  it('keeps name, message and stack of an Error', () => {
    const err = new TypeError('bad input')
    expect(serializeError(err)).toMatchObject({ name: 'TypeError', message: 'bad input' })
    expect(serializeError(err).stack).toContain('bad input')
  })

  it('turns anything else into a message', () => {
    expect(serializeError('boom')).toEqual({ name: 'Error', message: 'boom' })
    expect(serializeError(null).message).toBe('null')
    expect(serializeError({ code: 7 }).message).toBe('{"code":7}')
  })

  it('reads error-like objects (from another realm or IPC)', () => {
    const like = { name: 'RangeError', message: 'out', stack: 'RangeError: out\n  at x' }
    expect(serializeError(like)).toEqual(like)
  })
})

describe('formatArgs', () => {
  it('joins strings and primitives with a space', () => {
    expect(formatArgs(['a', 1, true, null, undefined])).toBe('a 1 true null undefined')
  })

  it('writes an Error as "Name: message" without the stack', () => {
    expect(formatArgs(['failed:', new Error('nope')])).toBe('failed: Error: nope')
  })

  it('serializes objects as JSON and survives circular references', () => {
    expect(formatArgs([{ a: 1 }])).toBe('{"a":1}')
    const loop: Record<string, unknown> = { name: 'x' }
    loop.self = loop
    expect(formatArgs([loop])).toContain('[Circular]')
  })

  it('caps very long messages', () => {
    const out = formatArgs(['x'.repeat(MAX_MESSAGE_LENGTH + 500)])
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH + 20)
    expect(out.endsWith('…[truncated]')).toBe(true)
  })

  it('never throws on hostile values', () => {
    const hostile = {
      get boom(): never {
        throw new Error('getter')
      },
    }
    expect(() => formatArgs([hostile])).not.toThrow()
  })
})

describe('extractScope', () => {
  it('takes a leading [Scope] off the first string', () => {
    expect(extractScope(['[PeerManager] connected', 1])).toEqual({
      scope: 'PeerManager',
      args: ['connected', 1],
    })
  })

  it('accepts scopes with a colon', () => {
    expect(extractScope(['[diag:media] swapped']).scope).toBe('diag:media')
  })

  it('leaves messages without a scope alone', () => {
    expect(extractScope(['plain message'])).toEqual({ args: ['plain message'] })
    expect(extractScope([new Error('x')]).scope).toBeUndefined()
  })

  it('handles a scope with no text after it', () => {
    expect(extractScope(['[Updater]', new Error('x')])).toMatchObject({ scope: 'Updater' })
  })
})

describe('buildRecord', () => {
  it('builds a record with time, level, source, scope and message', () => {
    const r = buildRecord('warn', 'renderer', ['[Friends] slow reply', 3], T)
    expect(r).toEqual({
      t: '2026-10-04T10:20:30.456Z',
      level: 'warn',
      source: 'renderer',
      scope: 'Friends',
      message: 'slow reply 3',
    })
  })

  it('keeps the stack of the first Error argument', () => {
    const err = new Error('disk full')
    const r = buildRecord('error', 'main', ['[Save] failed', err], T)
    expect(r.message).toBe('failed Error: disk full')
    expect(r.stack).toBe(err.stack)
  })

  it('has no stack when there is no Error', () => {
    expect(buildRecord('error', 'main', ['just text'], T).stack).toBeUndefined()
  })
})

describe('formatLogRecord', () => {
  it('formats one readable line', () => {
    const line = formatLogRecord(buildRecord('info', 'main', ['[Updater] checking'], T))
    expect(line).toBe('2026-10-04T10:20:30.456Z INFO  main     [Updater] checking')
  })

  it('aligns levels and sources', () => {
    const err = formatLogRecord(buildRecord('error', 'renderer', ['x'], T))
    expect(err).toBe('2026-10-04T10:20:30.456Z ERROR renderer x')
  })

  it('puts the stack on indented lines below the message', () => {
    const r = { ...buildRecord('error', 'main', ['[A] bad'], T), stack: 'Error: bad\n    at one\n    at two' }
    expect(formatLogRecord(r).split('\n')).toEqual([
      '2026-10-04T10:20:30.456Z ERROR main     [A] bad',
      '    Error: bad',
      '        at one',
      '        at two',
    ])
  })
})

describe('logFileName / shouldPersist', () => {
  it('names the general and the error log by day', () => {
    expect(logFileName('app', '2026-10-04')).toBe('lira-2026-10-04.log')
    expect(logFileName('error', '2026-10-04')).toBe('lira-errors-2026-10-04.log')
  })

  it('does not persist debug output', () => {
    expect(shouldPersist('debug')).toBe(false)
    expect(shouldPersist('info')).toBe(true)
    expect(shouldPersist('warn')).toBe(true)
    expect(shouldPersist('error')).toBe(true)
  })
})

describe('sanitizeRecords', () => {
  const ok = { t: '2026-10-04T10:00:00.000Z', level: 'error', source: 'main', scope: 'A', message: 'm', stack: 's' }

  it('keeps well-formed records and marks them as renderer output', () => {
    expect(sanitizeRecords([ok])).toEqual([{ ...ok, source: 'renderer' }])
  })

  it('drops malformed entries', () => {
    expect(sanitizeRecords([null, 'x', 5, { level: 'nope', message: 'm' }, { level: 'info' }, ok])).toHaveLength(1)
    expect(sanitizeRecords('not an array')).toEqual([])
    expect(sanitizeRecords(undefined)).toEqual([])
  })

  it('replaces a bad timestamp and bounds sizes and batch length', () => {
    const [r] = sanitizeRecords([{ ...ok, t: 'yesterday-ish', message: 'x'.repeat(10000), stack: 'y'.repeat(20000), scope: 's'.repeat(100) }])
    expect(Number.isNaN(Date.parse(r.t))).toBe(false)
    expect(r.message.length).toBe(4000)
    expect(r.stack!.length).toBe(8000)
    expect(r.scope!.length).toBe(40)
    expect(sanitizeRecords(Array.from({ length: 900 }, () => ok))).toHaveLength(500)
  })
})

describe('formatArgs with console placeholders', () => {
  it('fills %s, %d, %i, %f, %o and %O with the arguments that follow', () => {
    expect(formatArgs(['a %s b %d c %i d %f e %o f %O', 'x', 5.9, '7px', '1.5', { k: 1 }, [1]])).toBe(
      'a x b 5 c 7 d 1.5 e {"k":1} f [1]'
    )
  })

  it('appends the arguments that had no placeholder', () => {
    expect(formatArgs(['%s failed', 'save', 'twice', 3])).toBe('save failed twice 3')
  })

  it('drops %c styling together with its argument', () => {
    expect(formatArgs(['%c[vite]%c connected', 'color: blue', ''])).toBe('[vite] connected')
  })

  it('keeps a placeholder that has no argument, and writes %% as a percent sign', () => {
    expect(formatArgs(['100%% of %s and %s', 'a'])).toBe('100% of a and %s')
  })

  it('leaves the text alone when there is nothing to fill', () => {
    expect(formatArgs(['50%s off'])).toBe('50%s off')
    expect(formatArgs(['rate 5% of', 3])).toBe('rate 5% of 3')
    expect(formatArgs([{ text: '%s' }, 'x'])).toBe('{"text":"%s"} x')
  })

  it('reads a React warning the way the console shows it', () => {
    expect(
      formatArgs(['Warning: Encountered two children with the same key, `%s`. Keys should be unique.%s', 'default', '\n    at div'])
    ).toBe('Warning: Encountered two children with the same key, `default`. Keys should be unique.\n    at div')
  })
})

describe('extractScope with the tags the app uses', () => {
  it('accepts scopes with spaces and slashes', () => {
    expect(extractScope(['[P2P Failover] Error claiming host:', 1])).toEqual({
      scope: 'P2P Failover',
      args: ['Error claiming host:', 1],
    })
    expect(extractScope(['[Network/Firewall] UDP listening']).scope).toBe('Network/Firewall')
  })

  it('does not take a printed object or a list for a scope', () => {
    expect(extractScope(['[object Object] happened']).scope).toBeUndefined()
    expect(extractScope(['[a, b] failed']).scope).toBeUndefined()
    expect(extractScope([`[${'x'.repeat(60)}] too long`]).scope).toBeUndefined()
  })
})

describe('records of one process run', () => {
  it('carries the session id when one is given', () => {
    expect(buildRecord('info', 'renderer', ['[A] x'], T, '9008ec95')).toEqual({
      t: '2026-10-04T10:20:30.456Z',
      level: 'info',
      source: 'renderer',
      session: '9008ec95',
      scope: 'A',
      message: 'x',
    })
  })

  it('writes the session id after the source', () => {
    expect(formatLogRecord(buildRecord('info', 'renderer', ['[A] x'], T, '9008ec95'))).toBe(
      '2026-10-04T10:20:30.456Z INFO  renderer 9008ec95 [A] x'
    )
    expect(formatLogRecord(buildRecord('warn', 'main', ['y'], T, 'electron-4242'))).toBe(
      '2026-10-04T10:20:30.456Z WARN  main     electron-4242 y'
    )
  })
})

describe('error records and their report', () => {
  const report = buildErrorReport({ source: 'renderer', session: 's', message: 'bad', now: T, random: () => 0 })

  it('points the line at the report, below the stack', () => {
    const record = { ...buildRecord('error', 'renderer', ['[A] bad'], T), stack: 'Error: bad\n    at one', fp: report.fingerprint, report }
    expect(formatLogRecord(record).split('\n')).toEqual([
      '2026-10-04T10:20:30.456Z ERROR renderer [A] bad',
      '    Error: bad',
      '        at one',
      `    -> report ${report.id} fp=${report.fingerprint}`,
    ])
  })

  it('says how many occurrences the report stands for', () => {
    const record = { ...buildRecord('error', 'renderer', ['bad'], T), report: { ...report, count: 12 } }
    expect(formatLogRecord(record).split('\n')[1]).toBe(`    -> report ${report.id} fp=${report.fingerprint} x12`)
  })

  it('marks a repeat that got no report of its own', () => {
    const record = { ...buildRecord('error', 'renderer', ['bad'], T), fp: '1a2b3c4d' }
    expect(formatLogRecord(record).split('\n')).toEqual(['2026-10-04T10:20:30.456Z ERROR renderer bad', '    -> repeat fp=1a2b3c4d'])
  })

  it('names the report file by day', () => {
    expect(logFileName('report', '2026-10-04')).toBe('lira-reports-2026-10-04.jsonl')
  })
})

describe('consoleErrorInput', () => {
  it('reads scope, message and the error out of console arguments', () => {
    const error = new Error('ID is taken')
    expect(consoleErrorInput(['[P2P Failover] Error claiming host:', error])).toEqual({
      scope: 'P2P Failover',
      message: 'Error claiming host: Error: ID is taken',
      error,
    })
  })

  it('takes the first error when there are several', () => {
    const first = new TypeError('first')
    expect(consoleErrorInput(['failed', first, new Error('second')]).error).toBe(first)
  })

  it('separates a React component stack from the message', () => {
    const stack = '\n    at div\n    at CustomDropdown (http://localhost:5173/src/components/common/CustomDropdown.tsx:49:3)'
    expect(consoleErrorInput(['Warning: Encountered two children with the same key, `%s`.%s', 'default', stack])).toEqual({
      message: 'Warning: Encountered two children with the same key, `default`.',
      componentStack: stack,
    })
  })

  it('reads a plain message', () => {
    expect(consoleErrorInput(['just text', 42])).toEqual({ message: 'just text 42' })
  })
})

describe('sanitizeRecords with session and report', () => {
  const report = buildErrorReport({ source: 'renderer', session: '9008ec95', message: 'bad', now: T, random: () => 0 })
  const record = { t: '2026-10-04T10:00:00.000Z', level: 'error', message: 'bad', session: '9008ec95', fp: report.fingerprint, report }

  it('keeps the session, the fingerprint and a well-formed report', () => {
    expect(sanitizeRecords([JSON.parse(JSON.stringify(record))])).toEqual([{ ...record, source: 'renderer' }])
  })

  it('does not trust the source written in the report', () => {
    const [sanitized] = sanitizeRecords([{ ...record, report: { ...report, source: 'main' } }])
    expect(sanitized.report?.source).toBe('renderer')
  })

  it('drops a malformed session, fingerprint or report', () => {
    const [sanitized] = sanitizeRecords([{ ...record, session: 'a b c', fp: 'not-hex', report: 'nope' }])
    expect(sanitized).toEqual({ t: record.t, level: 'error', source: 'renderer', message: 'bad' })
  })
})
