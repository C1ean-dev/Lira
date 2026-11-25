import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'

test('navigation rail fits the viewport, uses icon-only controls, and stays above overlays and DJ', {
  skip: process.env.LIRA_RUN_NAVIGATION_TESTS !== '1', timeout: 180000,
}, async t => {
  const started = performance.now()
  const { build } = await import('esbuild')
  const { buildTestPanelCss } = await import('./build-test-panel-css.mjs')
  const { chromium } = await import('playwright')
  const root = process.cwd()
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-navigation-'))
  const mocks = {
    PeerManager: `const peerManager = { broadcast(){}, getPeerId: () => "local", scheduleSignalingReconnect(){}, sendMessageStatus(){},
      getLanInvites: async () => [], cancelDirectInvite(){}, expirePendingDirectInvites: () => 1,
      createDirectInvite: async () => 'LIRA-DIRECT:offer',
      createAllInvite: async () => 'LIRA-ALL:eyJ2ZXJzaW9uIjoxLCJyb29tIjoiUk9PTSIsInNpZ25hbGluZyI6InJlbmRlciJ9', acceptDirectAnswer: async () => {}, disconnect(){},
      reconnect(){}, retryZoneCall(){},
      async prepareDirectJoin(code) {
        window.directAnswerCodes.push(code);
        return { answer: 'LIRA-DIRECT:answer', connected: new Promise(() => {}) };
      } };
      export const PeerManager = { getInstance: () => peerManager };
      export const createPeerInstance = () => ({ on(){return this}, destroy(){} });
      export const SIGNALING_TIERS = ['render','public','local']; export const RENDER_SIGNALING_HOST = 'local.test';
      export const getActiveSignalingTier = () => 'render'; export const getPreferredSignalingTier = () => 'render';
      export const setActiveSignalingTier = () => {}; export const markSignalingTierFailed = () => {}; export const shouldPreferLocalSignaling = () => false;`,
    MediaManager: 'export const MediaManager = { getInstance: () => ({ stopScreenShare(){}, setCameraOff(){}, setMuted(){} }) }',
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
          response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Navigation layout test</title><link rel="icon" href="/icon.png"><link rel="stylesheet" href="/navigation.css"></head><body><div id="root" class="h-screen w-screen overflow-hidden"></div><script type="module" src="/navigation.js"></script></body></html>')
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
    browser = await chromium.launch({ headless: true, executablePath: process.env.LIRA_CHROMIUM_EXECUTABLE || undefined, args: ['--mute-audio'] })
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(5000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 1000)) })
    await page.goto(`http://127.0.0.1:${server.address().port}/__navigation-test.html`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('aside[aria-label="Barra de navegação lateral"]', { timeout: 20000 })
    t.diagnostic(`Navigation preparation: ${preparedMs} ms; browser ready: ${Math.round(performance.now() - started)} ms`)
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' })
    const reset = options => page.evaluate(options => window.navigationTesting.configure(options), options)
    const screenshots = process.env.LIRA_NAVIGATION_SCREENSHOTS || path.join(os.tmpdir(), 'lira-navigation-layout')
    await fs.mkdir(screenshots, { recursive: true })
    const rail = () => page.locator('aside[aria-label="Barra de navegação lateral"]')
    const openRoomMenu = async () => {
      await page.getByRole('button', { name: 'Sala e convites', exact: true }).click()
      return page.getByRole('region', { name: 'Sala e convites', exact: true })
    }

    await t.test('reporting an error opens the existing form directly from the side rail', async () => {
      for (const width of [375, 1366, 1920]) {
        await page.setViewportSize({ width, height: 768 })
        await reset({})
        const trigger = page.getByRole('button', { name: 'Reportar erro', exact: true })
        await trigger.click()
        const dialog = page.getByRole('dialog', { name: 'Reportar problema' })
        await dialog.getByRole('textbox', { name: 'Título do problema' }).waitFor()
        assert.equal(await page.getByRole('region', { name: 'Sala e convites' }).count(), 0)
        await dialog.getByRole('button', { name: 'Cancelar' }).click()
        await dialog.waitFor({ state: 'detached' })
        assert.ok(await trigger.evaluate(button => document.activeElement === button))
      }
    })

    await t.test('the direct connection dialog stays inside the viewport and above the map', async () => {
      for (const viewport of [{ width: 1920, height: 580 }, { width: 375, height: 320 }]) {
        await page.setViewportSize(viewport)
        await reset({})
        await openRoomMenu()
        const trigger = page.getByRole('button', { name: 'Convites individuais', exact: true })
        await trigger.click()
        const dialog = page.getByRole('dialog', { name: 'Convites individuais' })
        const bounds = await dialog.boundingBox()
        assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width &&
          bounds.y + bounds.height <= viewport.height, JSON.stringify({ viewport, bounds }))
        const generate = dialog.getByRole('button', { name: 'Gerar convite direto' })
        await generate.click()
        const copy = dialog.getByRole('button', { name: 'Copiar convite', exact: true })
        await copy.waitFor()
        assert.ok(await copy.evaluate(button => {
          const rect = button.getBoundingClientRect()
          return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
        }), 'the copy button must be reachable as soon as the invitation is generated')
        const response = dialog.getByRole('textbox', { name: 'Resposta do jogador' })
        assert.ok(await copy.evaluate((button, input) => Boolean(button.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING),
          await response.elementHandle()), 'the generated invitation must come before the response field')
        await page.screenshot({ path: path.join(screenshots, `direct-connection-${viewport.width}.png`) })
        await response.fill('LIRA-DIRECT:answer')
        await dialog.getByRole('button', { name: 'Aplicar resposta' }).click()
        await dialog.getByText(/Resposta recebida/).waitFor()
        assert.ok(await dialog.getByRole('button', { name: 'Fechar convites individuais' }).evaluate(button => {
          const rect = button.getBoundingClientRect()
          return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
        }), 'the close button must remain accessible while the body scrolls')
        await dialog.getByRole('button', { name: 'Expirar convites diretos' }).click()
        await dialog.getByText('Convites diretos pendentes expirados.').waitFor()
        assert.equal(await copy.count(), 0)
        assert.equal(await response.inputValue(), '')
        await page.keyboard.press('Escape')
        await page.locator('dialog').waitFor({ state: 'detached' })
        assert.ok(await trigger.evaluate(button => document.activeElement === button), 'focus must return to the opener')
        await trigger.click()
        await page.mouse.click(viewport.width - 2, viewport.height - 2)
        await page.locator('dialog').waitFor({ state: 'detached' })
      }
    })

    await t.test('all visible rail controls fit without horizontal overflow or visible text labels', async () => {
      for (const width of [320, 375, 520, 640, 900, 1024, 1240, 1366, 1536, 1920]) {
        await page.setViewportSize({ width, height: 768 })
        for (const connectionStatus of ['connected', 'reconnecting', 'disconnected']) {
          await reset({ publicRoom: true, connectionStatus })
          const issues = await rail().evaluate(aside => {
            const area = aside.getBoundingClientRect()
            const problems = []
            if (aside.scrollWidth > aside.clientWidth + 1) {
              problems.push(`rail-overflow:${aside.scrollWidth}>${aside.clientWidth}`)
            }
            for (const button of Array.from(aside.querySelectorAll('button'))) {
              if (!button.getClientRects().length) continue
              const rect = button.getBoundingClientRect()
              if (rect.left < area.left - 1 || rect.right > area.right + 1 || rect.top < area.top - 1 || rect.bottom > area.bottom + 1) {
                problems.push(`clipped:${button.getAttribute('aria-label') || button.title}`)
              }
              const clone = button.cloneNode(true)
              clone.querySelectorAll('.sr-only').forEach(node => node.remove())
              const text = (clone.textContent || '').trim()
              if (text !== '' && !/^\d+$/.test(text)) {
                problems.push(`text:${button.getAttribute('aria-label')}=${text}`)
              }
            }
            return problems
          })
          assert.deepEqual(issues, [], `${width}px / ${connectionStatus}: rail controls must be icon-only and fit inside the rail`)
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: no horizontal scrolling`)
        }
      }
    })

    await t.test('the host copies room ID and invite link from the room popover', async () => {
      await page.setViewportSize({ width: 1366, height: 768 })
      await reset({})
      await openRoomMenu()
      assert.equal(await page.getByRole('button', { name: 'Copiar convite completo' }).count(), 0)
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          async writeText(value) { window.copiedRoomId = value },
          async write([item]) { window.copiedRoomInvite = await (await item.getType('text/plain')).text() },
        } })
      })
      await page.getByRole('button', { name: 'Copiar ID do espaço', exact: true }).click()
      await page.waitForFunction(() => window.copiedRoomId === '651CAA21-6733-4B2C-8208-3C2617900000')
      await page.getByRole('button', { name: 'Copiar link do convite', exact: true }).click()
      await page.waitForFunction(() => window.copiedRoomInvite?.startsWith('https://p01--lira--tj9yvq5j5cgs.code.run/join#invite='))
      const copied = new URL(await page.evaluate(() => window.copiedRoomInvite))
      assert.equal(new URLSearchParams(copied.hash.slice(1)).get('invite'), 'LIRA-ALL:eyJ2ZXJzaW9uIjoxLCJyb29tIjoiUk9PTSIsInNpZ25hbGluZyI6InJlbmRlciJ9')
      await page.evaluate(() => { delete navigator.clipboard })
    })

    await t.test('the current room indicator stays centered at top of the 2D map with round marker for long names', async () => {
      await page.setViewportSize({ width: 1536, height: 768 }); await reset({})
      const pill = page.getByRole('status', { name: 'Local atual', exact: true })
      assert.equal(await pill.isVisible(), true)
      const geometry = await pill.evaluate(node => {
        const main = node.closest('main').getBoundingClientRect()
        const rect = node.getBoundingClientRect()
        const dot = node.querySelector('[style*="background-color"]').getBoundingClientRect()
        const mainCenter = main.left + main.width / 2
        const pillCenter = rect.left + rect.width / 2
        return {
          centerDelta: Math.abs(mainCenter - pillCenter),
          topOffset: rect.top - main.top,
          insideMain: rect.left >= main.left - 1 && rect.right <= main.right + 1 && rect.top >= main.top && rect.bottom <= main.bottom,
          dotWidth: dot.width,
          dotHeight: dot.height,
          dotInside: dot.left >= rect.left && dot.right <= rect.right && dot.top >= rect.top && dot.bottom <= rect.bottom,
        }
      })
      assert.ok(geometry.centerDelta <= 2 && geometry.topOffset <= 32 && geometry.insideMain, JSON.stringify(geometry))
      assert.ok(Math.abs(geometry.dotWidth - geometry.dotHeight) < .5 && geometry.dotWidth >= 9 && geometry.dotInside, JSON.stringify(geometry))
    })

    await t.test('room popover has an opaque background, stays above the DJ, and dismisses via Escape or outside click', async () => {
      await page.setViewportSize({ width: 1240, height: 768 }); await reset({ publicRoom: true })
      let menu = await openRoomMenu()
      const background = await menu.evaluate(node => getComputedStyle(node).backgroundColor)
      assert.ok(!background.endsWith(', 0)') && background !== 'transparent', 'popover must paint an opaque background: ' + background)
      const privacyBtn = menu.getByRole('button', { name: /Sala (Pública|Privada)/ })
      assert.ok(await privacyBtn.evaluate(button => {
        const rect = button.getBoundingClientRect()
        return button.contains(document.elementFromPoint(rect.left + rect.width * .9, rect.top + rect.height / 2))
      }), 'DJ must not intercept room popover controls')
      await page.mouse.click(900, 700)
      assert.equal(await menu.count(), 0, 'clicking outside must dismiss the room popover')

      menu = await openRoomMenu()
      assert.equal(await menu.count(), 1)
      await page.keyboard.press('Escape')
      assert.equal(await menu.count(), 0, 'Escape must dismiss the room popover')
      assert.ok(await page.getByRole('button', { name: 'Sala e convites', exact: true }).evaluate(btn => document.activeElement === btn))
    })

    await t.test('rail remains visible over FullScreenGrid and clicking Mapa 2D returns to the 2D map', async () => {
      await page.setViewportSize({ width: 1366, height: 768 })
      await reset({ gridCall: true })
      const railBox = await rail().boundingBox()
      const gridBox = await page.getByRole('region', { name: 'Chamada da sala', exact: true }).boundingBox()
      assert.ok(gridBox.x >= railBox.x + railBox.width - 1, `grid must sit to the right of the rail: ${JSON.stringify({ railBox, gridBox })}`)
      await page.getByRole('button', { name: 'Abrir Chat e Canais', exact: true }).click()
      assert.equal(await page.evaluate(() => window.navigationTesting.chatOpen()), true)
      const mapBtn = page.getByRole('button', { name: 'Mapa 2D', exact: true })
      assert.ok(await mapBtn.evaluate(btn => {
        const rect = btn.getBoundingClientRect()
        return btn.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
      }), 'Mapa 2D must remain clickable while FullScreenGrid is open')
      await mapBtn.click()
      assert.equal(await page.evaluate(() => window.navigationTesting.gridCallOpen()), false)
      assert.equal(await page.evaluate(() => window.navigationTesting.chatOpen()), false)
    })

    await t.test('short windows can scroll inside the rail to reach and trigger Sair', async () => {
      await page.setViewportSize({ width: 375, height: 400 }); await reset({ update: true })
      const before = await page.evaluate(() => window.navigationTesting.events.disconnect)
      const exit = page.getByRole('button', { name: 'Sair / Desconectar deste espaço', exact: true })
      await exit.scrollIntoViewIfNeeded()
      assert.ok(await exit.evaluate(button => {
        const rect = button.getBoundingClientRect()
        return rect.bottom <= innerHeight + 1 && button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
      }))
      await exit.click()
      assert.equal(await page.evaluate(() => window.navigationTesting.events.disconnect), before + 1)
    })

    await t.test('participants panel stays beside the rail and chat opens full-screen beside the rail over the DJ', async () => {
      await page.setViewportSize({ width: 900, height: 768 }); await reset({})
      const railDesktopBox = await rail().boundingBox()
      await page.getByRole('button', { name: 'Participantes Online', exact: true }).click()
      const heading = page.getByRole('heading', { name: /Pessoas no Espaço/ })
      assert.ok(await heading.evaluate((node, minLeft) => {
        const panel = node.closest('.fixed'), rect = panel.getBoundingClientRect()
        return rect.left >= minLeft - 1 && panel.contains(document.elementFromPoint(rect.right - 20, rect.top + 90))
      }, railDesktopBox.x + railDesktopBox.width), 'the participants panel must remain clickable over the DJ and beside the rail')

      await page.setViewportSize({ width: 1366, height: 768 }); await reset({})
      const railFullBox = await rail().boundingBox()
      await page.getByRole('button', { name: 'Abrir Chat e Canais', exact: true }).click()
      const chatDesktop = page.locator('div.fixed').filter({ has: page.getByPlaceholder(/^Mensagem/) }).first()
      assert.ok(await chatDesktop.evaluate((panel, minLeft) => {
        const rect = panel.getBoundingClientRect()
        return rect.left >= minLeft - 1 && rect.right >= innerWidth - 1 && rect.top <= 1 && rect.bottom >= innerHeight - 1 &&
          panel.contains(document.elementFromPoint(rect.right - 20, rect.top + 90))
      }, railFullBox.x + railFullBox.width), 'desktop chat must fill the viewport beside the rail and above the DJ')
      assert.equal(await chatDesktop.getByRole('region', { name: 'Canais', exact: true }).isVisible(), true)
      assert.equal(await chatDesktop.getByRole('region', { name: 'Amigos', exact: true }).isVisible(), true)
      assert.equal(await chatDesktop.getByRole('region', { name: 'No espaço', exact: true }).isVisible(), true)
      assert.equal(await chatDesktop.getByPlaceholder(/^Mensagem/).isVisible(), true)
      await page.screenshot({ path: path.join(screenshots, '1366-chat.png') })

      await page.setViewportSize({ width: 375, height: 768 }); await reset({})
      const railMobileBox = await rail().boundingBox()
      await page.getByRole('button', { name: 'Abrir Chat e Canais', exact: true }).click()
      const chatMobile = page.locator('div.fixed').filter({ has: page.getByPlaceholder(/^Mensagem/) }).first()
      assert.ok(await chatMobile.evaluate((panel, minLeft) => {
        const rect = panel.getBoundingClientRect()
        return rect.left >= minLeft - 1 && rect.right >= innerWidth - 1 && rect.top <= 1 && rect.bottom >= innerHeight - 1 &&
          panel.contains(document.elementFromPoint(rect.right - 20, rect.top + 90))
      }, railMobileBox.x + railMobileBox.width), 'mobile chat must fill the viewport beside the rail and above the DJ')
      await page.screenshot({ path: path.join(screenshots, '375-chat.png') })
    })

    await t.test('the lobby shows creation and entry together and accepts all invitation types in one field', async () => {
      for (const width of [375, 810]) {
        await page.setViewportSize({ width, height: 640 })
        await page.evaluate(() => {
          window.directAnswerCodes = []
          window.navigationTesting.configureLobby()
        })
        const code = page.getByRole('textbox', { name: 'Código da sala' })
        const name = page.getByRole('textbox', { name: 'Nome do espaço' })
        const create = page.getByRole('button', { name: 'Criar espaço' })
        assert.ok(await code.isVisible() && await name.isVisible() && await create.isVisible())
        assert.equal(await page.getByText(/Como conectar|Visibilidade da sala/i).count(), 0)

        await code.fill(' LIRA-LAN:aBcD ')
        await name.fill('Escritório')
        await page.screenshot({ path: path.join(screenshots, `connect-lobby-${width}.png`) })
        await name.press('Enter')
        await code.press('Enter')
        assert.deepEqual(await page.evaluate(() => window.navigationTesting.lobbyActions), ['create:Escritório', 'join:LIRA-LAN:aBcD'])

        await code.fill('LIRA-DIRECT:aBcD')
        const copy = page.getByRole('button', { name: 'Copiar resposta' })
        await copy.waitFor()
        assert.equal(await page.getByRole('button', { name: 'Gerar resposta e conectar' }).count(), 0)
        assert.equal(await page.getByRole('textbox', { name: 'Resposta gerada' }).count(), 0)
        assert.equal(await page.getByRole('textbox', { name: 'Convite do anfitrião' }).count(), 0)
        await page.evaluate(() => {
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
            async writeText(value) { window.copiedDirectAnswer = value },
          } })
        })
        await copy.click()
        assert.equal(await page.evaluate(() => window.copiedDirectAnswer), 'LIRA-DIRECT:answer')
        assert.deepEqual(await page.evaluate(() => window.directAnswerCodes), ['LIRA-DIRECT:aBcD'])
        await page.evaluate(() => { delete navigator.clipboard })
        assert.ok(await name.isVisible())
      }
    })

    for (const width of [320, 375, 520, 640, 900, 1024, 1240, 1366, 1536, 1920]) {
      await page.setViewportSize({ width, height: 768 }); await reset({ publicRoom: true })
      await rail().screenshot({ path: path.join(screenshots, `rail-${width}.png`) })
      await page.screenshot({ path: path.join(screenshots, `${width}.png`) })
      if (width === 375 || width === 1366) {
        await openRoomMenu()
        await page.screenshot({ path: path.join(screenshots, `${width}-room-popover.png`) })
      }
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
