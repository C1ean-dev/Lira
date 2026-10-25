import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

// Explicit opt-in: adds exactly one selected track to the DEVELOPMENT Spotify queue.
// Requires authorization and an already-open, logged-in development Spotify browser.
test('Spotify confirms one real queue addition in the hidden development helper', {
  skip: process.env.LIRA_RUN_SPOTIFY_QUEUE_LIVE_TESTS !== '1', timeout: 60000,
}, async t => {
  const { build } = await import('esbuild')
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-queue-live-'))
  const bundle = path.join(temporary, 'integration.cjs')
  let controller
  try {
    await build({ stdin: { contents: `export { SpotifyPlaybackController } from './electron/spotifyPlayback.ts'; export { connectPlayback, playbackJson } from './electron/spotifyPlaybackTransport.ts'`, resolveDir: process.cwd() },
      outfile: bundle, bundle: true, platform: 'node', format: 'cjs', external: ['bufferutil', 'utf-8-validate'], logLevel: 'silent' })
    const { SpotifyPlaybackController, connectPlayback, playbackJson } = createRequire(import.meta.url)(bundle)
    const profile = path.join(process.env.APPDATA || '', 'lira-dev', 'spotify-browser')
    function observe() {
      const events = []
      const collect = node => {
        const elements = node.nodeType === 3 ? [node.parentElement] : [node, ...Array.from(node.querySelectorAll?.('*') || []).slice(0, 200)]
        for (const el of elements) {
          const text = el?.textContent?.trim() || ''
          if (!text || text.length > 220 || !/\b(fila|queue)\b/i.test(text) || el.closest?.('[role="menu"]')) continue
          events.push({ text, matchesCurrentSelector:
            !!el.closest?.('[role="status"], [role="alert"], [data-testid="toast"], [data-testid="toast-message"]') })
          if (events.length > 20) events.shift()
        }
      }
      const observer = new MutationObserver(records => records.forEach(record => {
        if (record.type === 'characterData') collect(record.target)
        record.addedNodes.forEach(collect)
      }))
      observer.observe(document.body, { subtree: true, childList: true, characterData: true })
      window.__liraQueueLiveProbe = { events, observer }
    }
    controller = new SpotifyPlaybackController({ active: () => true, canQueue: () => true,
      readPortFile: () => fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8'), json: playbackJson,
      connect: async url => {
        const connection = await connectPlayback(url)
        return { close: () => connection.close(), request: async (method, params, timeout) => {
          const isQueue = method === 'Runtime.evaluate' && params.expression?.includes('enqueueSpotifyTrackInPage')
          if (isQueue) await connection.request('Runtime.evaluate', { expression: `(${observe.toString()})()`, returnByValue: true, userGesture: false })
          const reply = await connection.request(method, params, timeout)
          if (isQueue) {
            const probe = await connection.request('Runtime.evaluate', { expression: 'window.__liraQueueLiveProbe.observer.disconnect(); window.__liraQueueLiveProbe.events', returnByValue: true, userGesture: false })
            const notices = new Map((probe.result?.value || []).map(event => [JSON.stringify(event), event]))
            for (const event of notices.values()) t.diagnostic(JSON.stringify(event))
          }
          return reply
        } }
      },
    })
    const before = await controller.frame()
    assert.equal(before.ok, true, before.error)
    const results = await controller.suggestions('Verso Lorien Testard', 'queue-live-test')
    assert.equal(results.ok, true, results.error)
    const matches = results.tracks.filter(track => track.title.toLocaleLowerCase() === 'verso' && track.artist.toLocaleLowerCase() === 'lorien testard')
    t.diagnostic(JSON.stringify(matches.map(track => ({ id: track.id, title: track.title, artist: track.artist }))))
    assert.equal(matches.length, 1, 'A pesquisa deve identificar exatamente Verso de Lorien Testard.')
    const selected = { ...matches[0], searchQuery: 'Verso Lorien Testard' }
    const queued = await controller.enqueue(selected, 'queue-live-' + crypto.randomUUID())
    t.diagnostic(JSON.stringify(queued))
    const after = await controller.frame()
    assert.equal(after.ok, true, after.error)
    const remaining = (before.frame?.seek?.duration || 0) - (before.frame?.seek?.position || 0)
    if (!before.frame?.playing || remaining > 30) assert.deepEqual(after.frame?.track, before.frame?.track, 'O teste não deve trocar a faixa em reprodução.')
    assert.equal(queued.ok, true, queued.error)
  } finally {
    controller?.cancelQueuedTracks()
    await fs.unlink(bundle).catch(() => {})
    await fs.rmdir(temporary).catch(() => {})
  }
})
