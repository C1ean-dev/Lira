import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer as createSocketServer } from 'node:net'
import { mkdir } from 'node:fs/promises'

test('transcription starts on the map and survives closing the call view', {
  skip: process.env.LIRA_RUN_SPACE_TRANSCRIPTION_TESTS !== '1', timeout: 120000,
}, async () => {
  process.env.VITEST = '1'
  process.env.LIRA_TARGET = 'web'
  const { createServer } = await import('vite')
  const { chromium } = await import('playwright')
  const port = await new Promise((resolve, reject) => {
    const probe = createSocketServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(error => error ? reject(error) : resolve(port))
    })
  })
  const vite = await createServer({
    cacheDir: 'node_modules/.cache/space-transcription-browser-vite',
    server: { host: '127.0.0.1', port, open: false, hmr: false }, logLevel: 'error',
    plugins: [{ name: 'space-transcription-test', configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url !== '/__space-transcription-test.html') return next()
        try {
          const html = await server.transformIndexHtml(request.url,
            '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"></head><body><div id="root" style="height:100dvh;display:flex;flex-direction:column"></div><script type="module" src="/scripts/fixtures/space-transcription-browser.tsx"></script></body></html>')
          response.setHeader('Content-Type', 'text/html'); response.end(html)
        } catch (error) { next(error) }
      })
    } }],
  })
  let browser
  const errors = [], remoteOrigins = []
  try {
    await vite.listen()
    browser = await chromium.launch({ headless: true, executablePath: process.env.LIRA_CHROMIUM_EXECUTABLE || undefined })
    await mkdir('.scratch/space-transcription', { recursive: true })
    for (const width of [1280, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } })
      page.setDefaultTimeout(10000)
      page.on('pageerror', error => errors.push(error.stack || error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      await page.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.hostname === '127.0.0.1') return route.continue()
        remoteOrigins.push(url.origin); return route.abort()
      })
      await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__space-transcription-test.html`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.getByRole('button', { name: 'Abrir transcrições e resumo' }).click()
      const dialog = page.getByRole('dialog', { name: 'Transcrições e resumo', exact: true })
      await dialog.getByRole('button', { name: /^(Baixar e iniciar transcrição|Iniciar transcrição)$/ }).click()
      await dialog.getByRole('button', { name: 'Parar transcrição' }).waitFor()
      await page.screenshot({ path: `.scratch/space-transcription/active-${width}.png` })
      await dialog.getByText('Decisão registrada no mapa.').waitFor()
      assert.ok(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth), `${width}px: the panel must not overflow horizontally`)
      await dialog.getByRole('button', { name: 'Fechar transcrições e resumo' }).click()
      assert.equal(await page.evaluate(() => window.transcriptionTesting.workers[0].messages.some(message => message.type === 'stop')), false)
      if (width >= 640) {
        await page.evaluate(() => window.transcriptionTesting.setGridOpen(true))
        await page.getByTitle('Transcrição da chamada por participante').click()
        await page.getByRole('complementary', { name: 'Transcrição da chamada' }).getByRole('button', { name: 'Parar transcrição' }).waitFor()
        await page.getByRole('button', { name: 'Voltar ao Mapa 2D' }).click()
      }
      assert.equal(await page.evaluate(() => window.transcriptionTesting.workers.length), 1)
      assert.equal(await page.evaluate(() => window.transcriptionTesting.workers[0].messages.some(message => message.type === 'stop')), false)
      await page.getByRole('button', { name: 'Abrir transcrições e resumo' }).click()
      await dialog.getByRole('button', { name: 'Parar transcrição' }).click()
      await page.waitForFunction(() => Boolean(window.transcriptionTesting.meetings.getState().meetings[0]?.endedAt))
      assert.ok(await dialog.getByRole('button', { name: 'Gerar resumo com IA' }).isEnabled())
      await page.screenshot({ path: `.scratch/space-transcription/stopped-${width}.png` })
      await page.close()
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(remoteOrigins, [], 'The test must not download models or contact external services')
  } catch (error) {
    throw new Error(errors.slice(0, 5).join('\n') || error.message, { cause: error })
  } finally { await browser?.close(); await vite.close() }
})
