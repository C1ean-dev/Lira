import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

// Browser use requires explicit authorization under AGENTS.md. This test is
// opt-in and uses synthetic media and local signaling only; no real mic/screen.
test('two real browser sessions exchange media and recover calls', {
  skip: process.env.LIRA_RUN_BROWSER_TESTS !== '1', timeout: 180000,
}, async t => {
  process.env.VITEST = '1'
  process.env.LIRA_TARGET = 'web'
  const { createServer } = await import('vite')
  const { PeerServer } = await import('peer')
  const playwrightPackage = process.env.LIRA_PLAYWRIGHT_PACKAGE
  const { chromium } = await import(playwrightPackage ? pathToFileURL(playwrightPackage).href : 'playwright')
  let signalingServer
  const signaling = PeerServer({ port: 0, host: '127.0.0.1', path: '/' }, server => { signalingServer = server })
  const clients = new Set()
  signaling.on('connection', client => clients.add(client))
  signaling.on('disconnect', client => clients.delete(client))
  const vite = await createServer({
    server: { port: 0, host: '127.0.0.1', open: false, hmr: false },
    logLevel: 'error',
    plugins: [{ name: 'core-realtime-test-page', configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== '/__core-realtime-test.html') return next()
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><html><head><title>Lira synthetic media test</title></head><body></body></html>')
      })
    } }],
  })
  let browser
  let pages = []
  const logs = []
  try {
    await vite.listen()
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`
    browser = await chromium.launch({
      headless: true, executablePath: process.env.LIRA_CHROMIUM_EXECUTABLE || undefined,
      args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    })
    const contexts = await Promise.all([browser.newContext(), browser.newContext()])
    const [host, guest] = await Promise.all(contexts.map(context => context.newPage()))
    pages = [host, guest]
    for (const [index, page] of pages.entries()) {
      page.on('console', message => {
        if (/call\.readiness-audio-stats-pending/.test(message.text())) return
        logs.push(`${index}: ${message.text()}`); if (logs.length > 80) logs.shift()
      })
      page.on('pageerror', error => logs.push(`${index}: ${error.stack}`))
    }
    const room = `CORE-${Date.now()}`
    async function prepare(page, name) {
      await page.goto(`${base}/__core-realtime-test.html`)
      await page.evaluate(async ({ name, signalingPort }) => {
        window.__LIRA_LOCAL_SIGNALING_PORT__ = signalingPort
        const [{ PeerManager }, { MediaManager }, { MediaCallHandler, SHARED_RTC_CONFIG }, { useGameStore }, { useMediaStore }, { useLiveWatchStore }, { liveViewReporter }] = await Promise.all([
          import('/src/p2p/PeerManager.ts'), import('/src/media/MediaManager.ts'), import('/src/p2p/mediaCalls.ts'),
          import('/src/store/useGameStore.ts'), import('/src/store/useMediaStore.ts'),
          import('/src/store/useLiveWatchStore.ts'), import('/src/media/liveView.ts'),
        ])
        // Exercise real ICE/DTLS/RTP on loopback without external STUN/TURN.
        SHARED_RTC_CONFIG.iceServers = []
        const resources = []
        function source(width, height, frequency) {
          const canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          const ctx = canvas.getContext('2d')
          let frame = 0
          const draw = () => { ctx.fillStyle = `hsl(${frame++ % 360} 80% 50%)`; ctx.fillRect(0, 0, width, height) }
          draw()
          const timer = setInterval(draw, 33)
          const audio = new AudioContext()
          const oscillator = audio.createOscillator()
          oscillator.frequency.value = frequency
          const gain = audio.createGain(); gain.gain.value = 0.1
          const output = audio.createMediaStreamDestination()
          oscillator.connect(gain).connect(output); oscillator.start()
          void audio.resume()
          const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...output.stream.getAudioTracks()])
          resources.push({ audio, oscillator, timer, stream })
          return stream
        }
        const camera = source(320, 240, 440)
        useGameStore.getState().setLocalPlayer({ name, currentZoneId: 'core-room', isScreenSharing: false, isMuted: false, isCameraOff: false })
        useMediaStore.setState({ localStream: camera, isMuted: false, isCameraOff: false, isScreenSharing: false, selectedAudioOutput: 'default' })
        window.core = { peer: PeerManager.getInstance(), media: MediaManager.getInstance(), game: useGameStore, store: useMediaStore, watch: useLiveWatchStore, liveViewReporter, source, camera, resources, MediaCallHandler }
      }, { name, signalingPort: signalingServer.address().port })
    }
    await prepare(host, 'Host')
    await prepare(guest, 'Guest')
    await host.evaluate(room => core.peer.createRoom(room, core.game.getState().localPlayer, { isPublic: false }, 2), room)
    await guest.evaluate(room => core.peer.joinRoom(room, core.game.getState().localPlayer, 2), room)
    // Four negotiation windows (12 s each) plus retry backoff can take 53 s.
    // Let the real recovery policy finish before declaring the scenario failed.
    const connectionTimeout = 60000
    async function connected(page) {
      await page.waitForFunction(() => (
        core.peer.mediaCalls.size === 1 &&
        Object.values(core.game.getState().callStates).includes('connected') &&
        Object.keys(core.game.getState().remotePlayers).length === 1
      ), null, { timeout: connectionTimeout })
    }
    await Promise.all([connected(host), connected(guest)])
    async function stats(page) {
      return page.evaluate(async () => {
        const call = [...core.peer.mediaCalls.values()][0]
        const report = await call.peerConnection.getStats()
        let audio = 0; let video = 0; let width = 0; let height = 0
        report.forEach(item => {
          if (item.type !== 'inbound-rtp') return
          if ((item.kind || item.mediaType) === 'audio') audio += item.bytesReceived || 0
          if ((item.kind || item.mediaType) === 'video') { video += item.bytesReceived || 0; width = item.frameWidth || 0; height = item.frameHeight || 0 }
        })
        return { audio, video, width, height }
      })
    }
    for (const page of [host, guest]) {
      await page.waitForFunction(async () => {
        const call = [...core.peer.mediaCalls.values()][0]
        if (!call) return false
        const values = [...(await call.peerConnection.getStats()).values()]
        return ['audio', 'video'].every(kind => values.some(item => item.type === 'inbound-rtp' && (item.kind || item.mediaType) === kind && item.bytesReceived > 0))
      }, null, { timeout: 15000 })
      const result = await stats(page)
      assert.ok(result.audio > 0 && result.video > 0, 'bidirectional audio and video RTP')
    }
    t.diagnostic('Real PeerJS connection and bidirectional audio/video RTP passed.')
    await host.evaluate(() => {
      const screen = core.source(640, 360, 880)
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => screen })
      return core.media.startScreenShare().then(stream => { if (!stream) throw new Error('Screen start failed') })
    })
    await guest.waitForFunction(() => Object.values(core.game.getState().remotePlayers).some(player => player.isScreenSharing) && Object.keys(core.store.getState().peerVoiceStreams).length === 1, null, { timeout: 20000 })
    await guest.evaluate(() => {
      const sharer = Object.values(core.game.getState().remotePlayers).find(player => player.isScreenSharing)
      core.watch.getState().watch(sharer.id)
      core.liveViewReporter.setBox('core-stage', sharer.id, 360)
    })
    await guest.waitForFunction(async () => {
      const call = [...core.peer.mediaCalls.values()][0]
      return [...(await call.peerConnection.getStats()).values()].some(item => item.type === 'inbound-rtp' && item.kind === 'video' && item.frameWidth === 640 && item.frameHeight === 360)
    }, null, { timeout: 15000 })
    await guest.evaluate(async () => {
      const remoteId = Object.keys(core.store.getState().peerStreams)[0]
      const video = document.createElement('video')
      video.muted = true
      video.srcObject = core.store.getState().peerStreams[remoteId]
      document.body.append(video)
      await video.play()
      core.receivedVideo = video
      const audio = new AudioContext()
      await audio.resume()
      const meter = stream => {
        const analyser = audio.createAnalyser()
        analyser.fftSize = 2048
        audio.createMediaStreamSource(stream).connect(analyser)
        return () => {
          const samples = new Float32Array(analyser.fftSize)
          analyser.getFloatTimeDomainData(samples)
          return Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length)
        }
      }
      core.receivedAudio = { screen: meter(core.store.getState().peerStreams[remoteId]), voice: meter(core.store.getState().peerVoiceStreams[remoteId]) }
    })
    await guest.waitForFunction(() => core.receivedVideo.videoWidth === 640 && core.receivedVideo.videoHeight === 360 && core.receivedVideo.getVideoPlaybackQuality().totalVideoFrames > 0 && core.receivedAudio.screen() > 0.005 && core.receivedAudio.voice() > 0.005, null, { timeout: 15000 })
    assert.equal(await host.evaluate(() => core.peer.liveVoiceCalls.size), 1)
    await host.evaluate(() => core.media.syncMuteState(true))
    assert.equal(await host.evaluate(() => core.store.getState().localStream.getAudioTracks()[0].enabled), false)
    assert.equal(await host.evaluate(() => core.store.getState().localScreenStream.getAudioTracks().find(track => track.__screenShareLiveAudio).enabled), true)
    await guest.waitForFunction(() => core.receivedAudio.voice() < 0.001 && core.receivedAudio.screen() > 0.005, null, { timeout: 15000 })
    await host.evaluate(() => core.media.syncMuteState(false))
    await guest.waitForFunction(() => core.receivedAudio.voice() > 0.005, null, { timeout: 15000 })
    t.diagnostic('Screen video replacement, separate voice call and independent microphone mute passed.')
    await host.evaluate(() => { core.previousCall = [...core.peer.mediaCalls.values()][0]; core.peer.peer.disconnect() })
    await host.waitForFunction(() => !core.peer.peer.disconnected && core.game.getState().connectionStatus === 'connected', null, { timeout: 20000 })
    assert.equal(await host.evaluate(() => [...core.peer.mediaCalls.values()][0] === core.previousCall), true)
    await host.evaluate(() => core.media.stopScreenShare())
    await guest.waitForFunction(() => Object.values(core.game.getState().remotePlayers).every(player => !player.isScreenSharing) && Object.keys(core.store.getState().peerVoiceStreams).length === 0, null, { timeout: 15000 })
    await guest.waitForFunction(() => core.receivedVideo.videoWidth === 320 && core.receivedVideo.videoHeight === 240 && core.receivedAudio.screen() > 0.005, null, { timeout: 15000 })
    t.diagnostic('Signaling recovery preserved the main call, and stopping restored the camera/microphone.')
    await host.evaluate(() => { core.previousCall = [...core.peer.mediaCalls.values()][0]; core.previousCall.close() })
    await host.waitForFunction(() => core.peer.mediaCalls.size === 1 && [...core.peer.mediaCalls.values()][0] !== core.previousCall && Object.values(core.game.getState().callStates).includes('connected'), null, { timeout: connectionTimeout })
    await connected(guest)
    await guest.evaluate(() => core.peer.disconnect())
    await host.waitForFunction(() => Object.keys(core.game.getState().remotePlayers).length === 0 && core.peer.mediaCalls.size === 0, null, { timeout: 15000 })
    t.diagnostic('A closed media call recovered and an intentional exit removed the remote user.')
  } catch (error) {
    console.error(error.stack)
    for (const page of pages) {
      console.error(await page.evaluate(() => ({ status: core.game.getState().connectionStatus, peer: { open: core.peer.peer?.open, disconnected: core.peer.peer?.disconnected }, calls: core.game.getState().callStates, transports: [...core.peer.mediaCalls.values()].map(call => ({ id: call.connectionId, ice: call.peerConnection?.iceConnectionState, connection: call.peerConnection?.connectionState, signaling: call.peerConnection?.signalingState })), audioContexts: core.resources.map(resource => resource.audio.state), voice: Object.keys(core.store.getState().peerVoiceStreams), sharing: core.store.getState().isScreenSharing, players: Object.values(core.game.getState().remotePlayers).map(player => ({ id: player.id, sharing: player.isScreenSharing })) })).catch(String))
    }
    console.error(logs.join('\n'))
    throw error
  } finally {
    await browser?.close()
    await vite.close()
    for (const client of clients) client.getSocket()?.terminate()
    if (signalingServer) await new Promise(resolve => signalingServer.close(resolve))
  }
})
