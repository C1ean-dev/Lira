import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

test('encoded audio probe forwards the original frames and matches one clock', async () => {
  const built = await build({ entryPoints: ['scripts/noise-benchmark/encodedProbe.ts'], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' })
  const { installEncodedProbe } = await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].contents).toString('base64'))
  let source, destination
  const endpoint = () => {
    let controller
    const received = []
    return { received, track: { kind: 'audio' },
      createEncodedStreams() { return {
        readable: new ReadableStream({ start(value) { controller = value } }),
        writable: new WritableStream({ write(value) { received.push(value) } }),
      } },
      push(frame) { controller.enqueue(frame) }, close() { controller.close() },
    }
  }
  class Connection extends EventTarget {
    constructor(config) { super(); this.config = config }
    addTrack() { return source = endpoint() }
  }
  const target = { RTCPeerConnection: Connection }
  const probe = installEncodedProbe(target, () => 12345)
  const pc = new target.RTCPeerConnection({ iceServers: [] })
  assert.equal(pc.config.encodedInsertableStreams, true)
  pc.addTrack({ kind: 'audio' })
  destination = endpoint()
  pc.dispatchEvent(Object.assign(new Event('track'), { receiver: destination, track: destination.track }))
  const frame = { timestamp: 960, data: Uint8Array.of(1, 2, 3).buffer, getMetadata: () => ({ synchronizationSource: 77 }) }
  source.push(frame); destination.push(frame)
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(source.received[0], frame)
  assert.equal(destination.received[0], frame)
  assert.deepEqual([...new Uint8Array(frame.data)], [1, 2, 3])
  assert.equal(probe.sent[0].atMs, 12345)
  assert.equal(probe.received[0].atMs, 12345)
  assert.equal(probe.sent[0].data, probe.received[0].data)
  assert.equal(probe.sent[0].rtp, 960)
  assert.deepEqual(probe.errors, [])
  source.close(); destination.close()
})
