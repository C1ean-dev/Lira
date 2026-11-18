import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { optionsFrom, pipeline, receiverUrl } from './publish.mjs'

const runNative = process.platform === 'win32' && process.env.LIRA_RUN_GSTREAMER_NATIVE_TESTS === '1'
const gstBin = process.env.LIRA_GSTREAMER_BIN ??
  join(process.env.ProgramFiles ?? 'C:\\Program Files', 'gstreamer', '1.0', 'msvc_x86_64', 'bin')
const gstLaunch = join(gstBin, 'gst-launch-1.0.exe')

test('the AMD encoder and H.264 parser deliver the real 1080p60 caps to the transport', { skip: !runNative }, () => {
  const args = pipeline(optionsFrom([]))
  args.splice(args.indexOf('videotestsrc') + 1, 0, 'num-buffers=30')
  args.splice(args.indexOf('webrtcsink'), args.length, 'fakesink')
  const run = spawnSync(gstLaunch, args, { encoding: 'utf8', timeout: 20_000, windowsHide: true })
  assert.ifError(run.error)
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.match(run.stdout, /GstH264Parse:[^.]+\.GstPad:src: caps = video\/x-h264[^\r\n]+width=\(int\)1920[^\r\n]+height=\(int\)1080[^\r\n]+framerate=\(fraction\)60\/1/)
})

async function availablePort() {
  const socket = createServer().listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const { port } = socket.address()
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()))
  return port
}

test('the prototype serves its receiver and delivers synthetic H.264 over loopback WebRTC',
  { skip: !runNative, timeout: 25_000 }, async t => {
    const [webPort, signalPort] = await Promise.all([availablePort(), availablePort()])
    const options = optionsFrom(['--port', String(webPort), '--signal-port', String(signalPort)])
    const cwd = fileURLToPath(new URL('./receiver/', import.meta.url))
    const sender = spawn(gstLaunch, pipeline(options), { cwd, windowsHide: true })
    t.after(() => sender.kill())
    let output = ''
    sender.stdout.on('data', chunk => { output += chunk })
    sender.stderr.on('data', chunk => { output += chunk })
    let page
    for (let attempt = 0; attempt < 30 && sender.exitCode === null; attempt++) {
      try {
        const response = await fetch(receiverUrl(options), { signal: AbortSignal.timeout(350) })
        if (response.ok) { page = await response.text(); break }
      } catch {}
      await delay(100)
    }
    assert.match(page ?? '', /Teste GStreamer P2P/, output)
    const receiver = spawn(gstLaunch, [
      '-v', 'webrtcsrc', 'connect-to-first-producer=true', `signaller::uri=ws://127.0.0.1:${signalPort}`,
      'stun-server=NULL', '!', 'video/x-h264', '!', 'h264parse',
      '!', 'video/x-h264,alignment=au', '!', 'fakesink', 'silent=false',
    ], { windowsHide: true })
    const deadline = setTimeout(() => receiver.kill(), 12_000)
    t.after(() => { clearTimeout(deadline); receiver.kill() })
    let receiverErrors = ''
    receiver.on('error', error => { receiverErrors += error.message })
    receiver.stderr.on('data', chunk => { receiverErrors += chunk })
    const lines = createInterface({ input: receiver.stdout })
    let frames = 0
    for await (const line of lines) {
      if (/GstFakeSink:[^.]+: last-message = chain/.test(line) && ++frames === 10) break
    }
    assert.equal(frames, 10, receiverErrors + output.slice(-6000))
  })
