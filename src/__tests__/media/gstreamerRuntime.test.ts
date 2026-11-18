import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { findGStreamerRuntime, launchGStreamer } from '../../../electron/gstreamerLive'
import { normalizeGStreamerOffer, type GStreamerSignal } from '../../media/gstreamerProtocol'

const require = createRequire(import.meta.url)
const { runtimeFiles, stageRuntime } = require('../../../scripts/prepare-gstreamer-runtime.cjs')
const fullRuntime = process.platform === 'win32' && process.env.LIRA_RUN_GSTREAMER_NATIVE_TESTS === '1'
  ? findGStreamerRuntime(false, '') : undefined
let temp: string | undefined
afterEach(() => {
  if (temp) rmSync(temp, { recursive: true, force: true })
  temp = undefined
})

it('includes the standalone player runtime outside the asar', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
  expect(pkg.build.extraResources).toContainEqual({ from: '.scratch/gstreamer-runtime', to: 'gstreamer' })
  expect(runtimeFiles).toContain('bin/gst-launch-1.0.exe')
  expect(runtimeFiles).toContain('lib/gstreamer-1.0/gstrswebrtc.dll')
  expect(runtimeFiles).toContain('lib/gstreamer-1.0/gstamfcodec.dll')
})

it.skipIf(!fullRuntime)('loads the trimmed AMD runtime and creates an RTP offer through the private signaller', async () => {
  temp = mkdtempSync(join(tmpdir(), 'lira-gstreamer-test-'))
  const root = join(temp, 'runtime')
  const staged = stageRuntime(fullRuntime, root, { synthetic: true })
  console.info(`Runtime GStreamer: ${staged.files.length} binários, ${(staged.bytes / 1_000_000).toFixed(1)} MB.`)
  expect(staged.bytes).toBeLessThan(120_000_000)
  expect(readdirSync(join(root, 'lib', 'gstreamer-1.0')).every(name => name.endsWith('.dll'))).toBe(true)
  let resolveOffer!: (signal: GStreamerSignal) => void
  const offer = new Promise<GStreamerSignal>(resolve => { resolveOffer = resolve })
  const errors: string[] = []
  const capture = launchGStreamer(root, join(temp, 'registry.bin'), 'test', { width: 1920, height: 1080, fps: 60 },
    signal => { if (signal?.kind === 'sdp') resolveOffer(signal) }, error => errors.push(error), 'NULL')
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    expect(await capture.ready, errors.join('\n')).toBe(true)
    const session = 'a87cdfd3-1d62-447c-a155-50348760fe30'
    expect(capture.signal({ kind: 'watch', session })).toBe(true)
    const result = await Promise.race([offer, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('GStreamer did not emit an offer: ' + errors.join('\n'))), 7000)
    })])
    expect(result).toMatchObject({ kind: 'sdp', session, description: { type: 'offer', sdp: expect.stringContaining('H264/90000') } })
    expect(capture.signal({ kind: 'end', session })).toBe(true)
  } finally {
    clearTimeout(timeout)
    capture.stop()
    await capture.stopped
  }
}, 25000)

it.skipIf(!fullRuntime)('sends synthetic H.264 over RTP through the production signaller and staged runtime', async () => {
  temp = mkdtempSync(join(tmpdir(), 'lira-gstreamer-test-'))
  const root = join(temp, 'runtime')
  stageRuntime(fullRuntime, root, { synthetic: true })
  const session = 'a87cdfd3-1d62-447c-a155-50348760fe30'
  const producer = 'producer'
  const errors: string[] = []
  let receiverSocket: { send: (message: string) => void } | undefined
  const send = (message: object) => receiverSocket?.send(JSON.stringify(message))
  const normalizedOffers: string[] = []
  const capture = launchGStreamer(root, join(temp, 'registry.bin'), 'test', { width: 1920, height: 1080, fps: 60 }, signal => {
    if (signal?.kind === 'sdp') {
      const sdp = normalizeGStreamerOffer(signal.description.sdp)
      normalizedOffers.push(sdp)
      send({ type: 'peer', sessionId: session, sdp: { ...signal.description, sdp } })
    }
    if (signal?.kind === 'ice') send({ type: 'peer', sessionId: session, ice: signal.candidate })
    if (signal?.kind === 'end') send({ type: 'endSession', sessionId: session })
  }, error => errors.push(error), 'NULL')
  const signalling = new (require('ws').WebSocketServer)({ port: 0, host: '127.0.0.1' })
  let receiver: ReturnType<typeof spawn> | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  try {
    await once(signalling, 'listening')
    expect(await capture.ready, errors.join('\n')).toBe(true)
    signalling.on('connection', (socket: { send: (message: string) => void; on: (event: string, handle: (data: Buffer) => void) => void }) => {
      receiverSocket = socket
      socket.on('message', bytes => {
        const message = JSON.parse(bytes.toString())
        if (message.type === 'list') send({ type: 'list', producers: [{ id: producer }] })
        if (message.type === 'startSession') {
          send({ type: 'sessionStarted', peerId: producer, sessionId: session })
          capture.signal({ kind: 'watch', session })
        }
        if (message.type === 'peer' && message.sessionId === session) {
          if (message.sdp?.type === 'answer') capture.signal({ kind: 'sdp', session, description: message.sdp })
          if (message.ice) capture.signal({ kind: 'ice', session, candidate: message.ice })
        }
      })
      send({ type: 'welcome', peerId: 'receiver' })
    })
    receiver = spawn(join(fullRuntime!, 'bin', 'gst-launch-1.0.exe'), [
      '-v', 'webrtcsrc', 'connect-to-first-producer=true', `signaller::uri=ws://127.0.0.1:${signalling.address().port}`,
      'stun-server=NULL', '!', 'video/x-h264', '!', 'h264parse',
      '!', 'video/x-h264,alignment=au', '!', 'fakesink', 'silent=false',
    ], { windowsHide: true })
    receiver.stderr?.on('data', data => errors.push(String(data)))
    deadline = setTimeout(() => receiver?.kill(), 10000)
    let frames = 0
    for await (const line of createInterface({ input: receiver.stdout! })) {
      if (/GstFakeSink:[^.]+: last-message = chain/.test(line) && ++frames === 10) break
    }
    expect(frames, errors.join('\n')).toBe(10)
    expect(normalizedOffers[0]).toMatch(/a=rtpmap:\d+ H264\/90000/)
  } finally {
    clearTimeout(deadline)
    if (receiver && receiver.exitCode === null && receiver.signalCode === null) {
      const closed = once(receiver, 'close')
      receiver.kill()
      await closed
    }
    for (const socket of signalling.clients) socket.terminate()
    signalling.close()
    capture.stop()
    await capture.stopped
  }
}, 25000)
