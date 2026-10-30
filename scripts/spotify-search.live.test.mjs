import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

// Requires an already-open DJ Spotify browser and explicit browser authorization.
// Only pages created by this test are closed; the user's player stays open.
test('live Spotify suggestions return page results without replacing the DJ player', {
  skip: process.env.LIRA_RUN_SPOTIFY_SEARCH_LIVE_TESTS !== '1', timeout: 60000,
}, async t => {
  const { build } = await import('esbuild')
  const root = process.cwd()
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-spotify-search-'))
  const bundle = path.join(temp, 'integration.cjs')
  const created = []
  let integration
  let controller
  try {
    await build({ stdin: { contents: `export { SpotifyPlaybackController } from './electron/spotifyPlayback.ts'; export { connectPlayback, playbackJson } from './electron/spotifyPlaybackTransport.ts'`, resolveDir: root },
      outfile: bundle, bundle: true, platform: 'node', format: 'cjs', external: ['bufferutil', 'utf-8-validate'], logLevel: 'silent' })
    integration = createRequire(import.meta.url)(bundle)
    const { SpotifyPlaybackController, connectPlayback, playbackJson } = integration
    const appData = process.env.APPDATA || ''
    const candidates = process.env.LIRA_SPOTIFY_PROFILE ? [process.env.LIRA_SPOTIFY_PROFILE]
      : ['lira', 'lira-inst-2'].map(name => path.join(appData, name, 'spotify-browser'))
    let profile
    for (const candidate of candidates) {
      try {
        const port = Number((await fs.readFile(path.join(candidate, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/)[0])
        if (!Number.isInteger(port) || port < 1 || port > 65535) continue
        const tabs = await playbackJson(`http://127.0.0.1:${port}/json/list`)
        if (Array.isArray(tabs) && tabs.some(tab => tab.type === 'page' && new URL(tab.url).origin === 'https://open.spotify.com')) { profile = candidate; break }
      } catch { /* An instance can have a stale port file after the browser closed. */ }
    }
    assert.ok(profile, 'Abra o Spotify pelo DJ do Lira antes de executar este teste.')
    controller = new SpotifyPlaybackController({ active: () => true,
      readPortFile: () => fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'), json: playbackJson,
      connect: async url => {
        const connection = await connectPlayback(url)
        return { close: () => connection.close(), request: async (method, params, timeout) => {
          let result
          try { result = await connection.request(method, params, timeout) }
          catch (error) { t.diagnostic(`${method}: ${error.protocolMessage || error.message}`); throw error }
          if (method === 'Target.createTarget' && result?.targetId) created.push({ browser: url, id: result.targetId })
          return result
        } }
      },
    })
    const before = await controller.frame()
    assert.equal(before.ok, true, before.error)
    const first = await controller.suggestions('queen', 'live-search-test')
    assert.equal(first.ok, true, first.error)
    assert.ok(first.tracks.length > 0, 'A página não retornou músicas para queen.')
    t.diagnostic(`queen: ${first.tracks.slice(0, 3).map(track => `${track.title} — ${track.artist}`).join(' | ')}`)
    const second = await controller.suggestions('daft punk', 'live-search-test')
    assert.equal(second.ok, true, second.error)
    assert.ok(second.tracks.length > 0, 'A página não retornou músicas para daft punk.')
    assert.notDeepEqual(second.tracks.map(track => track.id), first.tracks.map(track => track.id), 'A segunda consulta retornou os resultados antigos.')
    t.diagnostic(`daft punk: ${second.tracks.slice(0, 3).map(track => `${track.title} — ${track.artist}`).join(' | ')}`)
    const after = await controller.frame()
    assert.equal(after.ok, true, after.error)
    const remaining = (before.frame?.seek?.duration || 0) - (before.frame?.seek?.position || 0)
    if (!before.frame?.playing || remaining > 30) assert.deepEqual(after.frame?.track, before.frame?.track, 'A pesquisa mudou a música do DJ.')
  } finally {
    for (const target of created) {
      let connection
      try { connection = await integration.connectPlayback(target.browser); await connection.request('Target.closeTarget', { targetId: target.id }) }
      catch { t.diagnostic('A aba de teste já foi fechada ou o navegador ficou indisponível durante a limpeza.') }
      finally { connection?.close() }
    }
    controller?.cancelQueuedTracks()
    await fs.unlink(bundle).catch(() => {})
    await fs.rmdir(temp).catch(() => {})
  }
})
