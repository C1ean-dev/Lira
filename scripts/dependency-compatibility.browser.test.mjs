import test from 'node:test'
import assert from 'node:assert/strict'

test('patched Mermaid converts diagrams through the Excalidraw integration', {
  skip: process.env.LIRA_RUN_DEPENDENCY_TESTS !== '1', timeout: 120000,
}, async () => {
  const { createServer } = await import('vite')
  const { chromium } = await import('playwright')
  const vite = await createServer({
    configFile: false,
    server: { port: 0, host: '127.0.0.1', open: false, hmr: false },
    optimizeDeps: { entries: ['scripts/fixtures/mermaid-dependency-browser.mjs'], include: ['@excalidraw/mermaid-to-excalidraw'] },
    logLevel: 'error',
    plugins: [{ name: 'dependency-test-page', configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== '/__dependency-test.html') return next()
        response.setHeader('Content-Type', 'text/html')
        response.end('<!doctype html><html><body></body></html>')
      })
    } }],
  })
  let browser
  try {
    await vite.listen()
    browser = await chromium.launch({ headless: true, executablePath: process.env.LIRA_CHROMIUM_EXECUTABLE || undefined })
    const page = await browser.newPage()
    await page.route('**/*', route => {
      if (new URL(route.request().url()).hostname === '127.0.0.1') return route.continue()
      return route.abort()
    })
    await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/__dependency-test.html`)
    const diagrams = [
      'flowchart LR\n User[User] --> Lira[Lira]',
      'sequenceDiagram\n User->>Lira: Hello',
      'classDiagram\n User --> Lira',
    ]
    for (const definition of diagrams) {
      const result = await page.evaluate(async definition => {
        const { parseMermaidToExcalidraw } = await import('/scripts/fixtures/mermaid-dependency-browser.mjs')
        const result = await parseMermaidToExcalidraw(definition)
        return { types: result.elements.map(element => element.type), serialized: JSON.stringify(result) }
      }, definition)
      assert.ok(result.types.length >= 3, `${definition}: ${result.types.join(', ')}`)
      assert.ok(!result.types.includes('image'), 'Diagram must remain editable instead of falling back to an SVG image')
      assert.match(result.serialized, /User/)
      assert.match(result.serialized, /Lira/)
    }
  } finally {
    await browser?.close()
    await vite.close()
  }
})
