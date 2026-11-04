import test from 'node:test'
import assert from 'node:assert/strict'

test('a 16:10 shared screen uses a matching live frame without cropping any edge', {
  skip: process.env.LIRA_RUN_BROWSER_TESTS !== '1', timeout: 90_000,
}, async () => {
  process.env.VITEST = '1'; process.env.LIRA_TARGET = 'web'
  const { createServer } = await import('vite')
  const { chromium } = await import('playwright')
  const server = await createServer({ logLevel: 'error', optimizeDeps: { noDiscovery: true,
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'peerjs', 'lucide-react', 'zustand'] },
    server: { host: '127.0.0.1', port: 0, open: false, hmr: false },
    plugins: [{ name: 'aspect-test', configureServer(vite) { vite.middlewares.use((req, res, next) => {
      if (req.url !== '/__aspect-test') return next()
      res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Live aspect test</title>')
    }) } }],
  })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true, executablePath: process.env.LIRA_CHROMIUM_EXECUTABLE || undefined,
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__aspect-test`)
    await page.evaluate(async () => {
      const refresh = (await import('/@react-refresh')).default
      refresh.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type
      window.__vite_plugin_react_preamble_installed__ = true
      const display = await import('/scripts/live-display-test-harness.tsx')
      const canvas = document.createElement('canvas')
      window.paintAspect = (width, height) => {
        canvas.width = width; canvas.height = height
        const context = canvas.getContext('2d')
        context.fillStyle = '#888888'; context.fillRect(0, 0, width, height)
        for (const [color, x, y] of [['red', 0, 0], ['lime', width - 120, 0], ['blue', 0, height - 120], ['yellow', width - 120, height - 120]]) {
          context.fillStyle = color; context.fillRect(x, y, 120, 120)
        }
      }
      window.paintAspect(1920, 1200)
      window.aspectStream = canvas.captureStream(10)
      window.aspectDisplay = display
      window.aspectUser = { id: 'aspect', name: 'Tela 16:10', stream: window.aspectStream, isLocal: true, isScreenSharing: true }
      display.showLive('presentation', window.aspectUser)
    })
    await page.waitForFunction(() => document.querySelector('video')?.videoWidth === 1920)
    await page.waitForTimeout(250) // Let the existing card transition finish.
    const read = () => page.evaluate(() => {
      const video = document.querySelector('[aria-label="Transmissão em tela cheia"] video') || document.querySelector('video')
      const box = video.getBoundingClientRect(), fit = getComputedStyle(video).objectFit
      const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight)
      const sample = document.createElement('canvas'); sample.width = video.videoWidth; sample.height = video.videoHeight
      const context = sample.getContext('2d'); context.drawImage(video, 0, 0)
      return { source: [video.videoWidth, video.videoHeight], box: [box.width, box.height], fit,
        unusedWidth: box.width - video.videoWidth * scale, unusedHeight: box.height - video.videoHeight * scale,
        transform: getComputedStyle(video).transform,
        corners: [[10, 10], [sample.width - 10, 10], [10, sample.height - 10], [sample.width - 10, sample.height - 10]].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3)) }
    })
    const state = await read()
    console.log('Live 16:10 measurement', JSON.stringify(state))
    await page.screenshot({ path: '.scratch/live-aspect.png' })
    assert.deepEqual(state.source, [1920, 1200])
    const expected = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0]]
    assert(state.corners.every((corner, index) => corner.every((value, channel) => Math.abs(value - expected[index][channel]) <= 3)),
      'all four screen edges remain present after video color conversion')
    assert.equal(state.fit, 'contain', 'the whole screen must remain visible')
    assert(['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(state.transform), 'the live must not apply an automatic crop zoom')
    assert(state.unusedWidth <= 2 && state.unusedHeight <= 2, 'the live frame must follow the shared screen aspect instead of adding black bars')
    await page.evaluate(() => window.aspectDisplay.showLive('full', window.aspectUser))
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1280, height: 800 }, { width: 800, height: 1200 }]) {
      await page.setViewportSize(viewport)
      await page.waitForFunction(() => {
        const video = document.querySelector('[aria-label="Transmissão em tela cheia"] video')
        const rect = video?.getBoundingClientRect()
        return video?.videoWidth === 1920 && Math.abs(rect.width / rect.height - 1.6) < 0.002
      })
      const full = await read()
      assert(full.unusedWidth <= 2 && full.unusedHeight <= 2, 'fullscreen must preserve 16:10 at any viewport size')
      assert(['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(full.transform), 'hiding the capture outline must be opt-in')
    }
    await page.evaluate(() => window.paintAspect(1080, 1920))
    await page.waitForFunction(() => {
      const video = document.querySelector('[aria-label="Transmissão em tela cheia"] video'), rect = video?.getBoundingClientRect()
      return video?.videoWidth === 1080 && Math.abs(rect.width / rect.height - 1080 / 1920) < 0.002
    })
    const portrait = await read()
    assert(portrait.unusedWidth <= 2 && portrait.unusedHeight <= 2, 'the frame must update when the shared screen changes orientation')
    await page.screenshot({ path: '.scratch/live-aspect-full.png' })
    await page.evaluate(() => { window.aspectDisplay.dispose(); window.aspectStream.getTracks().forEach(track => track.stop()) })
  } finally { await browser?.close(); await server.close() }
})
