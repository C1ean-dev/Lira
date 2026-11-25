import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer as createSocketServer } from 'node:net'
import { mkdir } from 'node:fs/promises'

test('the real whiteboard editor opens and draws without the loading error', {
  skip: process.env.LIRA_RUN_WHITEBOARD_TESTS !== '1', timeout: 120000,
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
    cacheDir: 'node_modules/.cache/whiteboard-editor-browser-vite',
    server: { host: '127.0.0.1', port, open: false, hmr: false, fs: { strict: false } },
    logLevel: 'error',
    plugins: [{ name: 'whiteboard-editor-test', configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url !== '/__whiteboard-editor-test.html') return next()
        try {
          const html = await server.transformIndexHtml(request.url,
            '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/whiteboard-editor-browser.tsx"></script></body></html>')
          response.setHeader('Content-Type', 'text/html')
          response.end(html)
        } catch (error) { next(error) }
      })
    } }],
  })
  let browser
  const errors = []
  const remoteOrigins = []
  try {
    await vite.listen()
    browser = await chromium.launch({ headless: true, executablePath: process.env.LIRA_CHROMIUM_EXECUTABLE || undefined, args: ['--mute-audio'] })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.hostname === '127.0.0.1') return route.continue()
      remoteOrigins.push(url.origin)
      return route.abort()
    })
    page.on('pageerror', error => errors.push(error.stack || error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__whiteboard-editor-test.html`)
    await page.waitForFunction(() => document.querySelector('.excalidraw canvas') || document.querySelector('[role="alert"]'), undefined, { timeout: 60000 })
    assert.equal(await page.getByText('Não foi possível carregar o editor.', { exact: false }).count(), 0, errors.join('\n'))
    assert.ok(await page.locator('.excalidraw canvas').count(), errors.join('\n'))
    await page.getByTestId('toolbar-rectangle').locator('..').click()
    const canvas = await page.locator('canvas.interactive').boundingBox()
    assert.ok(canvas)
    await page.mouse.move(canvas.x + canvas.width * .4, canvas.y + canvas.height * .4)
    await page.mouse.down()
    await page.mouse.move(canvas.x + canvas.width * .6, canvas.y + canvas.height * .6, { steps: 8 })
    await page.mouse.up()
    const rectangleSaved = () => Object.values(window.whiteboardTest.board.getState().document.operations)
      .some(operation => operation.kind === 'element' && operation.element.type === 'rectangle' && operation.element.width > 0)
    await page.waitForFunction(rectangleSaved, undefined, { timeout: 5000 })
    await page.evaluate(() => window.whiteboardTest.board.getState().flushWrites())
    await page.reload()
    await page.waitForFunction(rectangleSaved)
    await page.locator('canvas.interactive').waitFor()
    await mkdir('.scratch', { recursive: true })
    await page.screenshot({ path: '.scratch/whiteboard-editor-fixed.png' })
    await page.getByRole('button', { name: 'Limpar quadro', exact: true }).click()
    await page.getByRole('alertdialog', { name: 'Limpar quadro compartilhado' }).waitFor()
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
    assert.deepEqual(errors, [])
    assert.deepEqual(remoteOrigins, [], 'The editor and its fonts must work without external services')
  } finally {
    await browser?.close()
    await vite.close()
  }
})
