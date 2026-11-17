import { describe, expect, it, vi } from 'vitest'
import { AlmSendQueue } from '../../p2p/almSendQueue'
import type { AlmFrame } from '../../p2p/almPackets'

const video = (temporalLayer = 0, key = false): AlmFrame => ({
  sequence: 0, timestamp: 0, key, temporalLayer, data: new Uint8Array(1),
})
const audio = (): AlmFrame => ({ ...video(), key: true, media: 'audio' })
const channel = (bufferedAmount = 0) => ({ bufferedAmount, send: vi.fn() })
const packets = (bytes: number) => [new ArrayBuffer(bytes)]

describe('ALM live send queue', () => {
  it('stops accumulating video at about 200 ms of observed delivery and reserves space for audio', () => {
    const queue = new AlmSendQueue(vi.fn())
    const output = channel(190_000)
    expect(queue.send(video(), packets(20_000), output, 8_000_000)).toBe('blocked')
    expect(output.send).not.toHaveBeenCalled()
    expect(queue.send(audio(), packets(500), output, 8_000_000)).toBe('sent')
    expect(output.send).toHaveBeenCalledOnce()
  })

  it('adapts to a slower connection instead of retaining the old two-megabyte backlog', () => {
    const slow = channel(60_000), fast = channel(60_000)
    expect(new AlmSendQueue(vi.fn()).send(video(), packets(10_000), slow, 2_000_000)).toBe('blocked')
    expect(new AlmSendQueue(vi.fn()).send(video(), packets(10_000), fast, 8_000_000)).toBe('sent')
  })

  it('uses the minimum burst budget when recent receipts report no delivery', () => {
    const output = channel(60_000)
    expect(new AlmSendQueue(vi.fn()).send(video(), packets(1000), output, 0)).toBe('blocked')
    expect(output.send).not.toHaveBeenCalled()
  })

  it('keeps bounded startup and idle budgets when throughput is unknown, zero or very low', () => {
    for (const bps of [null, 0, 1000, NaN, Infinity]) {
      const queue = new AlmSendQueue(vi.fn())
      expect(queue.send(video(), packets(1000), channel(), bps)).toBe('sent')
      expect(queue.send(audio(), packets(1000), channel(600_000), bps)).toBe('blocked')
    }
  })

  it('sheds enhancement layers first and keeps their dependents off until a successful keyframe', () => {
    const requestKey = vi.fn(), queue = new AlmSendQueue(requestKey)
    const output = channel(110_000)
    expect(queue.send(video(1), packets(1000), output, 8_000_000)).toBe('blocked')
    expect(queue.send(video(0), packets(1000), output, 8_000_000)).toBe('sent')
    output.bufferedAmount = 0
    expect(queue.send(video(2), packets(1000), output, 8_000_000)).toBe('waiting-key')
    expect(queue.send(video(1), packets(1000), output, 8_000_000)).toBe('waiting-key')
    expect(queue.send(video(0), packets(1000), output, 8_000_000)).toBe('sent')
    expect(requestKey).toHaveBeenCalledOnce()
    expect(queue.send(video(0, true), packets(1000), output, 8_000_000)).toBe('sent')
    expect(queue.send(video(2), packets(1000), output, 8_000_000)).toBe('sent')
  })

  it('does not send broken base-layer dependencies while still delivering audio', () => {
    const queue = new AlmSendQueue(vi.fn()), output = channel(250_000)
    expect(queue.send(video(), packets(1000), output, 8_000_000)).toBe('blocked')
    output.bufferedAmount = 0
    expect(queue.send(video(), packets(1000), output, 8_000_000)).toBe('waiting-key')
    expect(queue.send(audio(), packets(500), output, 8_000_000)).toBe('sent')
    expect(queue.send(video(0, true), packets(1000), output, 8_000_000)).toBe('sent')
    expect(queue.send(video(), packets(1000), output, 8_000_000)).toBe('sent')
  })

  it('allows one large recovery keyframe on a drained queue without admitting more video behind it', () => {
    const queue = new AlmSendQueue(vi.fn()), output = channel(1000)
    expect(queue.send(video(0, true), packets(350_000), output, 8_000_000)).toBe('sent')
    output.bufferedAmount = 351_000
    expect(queue.send(audio(), packets(500), output, 8_000_000)).toBe('sent')
    expect(queue.send(video(), packets(1000), output, 8_000_000)).toBe('blocked')
    expect(queue.send(video(0, true), packets(350_000), output, 8_000_000)).toBe('blocked')
    expect(queue.send(audio(), packets(10_000), channel(360_000), 8_000_000)).toBe('blocked')
  })

  it('retains a hard byte bound even for oversized recovery frames and fast links', () => {
    const queue = new AlmSendQueue(vi.fn()), output = channel()
    expect(queue.send(video(0, true), packets(2 * 1024 * 1024), output, 100_000_000)).toBe('oversized-key')
    expect(output.send).not.toHaveBeenCalled()
    expect(queue.send(audio(), packets(500), channel(2 * 1024 * 1024), 100_000_000)).toBe('blocked')
  })

  it('rejects a recovery burst that would exceed the per-edge delivery budget before writing any fragments', () => {
    const requestKey = vi.fn(), queue = new AlmSendQueue(requestKey), output = channel()
    expect(queue.send(video(0, true), packets(120_000), output, 2_000_000)).toBe('oversized-key')
    expect(output.send).not.toHaveBeenCalled()
    expect(requestKey).not.toHaveBeenCalled()
    expect(queue.send(audio(), packets(500), output, 2_000_000)).toBe('sent')
    expect(queue.send(video(), packets(1000), output, 2_000_000)).toBe('waiting-key')
    expect(queue.send(video(0, true), packets(80_000), output, 2_000_000)).toBe('sent')
  })

  it('never lets even a fast connection queue a recovery frame larger than 512 KiB', () => {
    const output = channel(), queue = new AlmSendQueue(vi.fn())
    expect(queue.send(video(0, true), packets(600_000), output, 100_000_000)).toBe('oversized-key')
    expect(output.send).not.toHaveBeenCalled()
  })

  it('handles a partial send failure without sending dependent video afterwards', () => {
    const requestKey = vi.fn(), queue = new AlmSendQueue(requestKey), output = channel()
    output.send.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('send failed') })
    expect(queue.send(video(), [new ArrayBuffer(50), new ArrayBuffer(50)], output, 8_000_000)).toBe('blocked')
    expect(queue.send(video(), packets(100), output, 8_000_000)).toBe('waiting-key')
    expect(requestKey).toHaveBeenCalledOnce()
  })

  it('does not let an audio send failure invalidate video dependencies', () => {
    const requestKey = vi.fn(), queue = new AlmSendQueue(requestKey), output = channel()
    output.send.mockImplementationOnce(() => { throw new Error('send failed') })
    expect(queue.send(audio(), packets(100), output, 8_000_000)).toBe('blocked')
    expect(queue.send(video(), packets(100), output, 8_000_000)).toBe('sent')
    expect(requestKey).not.toHaveBeenCalled()
  })

  it('requests recovery if packetization rejects a video frame instead of sending its dependents', () => {
    const requestKey = vi.fn(), queue = new AlmSendQueue(requestKey), output = channel()
    expect(queue.send(video(), [], output, 8_000_000)).toBe('blocked')
    expect(queue.send(video(), packets(100), output, 8_000_000)).toBe('waiting-key')
    expect(requestKey).toHaveBeenCalledOnce()
  })
})
