import { describe, expect, it, vi } from 'vitest'
import { GStreamerRoom } from '../../p2p/gstreamerRoom'
import type { GStreamerSignal } from '../../media/gstreamerProtocol'

const session = 'a87cdfd3-1d62-447c-a155-50348760fe30'

describe('GStreamer room routing', () => {
  it('limits capture sessions to authorized viewers and restores RTP on departure', async () => {
    const send = vi.fn()
    const rtp = vi.fn()
    const signal = vi.fn(async (_signal: GStreamerSignal) => true)
    const capture = { activate: vi.fn(), signal }
    const room = new GStreamerRoom({
      send, rtp, eligible: id => id === 'viewer', watching: () => false,
      stream: vi.fn(), rtc: {},
    })
    room.setCapture(capture)
    await room.receive('intruder', { kind: 'watch', session })
    expect(signal).not.toHaveBeenCalled()
    await room.receive('viewer', { kind: 'watch', session })
    await room.receive('intruder', { kind: 'ready', session })
    expect(signal).toHaveBeenCalledExactlyOnceWith({ kind: 'watch', session })
    expect(rtp).not.toHaveBeenCalled()
    await room.receive('viewer', { kind: 'ready', session })
    expect(rtp).toHaveBeenCalledWith('viewer', true)
    room.peerLeft('viewer')
    expect(signal).toHaveBeenLastCalledWith({ kind: 'end', session })
    expect(rtp).toHaveBeenLastCalledWith('viewer', false)
    room.close()
  })

  it('keeps the ordinary path available when native session startup fails', async () => {
    const send = vi.fn()
    const rtp = vi.fn()
    const room = new GStreamerRoom({ send, rtp, eligible: () => true, watching: () => false, stream: vi.fn(), rtc: {} })
    room.setCapture({ activate: vi.fn(), signal: vi.fn(async () => false) })
    await room.receive('viewer', { kind: 'watch', session })
    expect(send).toHaveBeenCalledWith('viewer', { kind: 'end', session })
    expect(rtp).not.toHaveBeenCalled()
    room.close()
  })
})
