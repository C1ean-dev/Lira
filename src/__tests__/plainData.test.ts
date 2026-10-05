import { describe, it, expect } from 'vitest'
import { toPlainData, toPlainRecord } from '../utils/plainData'

describe('toPlainData', () => {
  it('keeps simple values as they are', () => {
    expect(toPlainData({ a: 1, b: 'x', c: true, d: null, e: [1, 'two'] })).toEqual({
      a: 1,
      b: 'x',
      c: true,
      d: null,
      e: [1, 'two'],
    })
  })

  it('leaves undefined properties out', () => {
    expect(toPlainData({ a: undefined, b: 1 })).toEqual({ b: 1 })
    expect(Object.keys(toPlainData({ a: undefined, b: 1 }) as object)).toEqual(['b'])
  })

  it('writes values JSON cannot carry as text', () => {
    function named() {}
    expect(toPlainData({ n: NaN, i: Infinity, big: 10n, f: named, s: Symbol('x') })).toEqual({
      n: 'NaN',
      i: 'Infinity',
      big: '10n',
      f: '[Function named]',
      s: 'Symbol(x)',
    })
  })

  it('writes a date as its ISO time', () => {
    expect(toPlainData(new Date('2026-10-04T10:00:00.000Z'))).toBe('2026-10-04T10:00:00.000Z')
    expect(toPlainData(new Date('nope'))).toBe('Invalid Date')
  })

  it('keeps the name, message and code of an error, not its stack', () => {
    const error = Object.assign(new TypeError('boom'), { code: 'E_BOOM' })
    expect(toPlainData({ error })).toEqual({ error: { name: 'TypeError', message: 'boom', code: 'E_BOOM' } })
  })

  it('names objects that are not plain data instead of walking them', () => {
    class Peer {
      secret = 'x'
    }
    expect(toPlainData({ peer: new Peer(), map: new Map([[1, 2]]), set: new Set([1]), bytes: new Uint8Array(4) })).toEqual({
      peer: '[Peer]',
      map: '[Map(1)]',
      set: '[Set(1)]',
      bytes: '[Uint8Array(4)]',
    })
  })

  it('cuts long strings', () => {
    expect(toPlainData('x'.repeat(50), { maxString: 10 })).toBe(`${'x'.repeat(10)}…`)
  })

  it('cuts long arrays and says how much is missing', () => {
    expect(toPlainData([1, 2, 3, 4, 5], { maxArray: 2 })).toEqual([1, 2, '…(+3)'])
  })

  it('cuts objects with too many keys and says how much is missing', () => {
    expect(toPlainData({ a: 1, b: 2, c: 3 }, { maxKeys: 2 })).toEqual({ a: 1, b: 2, '…': '+1' })
  })

  it('stops at the depth limit', () => {
    expect(toPlainData({ a: { b: { c: { d: 1 } } }, list: [[1]] }, { maxDepth: 2 })).toEqual({
      a: { b: '[Object]' },
      list: ['[Array(1)]'],
    })
  })

  it('marks circular references', () => {
    const node: Record<string, unknown> = { name: 'a' }
    node.self = node
    expect(toPlainData(node)).toEqual({ name: 'a', self: '[Circular]' })
  })

  it('writes the same object twice when it is not a cycle', () => {
    const shared = { id: 1 }
    expect(toPlainData({ a: shared, b: shared })).toEqual({ a: { id: 1 }, b: { id: 1 } })
  })

  it('survives getters that throw', () => {
    const hostile = {
      ok: 1,
      get bad() {
        throw new Error('no')
      },
    }
    expect(toPlainData(hostile)).toEqual({ ok: 1, bad: '[Throws]' })
  })

  it('gives JSON-safe output', () => {
    const node: Record<string, unknown> = { when: new Date(0), fn: () => 1, big: 1n }
    node.self = node
    expect(() => JSON.stringify(toPlainData(node))).not.toThrow()
  })
})

describe('toPlainRecord', () => {
  it('returns the plain version of an object', () => {
    expect(toPlainRecord({ a: 1, b: new Map() })).toEqual({ a: 1, b: '[Map(0)]' })
  })

  it('wraps anything else under "value"', () => {
    expect(toPlainRecord('text')).toEqual({ value: 'text' })
    expect(toPlainRecord([1, 2])).toEqual({ value: [1, 2] })
  })

  it('returns nothing for a missing value', () => {
    expect(toPlainRecord(undefined)).toBeUndefined()
    expect(toPlainRecord(null)).toBeUndefined()
  })
})
