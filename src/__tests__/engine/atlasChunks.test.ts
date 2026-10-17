import { afterEach, describe, expect, it, vi } from 'vitest'
import { AtlasChunkReceiver, sendAtlasChunks, ATLAS_CHUNK_SIZE } from '../../assets/atlasChunks'

afterEach(() => vi.useRealTimers())
const atlas = { xml: '<atlas>á</atlas>', png: 'data:image/png;base64,' + 'x'.repeat(500000) }

describe('bounded P2P atlas messages', () => {
  it('yields between bounded messages and reconstructs both XML and PNG without loss', async () => {
    vi.useFakeTimers()
    const messages: any[] = []
    const sending = sendAtlasChunks(atlas, 'digest', c => messages.push(c), () => true)
    expect(messages.length).toBeGreaterThan(0)
    expect(messages.length).toBeLessThan(Math.ceil(atlas.png.length / ATLAS_CHUNK_SIZE))
    await vi.runAllTimersAsync()
    expect(await sending).toBe(true)
    expect(messages.every(m => m.data.byteLength <= ATLAS_CHUNK_SIZE)).toBe(true)
    const receiver = new AtlasChunkReceiver()
    const completed = messages.map(m => receiver.accept('host', m)).filter(Boolean)
    expect(completed).toHaveLength(1)
    expect(await new Blob(completed[0]!.xml).text()).toBe(atlas.xml)
    expect(await new Blob(completed[0]!.png).text()).toBe(atlas.png)
  })
  it('stops queued transfer when the connection is no longer current', async () => {
    vi.useFakeTimers()
    const messages: any[] = []
    let active = true
    const sending = sendAtlasChunks(atlas, 'digest', c => messages.push(c), () => active)
    active = false
    const count = messages.length
    await vi.runAllTimersAsync()
    expect(await sending).toBe(false)
    expect(messages.length).toBe(count)
  })
  it('waits for network backpressure without buffering the whole atlas', async () => {
    vi.useFakeTimers()
    let buffered = 2000000
    const send = vi.fn()
    const pending = sendAtlasChunks(atlas, 'digest', send, () => true, () => buffered)
    expect(send).not.toHaveBeenCalled()
    buffered = 0
    await vi.runAllTimersAsync()
    expect(await pending).toBe(true)
    expect(send).toHaveBeenCalled()
  })
  it('rejects malformed messages and does not mix separate peers', () => {
    const receiver = new AtlasChunkReceiver()
    const first = { transferId: 'id', digest: 'digest', field: 'xml', index: 0, total: 2, data: new TextEncoder().encode('<atlas/>') }
    expect(receiver.accept('a', first)).toBeNull()
    expect(receiver.accept('b', { ...first, field: 'png', index: 1, data: new TextEncoder().encode(atlas.png.slice(0, 30)) })).toBeNull()
    expect(receiver.accept('a', { ...first, field: 'png', index: 1, data: new TextEncoder().encode('data:image/png;base64,AA') })).toMatchObject({ digest: 'digest', xml: [first.data], png: [expect.any(Uint8Array)] })
    expect(receiver.accept('a', { ...first, data: new Uint8Array(ATLAS_CHUNK_SIZE + 1) })).toBeNull()
    expect(receiver.accept('a', { ...first, total: Infinity })).toBeNull()
  })
})