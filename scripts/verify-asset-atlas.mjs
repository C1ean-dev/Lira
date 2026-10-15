// Browser integration checks against a running web dev server (LIRA_TEST_URL).
// All writes go to an in-memory transport and an isolated browser profile.
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.LIRA_TEST_URL || 'http://127.0.0.1:5174'
const cache = path.resolve('node_modules/.cache')
await mkdir(cache, { recursive: true })
const profile = await mkdtemp(path.join(cache, 'atlas-browser-'))
const pageFile = path.join(cache, 'atlas-check.html')
await writeFile(pageFile, '<!doctype html><html><head><title>Asset checks</title></head><body></body></html>')
const browser = spawn(process.env.LIRA_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=9335', `--user-data-dir=${profile}`, `${base}/node_modules/.cache/atlas-check.html`,
], { windowsHide: true, stdio: 'ignore' })
let socket
try {
  let pages
  for (let i = 0; i < 100; i++) {
    try { pages = await (await fetch('http://127.0.0.1:9335/json')).json(); if (pages.some(p => p.type === 'page')) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  const page = pages?.find(p => p.type === 'page')
  if (!page) throw new Error('Browser debugging endpoint unavailable')
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let next = 0
  const pending = new Map()
  socket.onmessage = event => {
    const msg = JSON.parse(event.data)
    if (msg.id) { pending.get(msg.id)?.(msg); pending.delete(msg.id) }
  }
  const call = (method, params) => new Promise(resolve => {
    const id = ++next; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params }))
  })
  await call('Page.enable', {})
  await call('Page.navigate', { url: `${base}/node_modules/.cache/atlas-check.html` })
  for (let i = 0; i < 100; i++) {
    const ready = await call('Runtime.evaluate', { expression: 'location.origin + ":" + document.readyState', returnByValue: true })
    if (ready.result?.result?.value === `${base}:complete`) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const result = await call('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `
    (async () => {
      const assert = (value, message) => { if (!value) throw new Error(message) }
      let disk = null, failSave = false
      window.alert = () => {}
      window.electronAPI = {
        loadAssetAtlas: async () => disk,
        saveAssetAtlas: async pair => { if (failSave) throw new Error('simulated disk failure'); disk = pair; return true },
      }
      const { buildAtlas, readAtlas, loadAtlasImage, atlasDigest } = await import('/src/assets/atlasService.ts')
      const { loadBundledAtlases, writeIndexedDBAtlas, readIndexedDBAtlas } = await import('/src/assets/atlasStorage.ts')
      const { initializeCustomAssets, useCustomAssetsStore } = await import('/src/store/useCustomAssetsStore.ts')
      const { parseSparrowAtlasAndSlice, importPresetsIntoStore } = await import('/src/engine/avatar/avatarAtlasImporter.ts')
      const bundled = await loadBundledAtlases()
      assert(bundled.length === 1, 'Expected one distributed atlas')
      const baseline = await readAtlas(bundled[0])
      assert(baseline.assets.length >= 72, 'Missing migrated assets')
      const original = baseline.assets[0]
      const legacy = { ...original, id: 'legacy-test', name: 'Migração local á & < >', updatedAt: Date.now() }
      localStorage.setItem('lira_custom_user_assets', JSON.stringify([legacy]))
      await initializeCustomAssets()
      assert(!localStorage.getItem('lira_custom_user_assets'), 'Legacy catalog was not retired')
      const count = baseline.assets.length + 1
      assert(useCustomAssetsStore.getState().customAssets.length === count, 'Legacy merge failed')
      assert(disk && !disk.xml.includes('data:image/'), 'Persisted XML embeds images')
      const roundtrip = await readAtlas(await buildAtlas(baseline.assets, baseline.categories))
      const canonical = async value => {
        if (typeof value === 'string' && value.startsWith('data:image/')) {
          const image = await loadAtlasImage(value)
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
          canvas.getContext('2d').drawImage(image, 0, 0)
          return canvas.toDataURL('image/png')
        }
        if (Array.isArray(value)) return Promise.all(value.map(canonical))
        if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).filter(([key]) => key !== 'thumbnail').map(async ([key, v]) => [key, await canonical(v)])))
        return value
      }
      assert(JSON.stringify(await canonical(roundtrip)) === JSON.stringify(await canonical(baseline)), 'Round-trip changed pixels or metadata')
      const fixture = { ...original, id: 'new-test', name: 'Teste novo', updatedAt: Date.now() }
      await useCustomAssetsStore.getState().addCustomAsset(fixture)
      await useCustomAssetsStore.getState().updateCustomAsset(fixture.id, { name: 'Teste editado' })
      assert((await readAtlas(disk)).assets.find(a => a.id === fixture.id).name === 'Teste editado', 'Update did not persist')
      const beforeFailure = await atlasDigest(disk)
      failSave = true
      let rejected = false
      try { await useCustomAssetsStore.getState().deleteCustomAsset(fixture.id) } catch { rejected = true }
      assert(rejected && useCustomAssetsStore.getState().getAssetById(fixture.id), 'Failure changed visible state')
      assert(await atlasDigest(disk) === beforeFailure, 'Failure replaced persisted state')
      failSave = false
      await useCustomAssetsStore.getState().deleteCustomAsset(fixture.id)
      assert(!(await readAtlas(disk)).assets.some(a => a.id === fixture.id), 'Delete did not persist')
      const canvas = document.createElement('canvas'); canvas.width = 12; canvas.height = 5
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 4, 5); ctx.fillStyle = '#00ff00'; ctx.fillRect(4, 0, 8, 5)
      const sparrow = '<?xml version="1.0"?><TextureAtlas imagePath="test.png"><SubTexture name="other_hero_down_10" x="4" y="0" width="8" height="5"/><SubTexture name="other_hero_down_2" x="0" y="0" width="4" height="5"/></TextureAtlas>'
      const parsed = await parseSparrowAtlasAndSlice(sparrow, canvas, 'other')
      assert(parsed[0].directionalFrames.down.length === 2, 'Importer lost animation frames')
      assert((await loadAtlasImage(parsed[0].directionalFrames.down[0])).naturalWidth === 4, 'Numeric frame order failed')
      const imported = await importPresetsIntoStore('other', parsed)
      const { renderAvatarSnapshot } = await import('/src/utils/avatarUtils.ts')
      const avatar = { customAvatarId: imported[0].id, customComponents: { other: imported[0].id } }
      const portraitBefore = renderAvatarSnapshot(avatar)
      await useCustomAssetsStore.getState().updateCustomAsset(imported[0].id, { directionalFrames: { down: parsed[0].directionalFrames.down[1] } })
      const portraitAfter = renderAvatarSnapshot(avatar)
      assert(portraitAfter !== portraitBefore, 'Editing an asset ID did not refresh its portrait')
      const exported = await buildAtlas(imported)
      const exportedImage = await loadAtlasImage(exported.png)
      const reimported = await parseSparrowAtlasAndSlice(exported.xml, exportedImage, 'other')
      assert(reimported[0].asset.id === imported[0].id && reimported[0].directionalFrames.down.length === 2, 'Export/reimport lost identity or frames')
      let invalid = 0
      for (const pair of [{ ...exported, png: 'data:image/png;base64,broken' }, { ...exported, xml: exported.xml.replace('liraVersion="1"', 'liraVersion="999"') }, { ...exported, xml: exported.xml.replace('x="0"', 'x="999999"') }]) {
        try { await readAtlas(pair) } catch { invalid++ }
      }
      assert(invalid === 3, 'Invalid atlases were accepted')
      // Exercise the real IndexedDB transaction adapter too.
      await writeIndexedDBAtlas(exported)
      const reopened = await readIndexedDBAtlas()
      assert(reopened.xml === exported.xml && reopened.png === exported.png, 'IndexedDB changed the pair')
      window.__atlasTransfer = { atlas: exported, digest: await atlasDigest(exported), id: imported[0].id }
      return { migrated: baseline.assets.length, roundtrip: 'all pixels and metadata identical', checks: ['legacy migration', 'create', 'edit', 'delete', 'rollback', 'numeric frame order', 'portrait refresh by asset ID', 'export/reimport', 'invalid XML/PNG', 'IndexedDB reopen'] }
    })()
  ` })
  if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails))
  const report = result.result?.result?.value || result
  const transfer = await call('Runtime.evaluate', { expression: 'window.__atlasTransfer', returnByValue: true })
  const target = await call('Target.createTarget', { url: `${base}/node_modules/.cache/atlas-check.html` })
  const receiverPages = await (await fetch('http://127.0.0.1:9335/json')).json()
  const receiverPage = receiverPages.find(p => p.id === target.result.targetId)
  const receiver = new WebSocket(receiverPage.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { receiver.onopen = resolve; receiver.onerror = reject })
  let receiverNext = 0
  const receiverPending = new Map()
  receiver.onmessage = event => { const m = JSON.parse(event.data); if (m.id) { receiverPending.get(m.id)?.(m); receiverPending.delete(m.id) } }
  const receiveCall = (method, params) => new Promise(resolve => { const id = ++receiverNext; receiverPending.set(id, resolve); receiver.send(JSON.stringify({ id, method, params })) })
  for (let i = 0; i < 100; i++) {
    const ready = await receiveCall('Runtime.evaluate', { expression: 'location.origin + ":" + document.readyState', returnByValue: true })
    if (ready.result?.result?.value === `${base}:complete`) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const incoming = transfer.result.result.value
  const receiverResult = await receiveCall('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `
    (async () => {
      let saved
      window.alert = () => {}
      window.electronAPI = { saveAssetAtlas: async pair => { saved = pair; return true } }
      const { useCustomAssetsStore } = await import('/src/store/useCustomAssetsStore.ts')
      const { processNetworkMessage } = await import('/src/p2p/messageHandlers.ts')
      const payload = ${JSON.stringify(incoming)}
      const deliver = (type, body) => processNetworkMessage({ type, payload: body, senderId: 'sender', timestamp: Date.now() }, 'sender', false, () => {}, () => {}, () => {})
      const wait = async predicate => {
        for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 25)) }
        throw new Error('Peer synchronization timed out')
      }
      deliver('CUSTOM_ASSETS_SYNC', payload)
      await wait(() => useCustomAssetsStore.getState().getAssetById(payload.id))
      if (!saved || saved.xml.includes('data:image/')) throw new Error('Peer did not persist PNG/XML')
      deliver('CUSTOM_ASSETS_SYNC', payload)
      deliver('CUSTOM_ASSET_DELETE', { id: payload.id })
      await wait(() => !useCustomAssetsStore.getState().getAssetById(payload.id))
      if (useCustomAssetsStore.getState().customAssets.length) throw new Error('Duplicate delivery resurrected an asset')
      return true
    })()
  ` })
  receiver.close()
  if (receiverResult.result?.exceptionDetails) throw new Error(JSON.stringify(receiverResult.result.exceptionDetails))
  report.checks.push('two independent clients: transfer, reuse and ordered delete')
  console.log(JSON.stringify(report, null, 2))
  await call('Browser.close', {})
} finally {
  socket?.close()
  browser.kill()
  await rm(pageFile, { force: true })
  // Chromium can hold its profile briefly after Browser.close.
  await new Promise(resolve => setTimeout(resolve, 500))
  const relative = path.relative(cache, profile)
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) await rm(profile, { recursive: true, force: true }).catch(() => {})
}
