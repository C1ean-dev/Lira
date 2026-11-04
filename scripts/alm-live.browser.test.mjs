import test from 'node:test'
import assert from 'node:assert/strict'

test('ALM synchronizes audio/video, filters temporal SVC and sheds one child with one video encoder', {
  skip: process.env.LIRA_RUN_BROWSER_TESTS !== '1', timeout: 180_000,
}, async () => {
  process.env.VITEST = '1'
  process.env.LIRA_TARGET = 'web'
  const { createServer } = await import('vite')
  const { chromium } = await import('playwright')
  const server = await createServer({
    logLevel: 'error', optimizeDeps: { noDiscovery: true, include: [] },
    server: { host: '127.0.0.1', port: 0, open: false, hmr: false },
    plugins: [{ name: 'alm-test-page', configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url !== '/__alm-test') return next()
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><title>Synthetic ALM live</title>')
      })
    } }],
  })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true, executablePath: process.env.LIRA_CHROMIUM_EXECUTABLE || undefined,
      args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--mute-audio'] })
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__alm-test`)
    await page.evaluate(async () => {
      const { AlmLive } = await import('/src/p2p/almLive.ts')
      const { supportsAlmVideo } = await import('/src/media/almVideo.ts')
      const { attachRemoteAudio, applyAudioOutput } = await import('/src/media/remoteAudio.ts')
      if (!supportsAlmVideo()) throw new Error('Browser lacks WebCodecs/capture support')
      const encoder = window.VideoEncoder
      window.encoderCount = 0
      window.VideoEncoder = class extends encoder {
        constructor(options) { super(options); window.encoderCount++ }
      }
      const channels = new Map()
      const nativeSend = RTCDataChannel.prototype.send
      RTCDataChannel.prototype.send = function(data) {
        // Audio and video take different times at every hop; arrival time alone
        // must not decide when either track plays.
        if (data instanceof ArrayBuffer) {
          const delay = new DataView(data).getUint8(25) === 1 ? 20 : 60
          setTimeout(() => { if (this.readyState === 'open') nativeSend.call(this, data) }, delay)
          return
        }
        return nativeSend.call(this, data)
      }
      const pcs = []
      const nativePc = window.RTCPeerConnection
      window.RTCPeerConnection = class extends nativePc {
        constructor(config) { super(config); pcs.push(this) }
        createDataChannel(label, options) {
          const channel = super.createDataChannel(label, options)
          channels.set(this, channel)
          return channel
        }
      }
      const nodes = new Map(), watching = new Set(), playing = new Set(), frames = new Map(), logs = [], outputs = new Map()
      const channelsByNode = new Map()
      for (let i = 1; i <= 12; i++) {
        const id = String(i)
        if (i > 1) watching.add(id)
        nodes.set(id, new AlmLive({
          id: () => id, peers: () => [...nodes.keys()].filter(peer => peer !== id),
          eligible: peer => nodes.has(peer), watching: () => watching.has(id),
          ice: async () => ({ iceServers: [] }),
          send: (to, payload) => {
            if (payload.description?.type === 'offer') {
              const pc = pcs.find(pc => pc.localDescription?.sdp === payload.description.sdp)
              const list = channelsByNode.get(id) || []
              if (pc) { list.push(channels.get(pc)); channelsByNode.set(id, list) }
            }
            queueMicrotask(() => nodes.get(to)?.receive(id, structuredClone(payload)).catch(error => logs.push(String(error))))
          },
          stream: (_root, stream) => {
            if (stream && !outputs.has(id)) {
              const video = document.createElement('video')
              video.muted = true; video.srcObject = stream
              document.body.append(video)
              outputs.set(id, video)
              const audio = document.createElement('audio')
              attachRemoteAudio(audio, stream, { tile: 'test', peer: '1', muted: false })
              applyAudioOutput(audio, { muted: false, volume: 1 })
              const count = () => { frames.set(id, (frames.get(id) || 0) + 1); video.requestVideoFrameCallback(count) }
              video.requestVideoFrameCallback(count)
              void video.play()
            }
          },
          rtp: (viewer, enabled) => { if (enabled) playing.add(viewer); else playing.delete(viewer) },
          log: (event, data) => { logs.push({ id, event, ...data }); if (logs.length > 200) logs.shift() },
        }))
      }
      const canvas = document.createElement('canvas')
      canvas.width = 640; canvas.height = 360
      const context = canvas.getContext('2d')
      const audio = new AudioContext({ sampleRate: 48000 })
      await audio.resume()
      const oscillator = audio.createOscillator(), gain = audio.createGain(), destination = audio.createMediaStreamDestination()
      oscillator.frequency.value = 440
      oscillator.connect(gain); gain.connect(destination)
      const origin = audio.currentTime
      gain.gain.setValueAtTime(0, origin)
      for (let second = 1; second <= 80; second++) {
        gain.gain.setValueAtTime(0.4, origin + second)
        gain.gain.setValueAtTime(0, origin + second + 0.2)
      }
      oscillator.start()
      window.drawTimer = setInterval(() => {
        context.fillStyle = (audio.currentTime - origin) % 1 < 0.2 ? 'white' : 'black'
        context.fillRect(0, 0, 640, 360)
      }, 33)
      window.sourceStream = canvas.captureStream(30)
      window.almTest = { nodes, watching, playing, frames, logs, channelsByNode, outputs, audio, oscillator }
      await nodes.get('1').start(window.sourceStream.getVideoTracks()[0], 700_000, 30, false, destination.stream.getAudioTracks()[0])
      for (const [id, node] of nodes) if (id !== '1') node.watch('1', true, ['7', '8', '9'].includes(id) ? 180 : 1080)
    })
    try {
      await page.waitForFunction(() => window.almTest.playing.size === 11 && window.almTest.frames.size === 11, null, { timeout: 35_000 })
      const initial = await page.evaluate(() => ({ encoders: window.encoderCount, tree: window.almTest.nodes.get('1').describe()[0].edges,
        channels: [...window.almTest.channelsByNode.values()].flat().map(channel => ({ ordered: channel.ordered, retransmits: channel.maxRetransmits })) }))
      assert.equal(initial.encoders, 1)
      assert.equal(initial.tree.filter(edge => edge.parent === '1').length, 3)
      assert.equal(initial.tree.length, 11)
      assert(initial.channels.every(channel => channel.ordered === false && channel.retransmits === 0))
      const media = await page.evaluate(async () => {
        const state = window.almTest
        const start = new Map(state.frames)
        await new Promise(resolve => setTimeout(resolve, 2200))
        const mini = state.frames.get('7') - start.get('7'), full = state.frames.get('12') - start.get('12')
        const source = state.nodes.get('1').describe()[0]
        const { almAudioOutput } = await import('/src/media/almStreams.ts')
        const output = almAudioOutput(state.outputs.get('12').srcObject)
        const pixels = document.createElement('canvas'); pixels.width = 1; pixels.height = 1
        const draw = pixels.getContext('2d')
        const flashes = [], beeps = []
        let wasWhite = false, wasLoud = false
        const startTime = performance.now(), end = startTime + 4500
        while (performance.now() < end) {
          draw.drawImage(state.outputs.get('12'), 0, 0, 1, 1)
          const white = draw.getImageData(0, 0, 1, 1).data[0] > 200
          const loud = output.level() > 0.03
          const now = performance.now()
          if (white && !wasWhite && now > startTime + 400 && now < end - 400) flashes.push(now)
          if (loud && !wasLoud) beeps.push(now)
          wasWhite = white; wasLoud = loud
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        const skews = flashes.map(flash => beeps.map(beep => flash - beep).sort((a,b)=>Math.abs(a)-Math.abs(b))[0]).filter(skew => Math.abs(skew) < 500)
        return { mini, full, temporalLayers: source.temporalLayers, svcObserved: source.svcObserved, skews,
          sync: state.nodes.get('12').describe()[0] }
      })
      console.log('ALM media measurements', JSON.stringify({ miniFrames: media.mini, fullFrames: media.full,
        temporalLayers: media.temporalLayers, flashBeepSkewMs: media.skews, scheduledSkewMs: media.sync.audioVideoSkewMs }))
      assert(media.temporalLayers > 1 && media.svcObserved, 'encoder produces actual temporal layer metadata')
      assert(media.mini > 0 && media.mini < media.full * 0.6, 'mini display receives fewer frames through SVC')
      assert(media.skews.length >= 2 && media.skews.every(skew => Math.abs(skew) < 150), 'decoded flashes and beeps stay synchronized despite different hop delays')
      await page.evaluate(() => window.almTest.nodes.get('7').watch('1', true, 1080))
      await page.waitForFunction(() => window.almTest.nodes.get('1').describe()[0].edges.find(edge => edge.child === '7').maxLayer > 0, null, { timeout: 5000 })
      assert.equal(await page.evaluate(() => window.encoderCount), 1, 'fullscreen upgrade shares the original encoder')
      await page.evaluate(() => window.almTest.nodes.get('1').updateBitrate(600_000))
      assert.equal(await page.evaluate(() => window.encoderCount), 1, 'bitrate updates preserve the single encoder')
      await page.evaluate(() => {
        for (const channel of window.almTest.channelsByNode.get('2')) Object.defineProperty(channel, 'bufferedAmount', { configurable: true, get: () => 700_000 })
      })
      await page.waitForFunction(() => window.almTest.nodes.get('1').describe()[0].edges.some(edge => edge.child === '7' && edge.parent === '5'), null, { timeout: 15_000 })
      await page.waitForFunction(() => window.almTest.nodes.get('2').describe()[0].links.filter(edge => edge.parent === '2').length === 2, null, { timeout: 10_000 })
      const shed = await page.evaluate(() => {
        for (const channel of window.almTest.channelsByNode.get('2')) delete channel.bufferedAmount
        return { tree: window.almTest.nodes.get('1').describe()[0].edges, playing: [...window.almTest.playing], encoders: window.encoderCount }
      })
      for (const id of ['5', '6']) {
        assert.equal(shed.tree.find(edge => edge.child === id).id, initial.tree.find(edge => edge.child === id).id)
        assert(shed.playing.includes(id))
      }
      assert.equal(shed.encoders, 1)
      await page.evaluate(() => { window.almTest.watching.delete('5'); window.almTest.nodes.get('5').watch('1', false) })
      await page.waitForFunction(() => !window.almTest.nodes.get('1').describe()[0].edges.some(edge => edge.child === '5'), null, { timeout: 10_000 })
      await page.waitForFunction(() => window.almTest.playing.size === 10, null, { timeout: 15_000 })
    } catch (error) {
      console.error(JSON.stringify(await page.evaluate(() => ({ playing: [...window.almTest.playing], frames: [...window.almTest.frames],
        topology: window.almTest.nodes.get('12').describe(), logs: window.almTest.logs.slice(-2) })), null, 2))
      throw error
    }
    await page.evaluate(() => {
      for (const node of window.almTest.nodes.values()) node.close()
      clearInterval(window.drawTimer)
      window.sourceStream.getTracks().forEach(track => track.stop())
      window.almTest.oscillator.stop()
      void window.almTest.audio.close()
    })
  } finally {
    await browser?.close()
    await server.close()
  }
})
