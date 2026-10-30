import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync('src/media/deepFilterWorkerBridgeSrc.js', 'utf8')
function bridge(reply = true) {
  let Processor: any
  const messages: any[] = []
  const worker: any = {
    start: vi.fn(), close: vi.fn(), onmessage: null,
    postMessage: vi.fn((data: any) => {
      if (reply && data.type === 'frame') worker.onmessage({ data: { type: 'frame', input: data.input, output: data.input.slice() } })
    }),
  }
  vm.runInNewContext(source, {
    AudioWorkletProcessor: class { port = { onmessage: null, postMessage: (data: any) => messages.push(data) } },
    sampleRate: 48000, Float32Array, registerProcessor: (_name: string, value: any) => { Processor = value },
  })
  const processor = new Processor()
  processor.port.onmessage({ data: { type: 'bind', port: worker } })
  return { processor, messages, worker }
}

describe('bounded worker audio bridge', () => {
  it('bridges 480-sample frames and 128-sample quanta without gaps, duplication or drift', () => {
    const { processor, messages } = bridge()
    const input = Float32Array.from({ length: 128 * 100 }, (_, index) => Math.sin(index / 50) * 0.1)
    const captured = new Float32Array(input.length)
    for (let offset = 0; offset < input.length; offset += 128) {
      const output = new Float32Array(128)
      expect(processor.process([[input.subarray(offset, offset + 128)]], [[output]])).toBe(true)
      captured.set(output, offset)
    }
    expect(messages).toEqual([{ type: 'ready' }])
    expect(captured.subarray(3840)).toEqual(input.subarray(0, input.length - 3840))
    expect(captured.subarray(0, 3840).every(value => value === 0)).toBe(true)
  })

  it('fails explicitly on a stalled worker instead of silently adding unbounded latency', () => {
    const { processor, messages } = bridge(false)
    for (let i = 0; i < 50 && !processor.dead; i++) processor.process([[new Float32Array(128)]], [[new Float32Array(128)]])
    expect(processor.dead).toBe(true)
    expect(messages.some(message => message.type === 'error' && /underrun|backlog/.test(message.message))).toBe(true)
  })

  it('forwards asynchronous worker failures and closes the direct port on disposal', () => {
    const { processor, messages, worker } = bridge()
    processor.port.onmessage({ data: { type: 'worker-error', message: 'worker crashed' } })
    expect(messages).toContainEqual({ type: 'error', fatal: true, message: 'worker crashed' })
    processor.port.onmessage({ data: { type: 'destroy' } })
    expect(worker.close).toHaveBeenCalledOnce()
  })
})
