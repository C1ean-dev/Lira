import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'

test('navigation fits the viewport and its compact menu stays legible above the DJ', {
  skip: process.env.LIRA_RUN_NAVIGATION_TESTS !== '1', timeout: 180000,
}, async t => {
  const started = performance.now()
  const { build } = await import('esbuild')
  const { buildTestPanelCss } = await import('./build-test-panel-css.mjs')
  const { chromium } = await import('playwright')
  const root = process.cwd()
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-navigation-'))
  const mocks = {
    PeerManager: `export const PeerManager = { getInstance: () => ({ broadcast(){}, getPeerId: () => "local", scheduleSignalingReconnect(){}, sendMessageStatus(){} }) };
      export const createPeerInstance = () => ({ on(){return this}, destroy(){} });
      export const SIGNALING_TIERS = ['render','public','local']; export const RENDER_SIGNALING_HOST = 'local.test';
      export const getActiveSignalingTier = () => 'render'; export const getPreferredSignalingTier = () => 'render';
      export const setActiveSignalingTier = () => {}; export const markSignalingTierFailed = () => {}; export const shouldPreferLocalSignaling = () => false;`,
    MediaManager: 'export const MediaManager = { getInstance: () => ({}) }',
    useRoomPublication: 'export const useRoomPublication = room => room ? [{host:"primary.test",name:"Servidor principal de publicação"},{host:"secondary.test",name:"Servidor secundário"}] : []',
  }
  let browser
  let server
  const errors = []
  try {
    await Promise.all([
      build({ entryPoints: ['scripts/navigation-responsive-test-harness.tsx'], outfile: path.join(temporary, 'navigation.js'),
        bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
        define: { __APP_VERSION__: '"1.1.160"', 'process.env.NODE_ENV': '"production"',
          'import.meta.env': '{"DEV":false,"PROD":true,"BASE_URL":"/","MODE":"test"}' },
        plugins: [{ name: 'navigation-test-boundaries', setup(builder) {
          builder.onResolve({ filter: /.*/ }, ({ path: source }) => {
            const name = source.split('/').at(-1)
            if (name in mocks) return { path: name, namespace: 'navigation-test' }
            if (source === 'virtual:lira-asset-atlases' || source === 'virtual:lira-individual-library') return { path: 'empty', namespace: 'navigation-test' }
            if (source.endsWith('/index.css')) return { path: 'css', namespace: 'navigation-test' }
          })
          builder.onLoad({ filter: /.*/, namespace: 'navigation-test' }, ({ path: name }) => ({
            contents: name === 'css' ? '' : mocks[name] || 'export default []', loader: 'js',
          }))
        } }],
      }),
      buildTestPanelCss(path.join(temporary, 'navigation.css'), ['./src/**/*.{js,ts,jsx,tsx}', './scripts/navigation-responsive-test-harness.tsx']),
    ])
    const preparedMs = Math.round(performance.now() - started)
    const publicRoot = path.resolve(root, 'public')
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webp': 'image/webp', '.woff2': 'font/woff2' }
    server = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://fixture').pathname)
        if (pathname === '/__navigation-test.html') {
          response.setHeader('Content-Type', 'text/html')
          response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Navigation layout test</title><link rel="stylesheet" href="/navigation.css"></head><body><div id="root" class="h-screen flex flex-col"></div><script type="module" src="/navigation.js"></script></body></html>')
          return
        }
        const generated = pathname === '/navigation.js' || pathname === '/navigation.css'
        const file = generated ? path.join(temporary, pathname.slice(1)) : path.resolve(publicRoot, '.' + pathname)
        if (!generated && !file.startsWith(publicRoot + path.sep)) { response.writeHead(404).end(); return }
        response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream')
        response.end(await fs.readFile(file))
      } catch (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500).end() }
    })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(5000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 1000)) })
    await page.goto(`http://127.0.0.1:${server.address().port}/__navigation-test.html`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('header', { timeout: 20000 })
    t.diagnostic(`Navigation preparation: ${preparedMs} ms; browser ready: ${Math.round(performance.now() - started)} ms`)
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' })
    const reset = options => page.evaluate(options => window.navigationTesting.configure(options), options)
    const openMenu = async () => {
      await page.getByTitle('Mais opções e menus', { exact: true }).click()
      return page.getByText('Local Atual:', { exact: true }).locator('..').locator('..')
    }

    await t.test('all visible header controls fit without wrapping or horizontal overflow', async () => {
      for (const width of [320, 375, 640, 900, 1024, 1240, 1366, 1536, 1920]) {
        await page.setViewportSize({ width, height: 768 })
        for (const connectionStatus of ['connected', 'reconnecting', 'disconnected']) {
          await reset({ publicRoom: true, connectionStatus })
          const clipped = await page.locator('header').evaluate(header => {
            const area = header.getBoundingClientRect()
            return Array.from(header.querySelectorAll('button')).filter(button => button.getClientRects().length).flatMap(button => {
              const rect = button.getBoundingClientRect()
              return rect.left < area.left - 1 || rect.right > area.right + 1 || rect.top < area.top - 1 || rect.bottom > area.bottom + 1
                ? [button.title || button.textContent] : []
            })
          })
          assert.deepEqual(clipped, [], `${width}px / ${connectionStatus}: header controls must stay inside the bar`)
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: no horizontal scrolling`)
        }
      }
    })
    await t.test('the current room indicator stays round and contained with long names', async () => {
      await page.setViewportSize({ width: 1536, height: 768 }); await reset({})
      const marker = page.locator('header [style*="background-color"]').first()
      const size = await marker.evaluate(dot => {
        const a = dot.getBoundingClientRect(), b = dot.parentElement.getBoundingClientRect()
        return { width: a.width, height: a.height, inside: a.left >= b.left && a.right <= b.right && a.top >= b.top && a.bottom <= b.bottom }
      })
      assert.ok(Math.abs(size.width - size.height) < .5 && size.width >= 9 && size.inside, JSON.stringify(size))
    })
    await t.test('compact menu has an opaque background and its controls are above the DJ', async () => {
      await page.setViewportSize({ width: 1240, height: 768 }); await reset({})
      const menu = await openMenu()
      const background = await menu.evaluate(node => getComputedStyle(node).backgroundColor)
      assert.ok(!background.endsWith(', 0)') && background !== 'transparent', 'menu must paint an opaque background: ' + background)
      assert.ok(await menu.getByRole('button', { name: /Verificar atualizações/ }).isVisible(), 'version checks remain available in compact mode')
      const settings = menu.getByRole('button', { name: 'Configurações de Áudio e Chamada', exact: true })
      assert.ok(await settings.evaluate(button => {
        const rect = button.getBoundingClientRect()
        return button.contains(document.elementFromPoint(rect.left + rect.width * .9, rect.top + rect.height / 2))
      }), 'DJ must not intercept menu controls')
      await settings.click()
      assert.equal(await page.evaluate(() => window.navigationTesting.settingsOpen()), true)
      assert.equal(await menu.count(), 0)
    })
    await t.test('compact actions have readable text and active editor icons', async () => {
      await page.setViewportSize({ width: 900, height: 768 }); await reset({ update: true })
      let menu = await openMenu()
      await menu.getByRole('button', { name: 'Editar Mobílias e Salas', exact: true }).click()
      menu = await openMenu()
      const contrast = await menu.getByRole('button', { name: 'Fechar Editor do Espaço', exact: true }).evaluate(button => {
        const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
        const luminance = color => rgb(color).map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((total, c, i) => total + c * [.2126, .7152, .0722][i], 0)
        const ratio = (a, b) => (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
        const background = luminance(getComputedStyle(button).backgroundColor)
        return { text: ratio(luminance(getComputedStyle(button).color), background), icon: ratio(luminance(getComputedStyle(button.querySelector('svg')).color), background) }
      })
      assert.ok(contrast.text >= 4.5 && contrast.icon >= 3, JSON.stringify(contrast))
    })
    await t.test('short windows can scroll to the last action and Escape dismisses the menu', async () => {
      await page.setViewportSize({ width: 375, height: 400 }); await reset({ update: true })
      let menu = await openMenu()
      const exit = menu.getByRole('button', { name: 'Sair / Desconectar do Espaço', exact: true })
      await exit.scrollIntoViewIfNeeded()
      assert.ok(await exit.evaluate(button => button.getBoundingClientRect().bottom <= innerHeight + 1))
      await page.keyboard.press('Escape')
      assert.equal(await menu.count(), 0, 'Escape must close the compact menu')
    })
    await t.test('clicking outside dismisses the menu instead of operating the map below it', async () => {
      await page.setViewportSize({ width: 900, height: 768 }); await reset({})
      const menu = await openMenu()
      await page.mouse.click(16, 720)
      assert.equal(await menu.count(), 0, 'the backdrop must cover the remaining viewport')
    })
    await t.test('resizing to desktop closes the menu and restores the normal navigation layer', async () => {
      await page.setViewportSize({ width: 900, height: 768 }); await reset({})
      await openMenu()
      await page.setViewportSize({ width: 1920, height: 768 })
      await page.waitForFunction(() => !document.getElementById('space-navigation-menu'))
      assert.equal(await page.locator('header').evaluate(node => getComputedStyle(node).zIndex), '30')
    })
    await t.test('the participants panel selected from navigation stays in front of the DJ', async () => {
      await page.setViewportSize({ width: 900, height: 768 }); await reset({})
      await openMenu()
      await page.getByTitle('Participantes Online', { exact: true }).click()
      const heading = page.getByRole('heading', { name: /Pessoas no Espaço/ })
      assert.ok(await heading.evaluate(node => {
        const panel = node.closest('.fixed'), rect = panel.getBoundingClientRect()
        return panel.contains(document.elementFromPoint(rect.right - 20, rect.top + 90))
      }), 'the selected participants panel must remain clickable over the DJ')
    })
    await t.test('mobile chat selected from navigation stays in front of the DJ', async () => {
      await page.setViewportSize({ width: 375, height: 768 }); await reset({})
      await openMenu()
      await page.getByTitle('Abrir Chat', { exact: true }).click()
      const chat = page.locator('div.fixed').filter({ has: page.getByPlaceholder(/^Mensagem/) }).first()
      assert.ok(await chat.evaluate(panel => {
        const rect = panel.getBoundingClientRect()
        return panel.contains(document.elementFromPoint(rect.right - 20, rect.top + 90))
      }), 'the selected chat must remain clickable over the DJ')
    })
    const screenshots = process.env.LIRA_NAVIGATION_SCREENSHOTS || path.join(os.tmpdir(), 'lira-navigation-layout')
    await fs.mkdir(screenshots, { recursive: true })
    for (const width of [375, 1240, 1536]) {
      await page.setViewportSize({ width, height: 768 }); await reset({})
      if (width < 1536) await openMenu()
      await page.screenshot({ path: path.join(screenshots, `${width}.png`) })
    }
    t.diagnostic('Layout screenshots: ' + screenshots)
    assert.deepEqual(errors, [], 'No renderer errors')
  } catch (error) {
    for (const message of errors.slice(0, 8)) t.diagnostic(message)
    throw error
  } finally {
    await browser?.close()
    if (server) await new Promise(resolve => server.close(resolve))
    assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep))
    await fs.rm(temporary, { recursive: true, force: true })
  }
})
