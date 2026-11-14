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
    PeerManager: `const peerManager = { broadcast(){}, getPeerId: () => "local", scheduleSignalingReconnect(){}, sendMessageStatus(){},
      getLanInvites: async () => [], cancelDirectInvite(){}, expirePendingDirectInvites: () => 1,
      createDirectInvite: async () => 'LIRA-DIRECT:offer',
      createAllInvite: async () => 'LIRA-ALL:eyJ2ZXJzaW9uIjoxLCJyb29tIjoiUk9PTSIsInNpZ25hbGluZyI6InJlbmRlciJ9', acceptDirectAnswer: async () => {}, disconnect(){},
      async prepareDirectJoin(code) {
        window.directAnswerCodes.push(code);
        return { answer: 'LIRA-DIRECT:answer', connected: new Promise(() => {}) };
      } };
      export const PeerManager = { getInstance: () => peerManager };
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
          response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Navigation layout test</title><link rel="icon" href="/icon.png"><link rel="stylesheet" href="/navigation.css"></head><body><div id="root" class="h-screen flex flex-col"></div><script type="module" src="/navigation.js"></script></body></html>')
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
    browser = await chromium.launch({ headless: true, executablePath: process.env.LIRA_CHROMIUM_EXECUTABLE || undefined })
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(5000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 1000)) })
    await page.goto(`http://127.0.0.1:${server.address().port}/__navigation-test.html`, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await page.waitForSelector('header', { timeout: 20000 })
    t.diagnostic(`Navigation preparation: ${preparedMs} ms; browser ready: ${Math.round(performance.now() - started)} ms`)
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' })
    const reset = options => page.evaluate(options => window.navigationTesting.configure(options), options)
    const screenshots = process.env.LIRA_NAVIGATION_SCREENSHOTS || path.join(os.tmpdir(), 'lira-navigation-layout')
    await fs.mkdir(screenshots, { recursive: true })
    const openMenu = async () => {
      await page.getByTitle('Mais opções e menus', { exact: true }).click()
      return page.getByText('Local Atual:', { exact: true }).locator('..').locator('..')
    }

    await t.test('the direct connection dialog stays inside the viewport and above the map', async () => {
      for (const viewport of [{ width: 1920, height: 580 }, { width: 375, height: 320 }]) {
        await page.setViewportSize(viewport)
        await reset({})
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
        await page.mouse.click(2, viewport.height - 2)
        await page.locator('dialog').waitFor({ state: 'detached' })
      }
    })

    await t.test('all visible header controls fit without wrapping or horizontal overflow', async () => {
      for (const width of [320, 375, 520, 640, 900, 1024, 1240, 1366, 1536, 1920]) {
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
    await t.test('the host invitation actions stay next to each other with labels where they fit', async () => {
      for (const width of [320, 375, 520, 900, 1536, 1920]) {
        await page.setViewportSize({ width, height: 768 }); await reset({})
        const complete = page.getByRole('button', { name: 'Copiar convite completo', exact: true })
        const individual = page.getByRole('button', { name: 'Convites individuais', exact: true })
        assert.ok(await complete.isVisible() && await individual.isVisible())
        assert.equal(await complete.evaluate(button => button.nextElementSibling?.getAttribute('aria-label')), 'Convites individuais')
        assert.equal(await complete.getByText('Convite completo', { exact: true }).isVisible(), width >= 520)
        assert.equal(await individual.getByText('Convites individuais', { exact: true }).isVisible(), width >= 520)
      }
    })
    await t.test('the host copies a complete invitation from the invitation button', async () => {
      await page.setViewportSize({ width: 1366, height: 768 })
      await reset({})
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          async write([item]) { window.copiedRoomInvite = await (await item.getType('text/plain')).text() },
        } })
      })
      await page.getByRole('button', { name: 'Copiar convite completo' }).click()
      await page.waitForFunction(() => window.copiedRoomInvite === 'LIRA-ALL:eyJ2ZXJzaW9uIjoxLCJyb29tIjoiUk9PTSIsInNpZ25hbGluZyI6InJlbmRlciJ9')
      await page.evaluate(() => { delete navigator.clipboard })
    })
    await t.test('the host copies a link containing the complete invitation', async () => {
      await reset({})
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
          async write([item]) { window.copiedRoomInvite = await (await item.getType('text/plain')).text() },
        } })
      })
      await page.getByRole('button', { name: 'Copiar link do convite', exact: true }).click()
      await page.waitForFunction(() => window.copiedRoomInvite?.startsWith('https://lira-signaling.onrender.com/join#invite='))
      const copied = new URL(await page.evaluate(() => window.copiedRoomInvite))
      assert.equal(new URLSearchParams(copied.hash.slice(1)).get('invite'), 'LIRA-ALL:eyJ2ZXJzaW9uIjoxLCJyb29tIjoiUk9PTSIsInNpZ25hbGluZyI6InJlbmRlciJ9')
      await page.evaluate(() => { delete navigator.clipboard })
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
