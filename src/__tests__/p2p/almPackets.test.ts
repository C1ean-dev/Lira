import { describe, expect, it, vi, afterEach } from 'vitest'
import { AlmAssembler, AlmFrameQueue, packetizeFrame, type AlmFrame } from '../../p2p/almPackets'

const frame = (sequence: number, key = false): AlmFrame => ({ sequence, timestamp: sequence * 33_333, key, data: new Uint8Array([1, 2, 3]) })
afterEach(() => vi.useRealTimers())

describe('Encoded live packets', () => {
  it('reassembles shuffled, duplicated chunks without changing compressed bytes', () => {
    const data = Uint8Array.from({ length: 50_000 }, (_, index) => index % 251)
    const original = { ...frame(3, true), data }
    const packets = packetizeFrame(original)
    const receiver = new AlmAssembler()
    expect(receiver.push(packets[2], 0)).toBeNull()
    expect(receiver.push(packets[2], 0)).toBeNull()
    let decoded: AlmFrame | null = null
    for (const index of [4, 0, 3, 1]) decoded = receiver.push(packets[index], 1) ?? decoded
    expect(decoded).toEqual(original)
  })

  it('expires an incomplete frame and rejects invalid sizes and fragments', () => {
    const packets = packetizeFrame({ ...frame(1, true), data: new Uint8Array(25_000) })
    const receiver = new AlmAssembler()
    receiver.push(packets[0], 0)
    receiver.push(packets[1], 1)
    expect(receiver.push(packets[2], 200)).toBeNull()
    const malicious = packets[0].slice(0)
    new DataView(malicious).setUint32(16, 0xffffffff)
    expect(receiver.push(malicious, 201)).toBeNull()
    expect(receiver.push(new ArrayBuffer(2), 201)).toBeNull()
  })

  it('waits for an IDR, reorders frames, and requests another IDR after loss', () => {
    const displayed: number[] = []
    let requests = 0
    const queue = new AlmFrameQueue(frame => displayed.push(frame.sequence), () => requests++)
    queue.push(frame(1), 0)
    expect(displayed).toEqual([])
    queue.push(frame(2, true), 1)
    queue.push(frame(4), 3)
    queue.push(frame(3), 4)
    expect(displayed).toEqual([2, 3, 4])
    queue.push(frame(6), 5)
    queue.drain(200)
    queue.push(frame(7), 201)
    expect(displayed).toEqual([2, 3, 4])
    expect(requests).toBeGreaterThan(0)
    queue.push(frame(9, true), 202)
    expect(displayed).toEqual([2, 3, 4, 9])
  })

  it('expires a missing video frame at 180 ms even when no other packets arrive', () => {
    vi.useFakeTimers()
    let now = 0, requests = 0
    const displayed: number[] = []
    const queue = new AlmFrameQueue(frame => displayed.push(frame.sequence), () => requests++, { now: () => now })
    queue.push(frame(0, true))
    queue.push(frame(2))
    now = 179; vi.advanceTimersByTime(179)
    expect(requests).toBe(0)
    now = 180; vi.advanceTimersByTime(1)
    expect(requests).toBe(1)
    expect(displayed).toEqual([0])
    queue.push(frame(4, true))
    expect(displayed).toEqual([0, 4])
    queue.reset()
  })

  it('drops a missing independent audio packet and continues within 40 ms', () => {
    vi.useFakeTimers()
    let now = 0
    const displayed: number[] = []
    const queue = new AlmFrameQueue(frame => displayed.push(frame.sequence), () => {}, { now: () => now, independent: true, ttlMs: 40 })
    queue.push(frame(0, true)); queue.push(frame(2, true))
    now = 40; vi.advanceTimersByTime(40)
    expect(displayed).toEqual([0, 2])
    queue.reset()
  })

  it('keeps separate audio/video sequence spaces and preserves temporal dependencies', () => {
    const receiver = new AlmAssembler()
    const video = { ...frame(0, true), temporalLayer: 0, layerSequences: [0, 0, 0] }
    const audio = { ...frame(0, true), media: 'audio' as const, duration: 20_000 }
    expect(receiver.push(packetizeFrame(video)[0], 0)).toEqual(video)
    expect(receiver.push(packetizeFrame(audio)[0], 0)).toEqual(audio)
  })
})
