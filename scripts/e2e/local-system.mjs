import { createServer as createHttpServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { PeerServer } from 'peer'
import { createServer as createSocketServer } from 'node:net'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { electronSystem } from './electron-system.mjs'

async function freePort() {
  const server = createSocketServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}

export async function localSystem() {
  process.env.VITEST = '1'
  const { createServer } = await import('vite')
  const output = path.resolve(process.env.LIRA_E2E_OUTPUT || '.scratch/e2e-system')
  await mkdir(output, { recursive: true })
  await Promise.all(['report.json', 'trace-0.zip', 'trace-1.zip', 'failure-0.png', 'failure-1.png', 'diagnostics-0.json', 'diagnostics-1.json']
    .map(name => rm(path.join(output, name), { force: true })))
  const microphone = path.join(output, 'microphone.wav')
  const rate = 48000, count = rate * 4, wave = Buffer.alloc(44 + count * 2)
  wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8)
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22)
  wave.writeUInt32LE(rate, 24); wave.writeUInt32LE(rate * 2, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34)
  wave.write('data', 36); wave.writeUInt32LE(count * 2, 40)
  for (let i = 0; i < count; i++) wave.writeInt16LE(Math.round(32767 * (.18 * Math.sin(2 * Math.PI * 220 * i / rate) + .06 * Math.sin(2 * Math.PI * 440 * i / rate))), 44 + i * 2)
  await writeFile(microphone, wave)
  let signalServer
  PeerServer({ host: '127.0.0.1', port: 0, path: '/' }, server => { signalServer = server })
  const rooms = new Map(), relayMessages = []
  const relayServer = createHttpServer()
  const sockets = new WebSocketServer({ server: relayServer })
  sockets.on('connection', (socket, request) => {
    if (request.url !== '/rooms') { socket.close(); return }
    socket.send(JSON.stringify({ type: 'READY', protocolVersion: 1 }))
    socket.on('message', bytes => {
      const message = JSON.parse(String(bytes))
      relayMessages.push(message)
      if (message.type === 'QUERY_ROOMS') {
        for (const roomInfo of rooms.values()) socket.send(JSON.stringify({ type: 'ANNOUNCE_ROOM', roomInfo, timestamp: Date.now() }))
        return
      }
      if (message.type === 'ANNOUNCE_ROOM') rooms.set(message.roomInfo.code, message.roomInfo)
      if (message.type === 'UNREGISTER_ROOM') rooms.delete(message.roomId)
      for (const client of sockets.clients) if (client.readyState === 1) client.send(String(bytes))
    })
  })
  await new Promise(resolve => relayServer.listen(0, '127.0.0.1', resolve))
  const vite = await createServer({
    cacheDir: 'node_modules/.cache/system-e2e-vite',
    server: { host: '127.0.0.1', port: await freePort(), strictPort: true, open: false, hmr: false,
      watch: { ignored: ['**/.scratch/**', `${output.split(path.sep).join('/')}/**`] } },
    logLevel: 'error',
    plugins: [{ name: 'system-e2e-page', configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?')[0] !== '/__system-e2e.html') return next()
        try {
          const html = await server.transformIndexHtml(request.url,
            '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><script>window.__LIRA_MUTE_SOUND_EFFECTS__=true;</script></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/system-e2e.ts"></script></body></html>')
          response.setHeader('Content-Type', 'text/html'); response.end(html)
        } catch (error) { next(error) }
      })
    } }],
  })
  let desktopSystem
  const users = []
  try {
    await vite.listen()
    const headed = process.env.LIRA_E2E_HEADED === '1'
    desktopSystem = await electronSystem({ output, microphone, visible: headed })
    const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
    for (const [index, name] of ['Ana E2E', 'Bruno E2E'].entries()) {
      const { desktop, context, page, native } = await desktopSystem.open(index)
      await context.grantPermissions(['microphone', 'camera'])
      await context.tracing.start({ snapshots: true, sources: true })
      const user = { name, desktop, context, page, native, errors: [], logs: [], network: [] }
      users.push(user)
      page.setDefaultTimeout(15000)
      page.on('pageerror', error => user.errors.push(error.stack || error.message))
      page.on('console', message => { user.logs.push(message.text()); if (user.logs.length > 150) user.logs.shift() })
      await context.route('**/*', route => {
        const url = new URL(route.request().url())
        // Keep the development server's native-file writer away from user data.
        if (url.pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(route.request().method())) return route.fulfill({ json: { success: true } })
        if (url.pathname === '/src/data/nativeSpaces.json') return route.fulfill({ contentType: 'text/javascript', body: 'export default []' })
        if (url.hostname === '127.0.0.1' || url.protocol === 'data:') return route.continue()
        user.network.push(url.origin)
        return route.abort()
      })
      await context.addInitScript(({ signalingPort, relayPort }) => {
        window.__LIRA_MUTE_SOUND_EFFECTS__ = true
        if (location.protocol === 'http:') {
          if (localStorage.getItem('lira_hw_acceleration_enabled') === null) {
            localStorage.setItem('lira_hw_acceleration_enabled', 'false')
          }
          localStorage.setItem('lira_sound_effects_enabled', 'false')
          localStorage.setItem('lira_sound_effects_volume', '0')
        }
        let copiedText = ''
        Object.defineProperties(navigator.clipboard, {
          readText: { value: async () => copiedText },
          writeText: { value: async text => { copiedText = text } },
          write: { value: async ([item]) => { copiedText = await (await item.getType('text/plain')).text() } },
        })
        // No external STUN/TURN requests: actual ICE/DTLS/RTP runs on loopback.
        const NativeRTCPeerConnection = window.RTCPeerConnection
        window.RTCPeerConnection = new Proxy(NativeRTCPeerConnection, {
          construct(target, [configuration]) { return new target({ ...configuration, iceServers: [] }) },
        })
        const NativeWebSocket = window.WebSocket
        window.WebSocket = class extends NativeWebSocket {
          constructor(value, protocols) {
            const url = new URL(String(value))
            if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
              const peer = url.pathname.includes('peerjs')
              const rooms = url.pathname === '/rooms'
              url.protocol = 'ws:'; url.hostname = '127.0.0.1'
              url.port = String(peer ? signalingPort : relayPort)
              if (!peer && !rooms) url.pathname = '/offline'
            }
            super(url.href, protocols)
          }
        }
        const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, value: async constraints => {
          if (!constraints?.video) return nativeGetUserMedia(constraints)
          const audioStream = constraints.audio ? await nativeGetUserMedia({ audio: constraints.audio }).catch(() => null) : null
          const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480
          const ctx = canvas.getContext('2d'); let frame = 0
          const draw = () => { ctx.fillStyle = `hsl(${frame++ % 360} 80% 50%)`; ctx.fillRect(0, 0, 640, 480) }
          draw()
          const stream = canvas.captureStream(30)
          const track = stream.getVideoTracks()[0]
          const timer = setInterval(() => {
            if (track.readyState === 'ended') clearInterval(timer)
            else draw()
          }, 33)
          track.addEventListener('ended', () => clearInterval(timer), { once: true })
          return new MediaStream([...(audioStream ? audioStream.getAudioTracks() : []), track])
        } })
        Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
          const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360
          const ctx = canvas.getContext('2d'); let frame = 0
          const draw = () => { ctx.fillStyle = `hsl(${frame++ % 360} 80% 50%)`; ctx.fillRect(0, 0, 640, 360) }
          draw()
          const stream = canvas.captureStream(30)
          const track = stream.getVideoTracks()[0]
          const timer = setInterval(() => {
            if (track.readyState === 'ended') clearInterval(timer)
            else draw()
          }, 33)
          return stream
        } })
      }, { signalingPort: signalServer.address().port, relayPort: relayServer.address().port })
      await page.goto(`${origin}/__system-e2e.html`, { waitUntil: 'domcontentloaded', timeout: 90000 })
      await page.getByLabel('Seu Nickname').fill(name)
    }
    return { engine: 'electron', users, output, rooms, relayMessages, async close(failed = false) {
      for (const [index, user] of users.entries()) {
        if (failed) {
          await user.page.screenshot({ path: path.join(output, `failure-${index}.png`), fullPage: true }).catch(() => {})
          await writeFile(path.join(output, `diagnostics-${index}.json`), JSON.stringify({ errors: user.errors, logs: user.logs,
            body: await user.page.locator('body').innerText().catch(() => ''),
            snapshot: await user.page.evaluate(() => window.liraE2E?.snapshot()).catch(() => null),
            rtp: await user.page.evaluate(() => window.liraE2E?.rtp()).catch(() => null),
            playback: await user.page.evaluate(() => window.liraE2E?.playback()).catch(() => null) }, null, 2))
        }
        await user.context.tracing.stop({ path: path.join(output, `trace-${index}.zip`) }).catch(() => {})
      }
      await desktopSystem?.close(); await vite.close()
      for (const socket of sockets.clients) socket.terminate()
      await new Promise(resolve => sockets.close(resolve))
      await new Promise(resolve => relayServer.close(resolve))
      signalServer.closeAllConnections?.()
      await new Promise(resolve => signalServer.close(resolve))
    } }
  } catch (error) {
    await desktopSystem?.close(); await vite.close()
    for (const socket of sockets.clients) socket.terminate()
    sockets.close(); relayServer.close(); signalServer?.close()
    throw error
  }
}
