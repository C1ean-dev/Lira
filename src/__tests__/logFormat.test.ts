import { describe, it, expect } from 'vitest'
import {
  MAX_MESSAGE_LENGTH,
  buildRecord,
  extractScope,
  formatArgs,
  formatLogRecord,
  logFileName,
  sanitizeRecords,
  serializeError,
  shouldPersist,
} from '../utils/logFormat'

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
