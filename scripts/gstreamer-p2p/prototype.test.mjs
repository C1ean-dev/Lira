import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { optionsFrom, pipeline, receiverUrl, requiredElements } from './publish.mjs'
import { createNegotiation, measure, videoSnapshot } from './receiver/probe.js'

test('the publisher CLI exposes its options without requiring GStreamer', () => {
  const entry = fileURLToPath(new URL('./publish.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [entry, '--help'], { encoding: 'utf8', timeout: 5000 })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /--check.*--source test\|screen/)
})

test('defaults to a synthetic 1080p60 AMD AMF source on loopback at 8 Mbps', () => {
  const options = optionsFrom([])
  const args = pipeline(options)
  assert.ok(args.includes('videotestsrc'))
  assert.ok(args.includes('video/x-raw,format=NV12,width=1920,height=1080,framerate=60/1'))
  assert.ok(args.includes('amfh264enc'))
  assert.ok(args.includes('bitrate=8000'))
  assert.ok(args.includes('gop-size=60'))
  assert.ok(args.includes('video/x-h264,profile=(string){constrained-baseline,baseline},stream-format=avc,alignment=au'))
  assert.ok(args.includes('webrtcsink'))
  assert.ok(args.includes('stun-server=NULL'))
  assert.ok(args.includes('do-retransmission=true'))
  assert.ok(args.includes('signalling-server-host=127.0.0.1'))
  assert.match(receiverUrl(options), /^http:\/\/127\.0\.0\.1:8080\//)
  assert.ok(!requiredElements(options).includes('d3d11screencapturesrc'))
})

test('keeps Windows screen capture and color conversion in D3D11 memory for AMF', () => {
  const options = optionsFrom(['--source', 'screen', '--monitor', '1', '--host', '192.168.1.25',
    '--resolution', '720', '--fps', '30', '--bitrate-kbps', '6000', '--signal-port', '9000'])
  const args = pipeline(options)
  assert.ok(args.includes('d3d11screencapturesrc'))
  assert.ok(args.includes('capture-api=dxgi'))
  assert.ok(args.includes('monitor-index=1'))
  assert.ok(args.includes('d3d11convert'))
  assert.ok(args.includes('video/x-raw(memory:D3D11Memory),format=NV12,width=1280,height=720,framerate=30/1'))
  assert.ok(args.includes('bitrate=6000'))
  assert.ok(args.includes('signalling-server-port=9000'))
  assert.equal(new URL(receiverUrl(options)).searchParams.get('signal'), '9000')
})

test('uses WGC when targeting a single window and rejects unsafe or invalid options', () => {
  const args = pipeline(optionsFrom(['--source', 'screen', '--window-handle', '43210']))
  assert.ok(args.includes('capture-api=wgc'))
  assert.ok(args.includes('window-handle=43210'))
  for (const flags of [
    ['--host', '0.0.0.0'], ['--host', '8.8.8.8'], ['--host', '10.0.0.1 ! fakesink'],
    ['--fps', '59'], ['--monitor', '0'], ['--bitrate-kbps', '4e3'],
    ['--port', '8443'], ['--port'], ['--unknown'],
    ['--source', 'screen', '--monitor', '0', '--window-handle', '1'],
  ]) assert.throws(() => optionsFrom(flags))
})

test('uses the official default signaller protocol and orders SDP before queued ICE', async () => {
  const sent = [], applied = []
  const candidate = { candidate: 'candidate:gst', sdpMLineIndex: 0 }
  const ourCandidate = { candidate: 'candidate:browser', sdpMLineIndex: 0 }
  const peer = {
    async setRemoteDescription(sdp) { applied.push(sdp); this.remoteDescription = sdp },
    async addIceCandidate(ice) { applied.push(ice) },
    async createAnswer() { return { type: 'answer', sdp: 'v=0 answer' } },
    async setLocalDescription(sdp) { this.localDescription = sdp; negotiation.ice(ourCandidate) },
  }
  const negotiation = createNegotiation(peer, message => sent.push(message))
  const offer = { type: 'offer', sdp: 'v=0 offer' }
  await negotiation.receive({ type: 'welcome', peerId: 'viewer' })
  await negotiation.receive({ type: 'list', producers: [{ id: 'gst' }] })
  await negotiation.receive({ type: 'peerStatusChanged', peerId: 'gst', roles: ['producer'] })
  await negotiation.receive({ type: 'sessionStarted', peerId: 'other', sessionId: 'wrong' })
  await negotiation.receive({ type: 'sessionStarted', peerId: 'gst', sessionId: 'live' })
  await negotiation.receive({ type: 'peer', sessionId: 'wrong', sdp: offer })
  await negotiation.receive({ type: 'peer', sessionId: 'live', ice: candidate })
  assert.deepEqual(applied, [])
  await negotiation.receive({ type: 'peer', sessionId: 'live', sdp: offer })
  assert.deepEqual(applied, [offer, candidate])
  assert.deepEqual(sent, [
    { type: 'setPeerStatus', roles: ['listener'] },
    { type: 'list' },
    { type: 'startSession', peerId: 'gst' },
    { type: 'peer', sessionId: 'live', sdp: peer.localDescription },
    { type: 'peer', sessionId: 'live', ice: ourCandidate },
  ])
})

test('distinguishes 35 displayed FPS from 60 decoded FPS and verifies the selected direct route', () => {
  const reports = new Map([
    ['video', { id: 'video', type: 'inbound-rtp', kind: 'video', framesDecoded: 120, bytesReceived: 2_000_000,
      codecId: 'codec', transportId: 'transport', freezeCount: 3, totalFreezesDuration: 1.2, framesDropped: 5 }],
    ['codec', { mimeType: 'video/H264' }],
    ['transport', { selectedCandidatePairId: 'pair' }],
    ['pair', { localCandidateId: 'local', remoteCandidateId: 'remote', currentRoundTripTime: 0.012 }],
    ['local', { candidateType: 'host' }],
    ['remote', { candidateType: 'host' }],
  ])
  const current = videoSnapshot(reports, { at: 2000, presentedFrames: 85, width: 1920, height: 1080 })
  const result = measure(current, { ...current, at: 1000, presentedFrames: 50, framesDecoded: 60, bytesReceived: 1_000_000 })
  assert.equal(result.presentedFps, 35)
  assert.equal(result.decodedFps, 60)
  assert.equal(result.mbps, 8)
  assert.equal(result.direct, true)
  assert.equal(result.rttMs, 12)
  assert.equal(result.freezeCount, 3)
  assert.equal(result.freezeSeconds, 1.2)
  assert.equal(result.droppedFrames, 5)
  assert.equal(measure(current, { ...current, at: 1000 }).presentedFps, 0)
  assert.equal(measure(current, { ...current, at: 1000, id: 'old' }).mbps, null)
  reports.get('local').candidateType = 'relay'
  assert.equal(measure(videoSnapshot(reports, current), null).direct, false)
})
