import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { localSystem } from './e2e/local-system.mjs'

test('dois usuários percorrem o Lira pela interface com mídia P2P real', {
  skip: process.env.LIRA_RUN_SYSTEM_E2E !== '1', timeout: 600000,
}, async t => {
  const system = await localSystem()
  const [ana, bruno] = system.users.map(user => user.page)
  const nativeSpacesBefore = await readFile('src/data/nativeSpaces.json')
  const { version: packageVersion } = JSON.parse(await readFile('package.json', 'utf8'))
  const buildVersion = process.env.VITE_APP_VERSION || process.env.LIRA_VERSION_NAME || packageVersion
  const steps = []
  const engines = []
  const call = page => page.getByRole('region', { name: 'Chamada da sala', exact: true })
  let failed = true
  async function step(name, run) {
    const started = performance.now()
    let failure
    await t.test(name, async () => {
      try { await run() } catch (error) { failure = error; throw error }
    })
    steps.push({ name, passed: !failure, durationMs: Math.round(performance.now() - started), error: failure?.message })
    if (failure) throw failure
  }
  try {
    await step('duas instâncias Electron reais carregam o preload e usam perfis separados', async () => {
      for (const page of [ana, bruno]) {
        assert.equal(await page.evaluate(() => window.electronAPI?.isElectron), true)
        const settings = await page.evaluate(() => window.electronAPI.getAppSettings())
        assert.equal(typeof settings.closeToTray, 'boolean')
      }
      const [first, second] = system.users.map(user => user.native)
      assert.notEqual(first.pid, second.pid)
      assert.notEqual(first.userData, second.userData)
      assert.notEqual(first.cwd, second.cwd)
      assert.ok(first.electron && second.electron)
      assert.deepEqual([first.instance, second.instance], ['--instance=1', '--instance=2'])
      for (const instance of [first, second]) assert.equal(instance.visible, process.env.LIRA_E2E_HEADED === '1')
    })
    await step('criar espaço publica a sala para o outro usuário', async () => {
      await ana.getByLabel('Nome do espaço', { exact: true }).fill('Escritório E2E')
      await ana.getByRole('button', { name: 'Criar espaço', exact: true }).click()
      await ana.getByRole('button', { name: 'Mapa 2D', exact: true }).waitFor({ timeout: 60000 })
      await bruno.getByRole('button', { name: /Salas Disponíveis/ }).click()
      await bruno.getByText('Escritório E2E', { exact: true }).waitFor()
      assert.ok(system.rooms.size > 0, 'a publicação atravessa o relay entre perfis isolados')
    })
    await step('privacidade retira e republica a sala na lista do segundo usuário', async () => {
      await ana.getByRole('button', { name: 'Sala e convites', exact: true }).click()
      await ana.getByTitle(/Esta sala está Pública/).click()
      await bruno.getByText('Escritório E2E', { exact: true }).waitFor({ state: 'hidden' })
      assert.equal(system.rooms.size, 0)
      await ana.getByTitle(/Esta sala está Privada/).click()
      await bruno.getByText('Escritório E2E', { exact: true }).waitFor()
    })
    await step('convite é colado na barra Código da sala, sem navegar pelo link', async () => {
      await ana.getByRole('button', { name: 'Copiar link do convite' }).click()
      await ana.getByRole('button', { name: 'Link do convite copiado' }).waitFor()
      const link = await ana.evaluate(() => navigator.clipboard.readText())
      assert.match(link, /join/)
      await bruno.getByRole('button', { name: 'Conectar', exact: true }).click()
      await bruno.getByLabel('Código da sala', { exact: true }).fill(link)
      await bruno.getByRole('button', { name: 'Entrar na sala', exact: true }).click()
      await bruno.getByRole('button', { name: 'Mapa 2D', exact: true }).waitFor({ timeout: 60000 })
      await Promise.all([ana, bruno].map(page => page.waitForFunction(() => window.liraE2E.snapshot().peers.length === 1)))
      assert.equal(await ana.evaluate(() => window.liraE2E.snapshot().roomId), await bruno.evaluate(() => window.liraE2E.snapshot().roomId))
      for (const page of [ana, bruno]) {
        const versions = await page.evaluate(() => {
          const { local, peers } = window.liraE2E.snapshot()
          return [local.appVersion, peers[0].appVersion]
        })
        assert.deepEqual(versions, [buildVersion, buildVersion])
      }
    })
    await step('chat entrega mensagens nos dois sentidos e sincroniza novo canal', async () => {
      for (const page of [ana, bruno]) await page.getByRole('button', { name: 'Abrir Chat e Canais', exact: true }).click()
      await ana.getByPlaceholder('Mensagem em #general...').fill('Olá Bruno, teste de entrega E2E.')
      await ana.getByPlaceholder('Mensagem em #general...').press('Enter')
      await bruno.getByText('Olá Bruno, teste de entrega E2E.', { exact: true }).waitFor()
      await bruno.getByPlaceholder('Mensagem em #general...').fill('Recebido Ana, resposta E2E.')
      await bruno.getByPlaceholder('Mensagem em #general...').press('Enter')
      await ana.getByText('Recebido Ana, resposta E2E.', { exact: true }).waitFor()
      await ana.getByTitle('Novo canal', { exact: true }).click()
      await ana.getByRole('textbox', { name: 'Nome do novo canal' }).fill('projeto-e2e')
      await ana.getByRole('textbox', { name: 'Nome do novo canal' }).press('Enter')
      for (const page of [ana, bruno]) await page.getByRole('region', { name: 'Canais', exact: true }).getByRole('button', { name: 'projeto-e2e', exact: true }).click()
      await ana.getByPlaceholder('Mensagem em #projeto-e2e...').fill('Decisão no canal E2E.')
      await ana.getByPlaceholder('Mensagem em #projeto-e2e...').press('Enter')
      await bruno.getByText('Decisão no canal E2E.', { exact: true }).waitFor()
      const chooser = ana.waitForEvent('filechooser')
      await ana.getByTitle('Anexar arquivo ou imagem (até 15MB)', { exact: true }).click()
      await (await chooser).setFiles({ name: 'roteiro-e2e.txt', mimeType: 'text/plain', buffer: Buffer.from('Arquivo recebido pelo segundo usuário.') })
      await ana.getByText('roteiro-e2e.txt', { exact: true }).waitFor()
      await ana.getByTitle('Enviar', { exact: true }).click()
      await bruno.getByText('roteiro-e2e.txt', { exact: true }).waitFor()
      const { desktop, native } = system.users[1]
      const savePath = path.join(native.cwd, 'roteiro-recebido.txt')
      const download = await desktop.evaluateHandle(({ BrowserWindow }, savePath) => {
        const session = BrowserWindow.getAllWindows()[0].webContents.session
        const result = new Promise(resolve => {
          const timer = setTimeout(() => resolve({ state: 'timeout' }), 15000)
          session.once('will-download', (_event, item) => {
            const filename = item.getFilename()
            item.setSavePath(savePath)
            item.once('done', (_event, state) => {
              clearTimeout(timer)
              resolve({ filename, state })
            })
          })
        })
        return { result }
      }, savePath)
      try {
        await bruno.getByTitle('Baixar arquivo', { exact: true }).click()
        assert.deepEqual(await download.evaluate(handle => handle.result), { filename: 'roteiro-e2e.txt', state: 'completed' })
        assert.equal(await readFile(savePath, 'utf8'), 'Arquivo recebido pelo segundo usuário.')
      } finally {
        await download.dispose()
      }
      for (const page of [ana, bruno]) await page.getByTitle('Fechar chat', { exact: true }).click()
    })
    await step('amizade exige a aceitação do destinatário e abre mensagem privada', async () => {
      await ana.getByRole('button', { name: 'Participantes Online', exact: true }).click()
      await ana.getByTitle('Ações e Permissões do Usuário', { exact: true }).click()
      await ana.getByRole('button', { name: 'Adicionar aos Amigos', exact: true }).click()
      await ana.getByRole('heading', { name: /Pessoas no Espaço/ }).locator('../../..').getByRole('button').click()
      // A solicitação abre a conversa do remetente; o destinatário deve abri-la.
      await bruno.getByRole('button', { name: 'Abrir Chat e Canais', exact: true }).click()
      await bruno.getByRole('region', { name: 'No espaço', exact: true }).getByRole('button', { name: /Ana E2E/ }).click()
      await bruno.getByTitle('Aceitar amizade', { exact: true }).click()
      await ana.getByText('Amizade Confirmada', { exact: true }).waitFor()
      await bruno.getByText('Amizade Confirmada', { exact: true }).waitFor()
      await bruno.getByPlaceholder('Mensagem para @Ana E2E...').fill('Mensagem privada E2E.')
      await bruno.getByPlaceholder('Mensagem para @Ana E2E...').press('Enter')
      await ana.getByText('Mensagem privada E2E.', { exact: true }).waitFor()
      for (const page of [ana, bruno]) await page.getByTitle('Fechar chat', { exact: true }).click()
    })
    await step('quadro permite desenhar, sincroniza e preserva ao reabrir', async () => {
      for (const page of [ana, bruno]) {
        await page.getByRole('button', { name: 'Abrir quadro branco' }).click()
        await page.locator('canvas.interactive').waitFor({ timeout: 60000 })
      }
      await ana.getByTestId('toolbar-text').locator('..').click()
      const canvas = await ana.locator('canvas.interactive').boundingBox()
      await ana.mouse.click(canvas.x + canvas.width * .4, canvas.y + canvas.height * .4)
      await ana.keyboard.insertText('Plano compartilhado E2E')
      await ana.keyboard.press('Escape')
      for (const page of [ana, bruno]) await page.waitForFunction(() => window.liraE2E.snapshot().board.some(element => element.text === 'Plano compartilhado E2E'))
      await bruno.getByRole('button', { name: 'Fechar quadro branco' }).click()
      await bruno.getByRole('button', { name: 'Abrir quadro branco' }).click()
      await bruno.waitForFunction(() => window.liraE2E.snapshot().board.some(element => element.text === 'Plano compartilhado E2E'))
      for (const page of [ana, bruno]) await page.getByRole('button', { name: 'Fechar quadro branco' }).click()
    })
    await step('criar uma sala pelo editor sincroniza a zona e os dois entram pelo mapa 2D', async () => {
      await ana.getByRole('button', { name: 'Editar Espaço', exact: true }).click()
      await ana.getByRole('button', { name: 'Zonas & Paredes', exact: true }).click()
      await ana.getByPlaceholder('Ex: Sala de Reunião / Forja Medieval').fill('Sala E2E')
      await ana.getByRole('checkbox', { name: /Construir Paredes nesta Zona/ }).uncheck()
      const canvas = await ana.locator('main canvas').first().boundingBox()
      assert.ok(canvas)
      await ana.mouse.move(canvas.x + canvas.width * .3, canvas.y + canvas.height * .3)
      await ana.mouse.down()
      await ana.mouse.move(canvas.x + canvas.width * .55, canvas.y + canvas.height * .6, { steps: 12 })
      await ana.mouse.up()
      for (const page of [ana, bruno]) await page.waitForFunction(() => window.liraE2E.snapshot().zones.some(zone => zone.name === 'Sala E2E'))
      await ana.getByTitle('Fechar editor', { exact: true }).click()
      for (const page of [ana, bruno]) {
        await page.getByTitle('Alternar entre Modo Imersivo e Simplificado', { exact: true }).click()
        await page.getByRole('button', { name: /Simplificado Leve/ }).click()
        await page.getByTitle('Sala E2E - Clique para entrar', { exact: true }).click()
      }
      await Promise.all([ana, bruno].map(page => page.waitForFunction(() => {
        const snapshot = window.liraE2E.snapshot()
        return snapshot.local.currentZoneId && snapshot.peers.every(peer => peer.currentZoneId === snapshot.local.currentZoneId)
      })))
    })
    await step('áudio e câmera chegam aos dois usuários; mutar e desmutar altera o som recebido', async () => {
      for (const page of [ana, bruno]) {
        await page.getByTitle('Expandir Chamada (Modo Grade)', { exact: true }).click()
        await call(page).getByTitle(/Supressor de Ruído Ativo|Aguardando microfone|Carregando RNNoise/).click()
        await call(page).getByRole('button', { name: 'Supressor desligado', exact: true }).click()
        await page.getByTitle('Desmutar Microfone (M)', { exact: true }).click()
        await page.getByTitle('Ligar Câmera (V)', { exact: true }).click()
      }
      for (const page of [ana, bruno]) {
        await page.waitForFunction(async () => {
          const rows = await window.liraE2E.rtp()
          return ['audio', 'video'].every(kind => rows.some(row => row.type === 'inbound-rtp' && row.kind === kind && row.bytesReceived > 0))
        }, null, { timeout: 60000 })
        await page.waitForFunction(() => window.liraE2E.playback().some(video => video.width > 0 && video.frames > 5), null, { timeout: 60000 })
        await page.waitForFunction(async () => (await window.liraE2E.audio()).some(row => row.rms > .005), null, { timeout: 60000 })
      }
      await ana.getByTitle('Mutar Microfone (M)', { exact: true }).click()
      await bruno.waitForFunction(async () => (await window.liraE2E.audio()).every(row => row.rms < .001))
      await bruno.waitForFunction(() => window.liraE2E.snapshot().peers[0].isMuted)
      await ana.getByTitle('Desmutar Microfone (M)', { exact: true }).click()
      await bruno.waitForFunction(async () => (await window.liraE2E.audio()).some(row => row.rms > .005))
      await ana.getByTitle('Desligar Câmera (V)', { exact: true }).click()
      await bruno.waitForFunction(() => window.liraE2E.snapshot().peers[0].isCameraOff)
      await ana.getByTitle('Ligar Câmera (V)', { exact: true }).click()
      await bruno.waitForFunction(() => !window.liraE2E.snapshot().peers[0].isCameraOff)
    })
    await step('ensurdecer silencia a saída local e restaura a audição ao desativar', async () => {
      await bruno.waitForFunction(async () => (await window.liraE2E.outputAudio()).some(row => !row.muted && !row.paused && row.rms > .005))
      await bruno.getByTitle('Mutar o Som para Mim (Ensurdecer)', { exact: true }).click()
      await bruno.waitForFunction(async () => {
        const rows = await window.liraE2E.outputAudio()
        return rows.length > 0 && rows.every(row => row.muted && row.rms < .001)
      })
      await ana.waitForFunction(() => window.liraE2E.snapshot().peers[0].isDeafened)
      await bruno.getByTitle('Som Desativado para Você (Clique para ouvir a chamada)', { exact: true }).click()
      await bruno.waitForFunction(async () => (await window.liraE2E.outputAudio()).some(row => !row.muted && row.rms > .005))
    })
    await step('live entrega vídeo e áudio, preserva a voz separada e encerra para o destinatário', async () => {
      await ana.getByTitle('Compartilhar Tela / Janela', { exact: true }).click()
      await ana.getByRole('button', { name: 'Iniciar Apresentação', exact: true }).click()
      await bruno.getByRole('button', { name: /Assistir/ }).first().click()
      await bruno.waitForFunction(() => window.liraE2E.playback().some(video => video.alm && video.width === 640 && video.height === 360 && video.frames > 5), null, { timeout: 60000 })
      const theater = system.users[1].native.visible ? bruno.getByRole('dialog', { name: 'Transmissão em tela cheia' }) : null
      if (theater) {
        await call(bruno).getByRole('button', { name: 'Tela Cheia', exact: true }).click()
        await theater.hover()
      }
      const liveView = theater ?? call(bruno)
      await liveView.getByRole('button', { name: 'Informações da transmissão' }).first().click()
      const panel = liveView.getByRole('region', { name: 'Estatísticas da transmissão' })
      await panel.getByText('640 × 360', { exact: true }).waitFor()
      await panel.getByText(/^[1-9]\d*(?:\.\d+)? (?:kbps|Mbps)$/).waitFor()
      await panel.getByRole('button', { name: 'Fechar estatísticas' }).click()
      if (theater) {
        await bruno.keyboard.press('Escape')
        await theater.waitFor({ state: 'hidden' })
      }
      await bruno.waitForFunction(async () => {
        const rows = await window.liraE2E.audio()
        return ['live', 'voice'].every(source => rows.some(row => row.source === source && row.rms > .005))
      }, null, { timeout: 30000 })
      await ana.getByTitle('Mutar Microfone (M)', { exact: true }).click()
      await bruno.waitForFunction(async () => {
        const rows = await window.liraE2E.audio()
        return rows.some(row => row.source === 'voice' && row.rms < .001) && rows.some(row => row.source === 'live' && row.rms > .005)
      })
      await ana.getByTitle('Desmutar Microfone (M)', { exact: true }).click()
      await bruno.waitForFunction(async () => (await window.liraE2E.audio()).some(row => row.source === 'voice' && row.rms > .005))
      await call(ana).getByTitle('Opções da Transmissão (Ao Vivo)', { exact: true }).click()
      await call(ana).getByRole('button', { name: 'Encerrar transmissão', exact: true }).click()
      await bruno.waitForFunction(() => !window.liraE2E.snapshot().peers[0].isScreenSharing)
      await bruno.waitForFunction(() => window.liraE2E.playback().some(video => video.width > 0 && video.height !== 360 && video.frames > 5))
    })
    await step('uma falha de decodificação H.264 refaz a chamada da live com VP8', async () => {
      await bruno.evaluate(() => window.liraE2E.useRtpOnly(true))
      try {
        await ana.getByTitle('Compartilhar Tela / Janela', { exact: true }).click()
        await ana.getByRole('button', { name: 'Iniciar Apresentação', exact: true }).click()
        await bruno.getByRole('button', { name: /Assistir/ }).first().click()
        await bruno.waitForFunction(() => window.liraE2E.playback().some(video => !video.alm && video.width === 640 && video.frames > 5))
        const replaced = await bruno.evaluate(() => window.liraE2E.simulateRtpDecoderFailure())
        await bruno.waitForFunction(async oldId => (await window.liraE2E.rtp()).some(row =>
          row.type === 'inbound-rtp' && row.kind === 'video' && row.connectionId !== oldId && row.codec === 'video/VP8' &&
          row.frameWidth === 640 && row.framesDecoded > 5), replaced, { timeout: 60000 })
        await call(ana).getByTitle('Opções da Transmissão (Ao Vivo)', { exact: true }).click()
        await call(ana).getByRole('button', { name: 'Encerrar transmissão', exact: true }).click()
        await bruno.waitForFunction(() => !window.liraE2E.snapshot().peers[0].isScreenSharing)
      } finally {
        await bruno.evaluate(() => window.liraE2E.useRtpOnly(false))
      }
    })

    await step('trocar os motores mantém áudio e identifica qualquer fallback', async () => {
      for (const [label, mode, status] of [['DSP Clássico', 'classic', null], ['RNNoise Neural', 'rnnoise', 'rnnoise'], ['DeepFilterNet', 'deepfilter', 'deepfilter']]) {
        await call(ana).getByTitle(/Ativar \/ Configurar Supressor de Ruído|Supressor de Ruído Ativo/).click()
        await call(ana).getByRole('button', { name: new RegExp(`^${label} (IA|Leve)`) }).click()
        await ana.waitForFunction(({ mode, status }) => {
          const media = window.liraE2E.snapshot().media
          return media.noiseEnabled && media.noiseMode === mode && (!status || media[status] === 'ready')
        }, { mode, status }, { timeout: 60000 })
        const before = await bruno.evaluate(async () => (await window.liraE2E.rtp()).filter(row => row.type === 'inbound-rtp' && row.kind === 'audio').reduce((sum, row) => sum + (row.totalSamplesReceived || 0), 0))
        await bruno.waitForFunction(async before => (await window.liraE2E.rtp()).filter(row => row.type === 'inbound-rtp' && row.kind === 'audio').reduce((sum, row) => sum + (row.totalSamplesReceived || 0), 0) > before + 4800, before)
        const media = await ana.evaluate(() => window.liraE2E.snapshot().media)
        const fallback = status && media[status] === 'fallback'
        engines.push({ requested: mode, status: status ? media[status] : 'ready', fallback: !!fallback })
        if (fallback) {
          // Fallback is part of the product contract. Verify its truthful UI and
          // continued audio, and report it separately from the requested engine.
          assert.equal(media.rnnoise, 'ready')
          await call(ana).getByTitle(/fallback/).waitFor()
          t.diagnostic(`${label}: fallback para RNNoise; não contabilizado como motor solicitado ativo.`)
        } else if (status) assert.equal(media[status], 'ready')
      }
      await call(ana).getByTitle(/Supressor de Ruído Ativo|fallback/).click()
      await call(ana).getByRole('button', { name: /^RNNoise Neural IA/ }).click()
      await ana.waitForFunction(() => window.liraE2E.snapshot().media.rnnoise === 'ready')
    })
    await step('configurações da sala e chat da zona são compartilhados', async () => {
      await call(ana).getByTitle('Gerenciar Usuários com Permissão de Entrada', { exact: true }).click()
      await ana.getByRole('button', { name: 'Geral & Identificação', exact: true }).click()
      await ana.getByPlaceholder('Ex: Sala de Reunião Alpha / Diretoria').fill('Sala final E2E')
      await ana.getByPlaceholder('Ex: Bem-vindo à Sala Executiva! Por favor, mantenha o microfone no mudo.').fill('Bem-vindos ao teste E2E.')
      await ana.getByRole('button', { name: 'Salvar Configurações', exact: true }).click()
      await bruno.waitForFunction(() => window.liraE2E.snapshot().zones.some(zone => zone.name === 'Sala final E2E' && zone.welcomeMessage === 'Bem-vindos ao teste E2E.'))
      for (const page of [ana, bruno]) await call(page).getByTitle('Abrir Chat da Sala', { exact: true }).click()
      const input = ana.getByPlaceholder(/^Mensagem em #/)
      await input.fill('Mensagem exclusiva da sala E2E.'); await input.press('Enter')
      await bruno.getByText('Mensagem exclusiva da sala E2E.', { exact: true }).waitFor()
      for (const page of [ana, bruno]) {
        await page.getByTitle('Fechar chat', { exact: true }).click()
        await page.getByRole('button', { name: 'Voltar ao Mapa 2D', exact: true }).click()
      }
      await ana.getByRole('button', { name: 'Abrir transcrições e resumo' }).click()
      await ana.getByRole('dialog', { name: 'Transcrições e resumo', exact: true }).waitFor()
      assert.equal(await ana.getByRole('button', { name: 'Baixar e iniciar transcrição', exact: true }).isEnabled(), true)
      await ana.getByRole('button', { name: 'Fechar transcrições e resumo' }).click()
    })
    async function leave(page) {
      await page.getByRole('button', { name: 'Sair / Desconectar deste espaço', exact: true }).click()
      await page.getByRole('button', { name: 'Sim, Desconectar', exact: true }).click()
      await page.getByLabel('Seu Nickname').waitFor()
    }
    await step('o segundo usuário cria outro espaço e convida a amiga pelo chat', async () => {
      await leave(bruno)
      await ana.waitForFunction(() => window.liraE2E.snapshot().peers.length === 0)
      await bruno.getByLabel('Nome do espaço', { exact: true }).fill('Estúdio Bruno E2E')
      await bruno.getByRole('button', { name: 'Criar espaço', exact: true }).click()
      await bruno.getByRole('button', { name: 'Mapa 2D', exact: true }).waitFor()
      await bruno.getByRole('button', { name: 'Abrir Chat e Canais', exact: true }).click()
      const friend = bruno.getByRole('region', { name: 'Amigos', exact: true }).getByRole('button', { name: /Ana E2E/ })
      await friend.click({ button: 'right' })
      await bruno.getByRole('menuitem', { name: 'Convidar para este espaço', exact: true }).click()
      await ana.getByRole('button', { name: 'Abrir Chat e Canais', exact: true }).click()
      await ana.getByRole('region', { name: 'Amigos', exact: true }).getByRole('button', { name: /Bruno E2E/ }).click()
      await ana.getByRole('button', { name: 'Entrar no espaço', exact: true }).click()
      await ana.getByRole('button', { name: 'Sair e entrar', exact: true }).click()
      await ana.waitForFunction(room => window.liraE2E.snapshot().roomId === room && window.liraE2E.snapshot().peers.length === 1,
        await bruno.evaluate(() => window.liraE2E.snapshot().roomId), { timeout: 60000 })
    })
    await step('espaço salvo permanece após recarregar e o proprietário volta a hospedar', async () => {
      await leave(ana)
      await ana.getByRole('button', { name: /^Salas Salvas/ }).click()
      await ana.getByText('Escritório E2E', { exact: true }).waitFor()
      await ana.reload({ waitUntil: 'domcontentloaded' })
      await ana.getByRole('button', { name: /^Salas Salvas/ }).click()
      await ana.getByText('Escritório E2E', { exact: true }).waitFor()
      await ana.getByTitle('Entrar neste Espaço', { exact: true }).click()
      await ana.getByRole('button', { name: 'Mapa 2D', exact: true }).waitFor({ timeout: 60000 })
      await ana.waitForFunction(() => window.liraE2E.snapshot().zones.some(zone => zone.name === 'Sala final E2E'))
      await leave(bruno)
      await bruno.getByRole('button', { name: /Salas Disponíveis/ }).click()
      await bruno.getByText('Escritório E2E', { exact: true }).waitFor()
      await bruno.getByRole('button', { name: 'Entrar', exact: true, disabled: false }).click()
      await bruno.waitForFunction(() => window.liraE2E.snapshot().peers.length === 1, null, { timeout: 60000 })
      await bruno.getByRole('button', { name: 'Abrir quadro branco' }).click()
      await bruno.waitForFunction(() => window.liraE2E.snapshot().board.some(element => element.text === 'Plano compartilhado E2E'))
      await bruno.getByRole('button', { name: 'Fechar quadro branco' }).click()
    })
    await step('sair encerra as mídias e remove os usuários da sessão', async () => {
      await leave(bruno)
      await ana.waitForFunction(() => window.liraE2E.snapshot().peers.length === 0)
      await leave(ana)
      for (const page of [ana, bruno]) {
        const snapshot = await page.evaluate(() => window.liraE2E.snapshot())
        assert.equal(snapshot.connected, false)
        assert.equal(snapshot.media.sharing, false)
        assert.deepEqual(await page.evaluate(() => window.liraE2E.rtp()), [])
      }
    })
    assert.deepEqual(system.users.flatMap(user => user.errors), [])
    assert.deepEqual(system.users.flatMap(user => user.logs.filter(line => /handler failed for|Invalid network message/.test(line))), [])
    assert.deepEqual(await readFile('src/data/nativeSpaces.json'), nativeSpacesBefore, 'os testes preservam os espaços nativos do usuário')
    failed = false
  } finally {
    await writeFile(`${system.output}/report.json`, JSON.stringify({ passed: !failed, runtime: system.engine,
      instances: system.users.map(user => user.native), syntheticCapture: true, steps, engines }, null, 2))
    t.diagnostic(`Relatório e traces: ${system.output}`)
    await system.close(failed)
  }
})
