import { afterEach, describe, expect, it, vi } from 'vitest'
import { ALM_MAX_FRAME_BYTES, AlmAssembler, AlmFrameQueue, packetizeFrame, type AlmFrame } from '../../p2p/almPackets'

const frame = (sequence = 1): AlmFrame => ({
  sequence, timestamp: sequence * 33_333, key: true,
  data: Uint8Array.from({ length: 25_000 }, (_, i) => i % 251),
  temporalLayer: 0, layerSequences: [sequence, sequence, sequence],
})

afterEach(() => vi.restoreAllMocks())

describe('Validated ALM relay packets', () => {
  it('does not copy payloads until local decoding reads data, then materializes only once', () => {
    const original = frame(), packets = packetizeFrame(original), assembler = new AlmAssembler()
    const copy = vi.spyOn(Uint8Array.prototype, 'set')
    let result: ReturnType<AlmAssembler['pushPacket']> = null
    for (const packet of packets) result = assembler.pushPacket(packet, 0)
    expect(result!.frame.sequence).toBe(original.sequence)
    expect(result!.packets[0]).toBe(packets[0])
    expect(copy).not.toHaveBeenCalled()
    const data = result!.frame.data
    expect(copy).toHaveBeenCalledTimes(packets.length)
    expect(data).toEqual(original.data)
    expect(result!.frame.data).toBe(data)
    expect(copy).toHaveBeenCalledTimes(packets.length)
  })

  it('never materializes a delta discarded while the playback queue waits for recovery', () => {
    const packets = packetizeFrame({ ...frame(), key: false }), assembler = new AlmAssembler()
    const decode = vi.fn((value: AlmFrame) => value.data), requestKey = vi.fn()
    const queue = new AlmFrameQueue(decode, requestKey)
    const copy = vi.spyOn(Uint8Array.prototype, 'set')
    for (const packet of packets) {
      const result = assembler.pushPacket(packet, 0)
      if (result) queue.push(result.frame)
    }
    expect(copy.mock.calls.length).toBe(0)
    expect(decode).not.toHaveBeenCalled()
    expect(requestKey).toHaveBeenCalledOnce()
    queue.reset()
  })

  it('returns the original buffers in fragment order only after every fragment is validated', () => {
    const source = frame(), packets = packetizeFrame(source), assembler = new AlmAssembler()
    expect(assembler.pushPacket(packets[2], 0)).toBeNull()
    expect(assembler.pushPacket(packets[0], 1)).toBeNull()
    expect(assembler.pushPacket(packets[0].slice(0), 2)).toBeNull()
    const result = assembler.pushPacket(packets[1], 3)!
    expect(result.frame).toEqual(source)
    expect(result.packets).toHaveLength(3)
    for (let i = 0; i < packets.length; i++) expect(result.packets[i]).toBe(packets[i])
  })

  it('does not retain or forward mismatched fragment headers', () => {
    const packets = packetizeFrame(frame()), assembler = new AlmAssembler()
    assembler.pushPacket(packets[0], 0)
    const bad = packets[1].slice(0)
    new DataView(bad).setUint32(32, 1234)
    expect(assembler.pushPacket(bad, 1)).toBeNull()
    expect(assembler.pushPacket(packets[2], 2)).toBeNull()
    const result = assembler.pushPacket(packets[1], 3)!
    expect(result.packets[1]).toBe(packets[1])
    expect(result.frame).toEqual(frame())
  })

  it('discards expired fragment references and does not mix them with a later assembly', () => {
    const packets = packetizeFrame(frame()), assembler = new AlmAssembler()
    assembler.pushPacket(packets[0], 0)
    expect(assembler.pushPacket(packets[1], 181)).toBeNull()
    expect(assembler.pushPacket(packets[2], 182)).toBeNull()
    const replacement = packets[0].slice(0)
    const result = assembler.pushPacket(replacement, 183)!
    expect(result.packets[0]).toBe(replacement)
    expect(result.frame).toEqual(frame())
  })

  it('clears retained packets on teardown', () => {
    const packets = packetizeFrame(frame()), assembler = new AlmAssembler()
    assembler.pushPacket(packets[0], 0)
    assembler.clear()
    expect(assembler.pushPacket(packets[1], 1)).toBeNull()
    expect(assembler.pushPacket(packets[2], 2)).toBeNull()
  })

  it('keeps independent audio/video assemblies when sequence numbers coincide', () => {
    const source = frame(), packets = packetizeFrame(source), assembler = new AlmAssembler()
    assembler.pushPacket(packets[0], 0)
    const audio = { ...source, media: 'audio' as const, data: new Uint8Array([1, 2, 3]), duration: 20_000 }
    const audioPackets = packetizeFrame(audio), result = assembler.pushPacket(audioPackets[0], 1)!
    expect(result.frame).toEqual(audio)
    expect(result.packets[0]).toBe(audioPackets[0])
    expect(assembler.pushPacket(packets[1], 2)).toBeNull()
    expect(assembler.pushPacket(packets[2], 3)!.frame).toEqual(source)
  })

  it('bounds retained wire buffers including headers, and releases the reservation after completion', () => {
    const large = { ...frame(), data: new Uint8Array(ALM_MAX_FRAME_BYTES) }
    const first = packetizeFrame(large), second = packetizeFrame({ ...large, sequence: 2 })
    const assembler = new AlmAssembler()
    assembler.pushPacket(first[0], 0)
    // Two maximum-size frames plus their wire headers exceed the 8 MiB budget.
    expect(assembler.pushPacket(second[0], 1)).toBeNull()
    for (const packet of first.slice(1, -1)) expect(assembler.pushPacket(packet, 2)).toBeNull()
    expect(assembler.pushPacket(first[first.length - 1], 3)!.frame.data.byteLength).toBe(ALM_MAX_FRAME_BYTES)
    // A rejected fragment was not retained and must be received again.
    for (const packet of second.slice(1)) expect(assembler.pushPacket(packet, 4)).toBeNull()
    expect(assembler.pushPacket(second[0], 5)!.frame.sequence).toBe(2)
  })
})
