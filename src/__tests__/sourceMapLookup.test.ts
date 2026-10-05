import { describe, it, expect } from 'vitest'
import { lookupPositions } from '../utils/sourceMapLookup'
import { Segment, encodeMappings, encodeVlq, makeSourceMap } from './helpers/sourceMapFixture'

const SOURCES = ['../../src/p2p/PeerManager.ts', '../../node_modules/peerjs/dist/bundler.mjs']

// Generated line 1: three pieces of code. Line 2: nothing. Line 3: one piece with a name, one with no source.
const MAP = makeSourceMap(
  SOURCES,
  [
    [
      [0, 0, 9, 2],
      [10, 0, 882, 14],
      [25, 1, 5328, 11],
    ],
    [],
    [
      [4, 0, 100, 0, 1],
      [30],
    ],
  ],
  ['unused', 'promoteToHost']
)

/** Stack positions are 1-based, line and column. */
const at = (line: number, col: number) => ({ line, col })

describe('lookupPositions', () => {
  it('finds the source position a generated position came from', () => {
    expect(lookupPositions(MAP, [at(1, 11)])).toEqual([{ source: SOURCES[0], line: 883, col: 15 }])
  })

  it('uses the piece of code that covers the position', () => {
    expect(lookupPositions(MAP, [at(1, 1), at(1, 10), at(1, 20), at(1, 26), at(1, 9000)])).toEqual([
      { source: SOURCES[0], line: 10, col: 3 },
      { source: SOURCES[0], line: 10, col: 3 },
      { source: SOURCES[0], line: 883, col: 15 },
      { source: SOURCES[1], line: 5329, col: 12 },
      { source: SOURCES[1], line: 5329, col: 12 },
    ])
  })

  it('keeps the name the source gave to the thing at that position', () => {
    expect(lookupPositions(MAP, [at(3, 5)])).toEqual([{ source: SOURCES[0], line: 101, col: 1, name: 'promoteToHost' }])
  })

  it('answers nothing for a position that came from no source', () => {
    expect(lookupPositions(MAP, [at(3, 1), at(3, 4), at(3, 31), at(3, 500), at(2, 1), at(9, 1)])).toEqual([null, null, null, null, null, null])
  })

  it('answers in the order it was asked, whatever that order is', () => {
    expect(lookupPositions(MAP, [at(3, 5), at(1, 26), at(1, 1), at(2, 7), at(1, 11)]).map((position) => position?.line ?? null)).toEqual([
      101, 5329, 10, null, 883,
    ])
  })

  it('reads values that go backwards and values that need several characters', () => {
    const map = makeSourceMap(['a.ts', 'b.ts'], [
      [
        [0, 1, 70000, 300],
        [100000, 0, 3, 0],
      ],
      [[5, 1, 2, 9]],
    ])

    expect(lookupPositions(map, [at(1, 1), at(1, 100001), at(2, 6)])).toEqual([
      { source: 'b.ts', line: 70001, col: 301 },
      { source: 'a.ts', line: 4, col: 1 },
      { source: 'b.ts', line: 3, col: 10 },
    ])
  })

  it('puts the source root in front of the source', () => {
    const map = { ...makeSourceMap(['src/a.ts'], [[[0, 0, 0, 0]]]), sourceRoot: '/project' }
    expect(lookupPositions(map, [at(1, 1)])).toEqual([{ source: '/project/src/a.ts', line: 1, col: 1 }])
  })

  it('agrees with a plain search on random maps', () => {
    let seed = 42
    const random = (max: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % max
    }
    for (let round = 0; round < 40; round++) {
      const lines: Segment[][] = []
      for (let line = 0; line < 1 + random(6); line++) {
        const segments: Segment[] = []
        let column = random(4)
        for (let i = 0; i < random(8); i++) {
          segments.push(random(5) === 0 ? [column] : random(3) === 0 ? [column, random(3), random(500), random(80), random(4)] : [column, random(3), random(500), random(80)])
          column += 1 + random(30)
        }
        lines.push(segments)
      }
      const map = makeSourceMap(['a.ts', 'b.ts', 'c.ts'], lines, ['n0', 'n1', 'n2', 'n3'])
      const targets = Array.from({ length: 12 }, () => at(1 + random(lines.length + 1), 1 + random(260)))

      const expected = targets.map((target) => {
        const covering = (lines[target.line - 1] ?? []).filter((segment) => segment[0] <= target.col - 1).pop()
        if (!covering || covering.length === 1) return null
        return {
          source: map.sources[covering[1]!],
          line: covering[2]! + 1,
          col: covering[3]! + 1,
          ...(covering.length > 4 ? { name: map.names[covering[4]!] } : {}),
        }
      })
      expect(lookupPositions(map, targets)).toEqual(expected)
    }
  })

  it('answers nothing when there is no usable map', () => {
    const targets = [at(1, 1), at(2, 2)]
    expect(lookupPositions(null, targets)).toEqual([null, null])
    expect(lookupPositions(undefined, targets)).toEqual([null, null])
    expect(lookupPositions({}, targets)).toEqual([null, null])
    expect(lookupPositions({ sources: SOURCES, mappings: 42 }, targets)).toEqual([null, null])
    expect(lookupPositions({ sources: 'nope', mappings: 'AAAA' }, targets)).toEqual([null, null])
    expect(lookupPositions({ sections: [], sources: SOURCES, mappings: 'AAAA' }, targets)).toEqual([null, null])
  })

  it('stops at a damaged map instead of inventing positions', () => {
    const good = encodeMappings([[[0, 0, 4, 2]], [[3, 0, 8, 1]]])
    const damaged = { sources: ['a.ts'], mappings: `${good.split(';')[0]};${encodeVlq(3)}*~${encodeVlq(1)}` }

    expect(lookupPositions(damaged, [at(1, 1), at(2, 4)])).toEqual([{ source: 'a.ts', line: 5, col: 3 }, null])
    expect(lookupPositions({ sources: ['a.ts'], mappings: 'g' }, [at(1, 1)])).toEqual([null])
    // The last value of a segment cut off in the middle: the segment is not to be believed.
    expect(lookupPositions({ sources: ['a.ts'], mappings: 'AAAg' }, [at(1, 1)])).toEqual([null])
  })

  it('answers nothing for a source that the map does not list', () => {
    const map = { sources: ['a.ts'], mappings: encodeMappings([[[0, 3, 0, 0]]]) }
    expect(lookupPositions(map, [at(1, 1)])).toEqual([null])
  })

  it('ignores positions that are not positions', () => {
    expect(lookupPositions(MAP, [at(0, 1), at(1, 0), at(-1, 5), at(1.5, 2), { line: NaN, col: 1 }, at(1, 11)])).toEqual([
      null,
      null,
      null,
      null,
      null,
      { source: SOURCES[0], line: 883, col: 15 },
    ])
  })

  it('handles a map with no targets and targets with no map lines', () => {
    expect(lookupPositions(MAP, [])).toEqual([])
    expect(lookupPositions({ sources: ['a.ts'], mappings: '' }, [at(1, 1)])).toEqual([null])
  })
})
