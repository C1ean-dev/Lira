import { describe, it, expect, beforeEach } from 'vitest'
import { collectReportContext, registerReportContext, __resetReportContextForTests } from '../utils/reportContext'

describe('report context', () => {
  beforeEach(() => {
    __resetReportContextForTests()
  })

  it('is empty when nothing registered', () => {
    expect(collectReportContext()).toEqual({})
  })

  it('collects a snapshot from each registered part of the app, read at that moment', () => {
    let peers = 1
    registerReportContext('room', () => ({ inRoom: true, peers }))
    registerReportContext('media', () => ({ muted: false }))
    peers = 3

    expect(collectReportContext()).toEqual({ room: { inRoom: true, peers: 3 }, media: { muted: false } })
  })

  it('stops collecting from a part that unregistered', () => {
    const unregister = registerReportContext('room', () => ({ inRoom: true }))
    unregister()
    expect(collectReportContext()).toEqual({})
  })

  it('keeps the latest registration of a name, and an old unregister does not remove it', () => {
    const unregisterFirst = registerReportContext('room', () => ({ version: 1 }))
    registerReportContext('room', () => ({ version: 2 }))
    unregisterFirst()

    expect(collectReportContext()).toEqual({ room: { version: 2 } })
  })

  it('notes a part that failed instead of losing the whole context', () => {
    registerReportContext('room', () => {
      throw new Error('store not ready')
    })
    registerReportContext('media', () => ({ muted: true }))

    expect(collectReportContext()).toEqual({ room: { contextError: 'store not ready' }, media: { muted: true } })
  })

  it('leaves out a part that has nothing to say', () => {
    registerReportContext('room', () => undefined)
    registerReportContext('media', () => null)
    expect(collectReportContext()).toEqual({})
  })

  it('makes every snapshot small and safe to write', () => {
    const state: Record<string, unknown> = { stream: new Map(), name: 'x'.repeat(5000) }
    state.self = state
    registerReportContext('media', () => state)

    const context = collectReportContext()
    expect(context.media).toMatchObject({ stream: '[Map(0)]', self: '[Circular]' })
    expect(JSON.stringify(context).length).toBeLessThan(1000)
  })

  it('ignores a registration that is not usable', () => {
    registerReportContext('', () => ({ a: 1 }))
    registerReportContext('room', 'not a function' as never)
    expect(collectReportContext()).toEqual({})
  })
})
