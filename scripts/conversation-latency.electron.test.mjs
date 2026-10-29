import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'

// Explicitly authorized, isolated conversation measurement. Two independent
// Lira realms use real MediaManager, PeerManager, Opus/RTP and remote playback.
test('measure both directions of a real Lira conversation using Microsoft speech', {
  skip: process.env.LIRA_RUN_CONVERSATION_BENCHMARK !== '1', timeout: 900000,
}, async t => {
  const root = process.cwd()
  const require = createRequire(import.meta.url)
  const output = path.resolve(process.env.LIRA_AUDIO_OUTPUT || `.scratch/noise-benchmark/conversation-${Date.now()}`)
  await fs.mkdir(output, { recursive: true })
  const smoke = process.env.LIRA_CONVERSATION_SMOKE === '1'
  const engines = process.env.LIRA_CONVERSATION_ENGINES?.split(',') || (smoke ? ['bypass', 'rnnoise'] : ['bypass', 'classic', 'rnnoise', 'deepfilter'])
  assert.ok(engines.length && engines.every(engine => ['bypass', 'classic', 'rnnoise', 'deepfilter'].includes(engine)))
  const variant = process.env.LIRA_CONVERSATION_VARIANT || 'normal'
  assert.ok(['normal', 'audio-only', 'replay-filtered', 'defer-resume', 'settled', 'prewarm-model', 'settled-open-gate'].includes(variant))
  const encodedProbe = process.env.LIRA_CONVERSATION_ENCODED_PROBE === '1'
  const requestedPairs = process.env.LIRA_CONVERSATION_PAIRS?.split(',').map(Number) || (smoke ? [0] : [0, 1, 2, 3])
  assert.ok(requestedPairs.length && requestedPairs.every(index => Number.isInteger(index) && index >= 0 && index < 4))
  function selectPairs(cases) {
    const speakers = [...new Set(cases.map(row => row.speaker))]
    assert.equal(speakers.length, 2)
    const groups = speakers.map(speaker => cases.filter(row => row.speaker === speaker))
    return requestedPairs.map(index => [groups[0][index], groups[1][index]])
  }
  async function python(args) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.env.LIRA_PYTHON || 'python', ['-B', ...args], {
        cwd: root, stdio: 'inherit', windowsHide: true,
        env: { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
      })
      child.once('error', reject)
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`Conversation metrics failed (${code})`)))
    })
  }
  async function checkReport() {
    const report = JSON.parse(await fs.readFile(path.join(output, 'conversation-report.json'), 'utf8'))
    const cases = JSON.parse(await fs.readFile(path.join(output, 'cases.json'), 'utf8')).cases
    const expectedCases = selectPairs(cases).flat().map(row => row.id).sort()
    assert.equal(report.results.length, report.run.captures.length * 2)
    assert.equal(report.results.length, expectedCases.length * engines.length)
    assert.deepEqual([...new Set(report.results.map(row => row.engine))].sort(), [...engines].sort())
    for (const [file, hash] of Object.entries(report.run.bundleSha256)) {
      assert.equal(createHash('sha256').update(await fs.readFile(path.join(output, file))).digest('hex'), hash)
    }
    for (const capture of report.run.captures) {
      for (const participant of capture.participants) {
        assert.equal(participant.selectedMode, capture.engine === 'bypass' ? 'classic' : capture.engine)
        if (capture.engine === 'deepfilter') assert.equal(participant.deepFilterStatus, 'ready', 'Never label fallback as DeepFilter')
        if (capture.engine === 'rnnoise') assert.equal(participant.rnnoiseStatus, 'ready', 'Never label fallback as RNNoise')
        assert.ok(participant.before.bytesReceived < participant.after.bytesReceived, 'Actual inbound RTP required')
        assert.ok(participant.before.bytesSent < participant.after.bytesSent, 'Actual outbound RTP required')
        assert.ok(participant.after.totalSamplesReceived > participant.before.totalSamplesReceived, 'RTP audio must actually be decoded')
        assert.equal(participant.after.codec?.toLowerCase(), 'audio/opus')
        assert.ok(participant.playbackTracks > 0, 'Capture must traverse the actual remote audio element')
        if (report.run.encodedProbe) {
          assert.ok(participant.frames.sent.length > 100 && participant.frames.received.length > 100)
          assert.deepEqual(participant.frames.errors, [], 'Encoded probe must forward every frame without errors')
        }
      }
    }
    for (const row of report.results) {
      assert.ok(Number.isFinite(row.stoi) && row.stoi >= -1 && row.stoi <= 1)
      if (row.totalDelayMs === null) assert.ok(row.delayUnavailableReason)
      else assert.ok(row.totalDelayMs > 0 && row.totalDelayMs < 3000)
    }
    for (const engine of engines) {
      assert.deepEqual(report.results.filter(row => row.engine === engine).map(row => row.id).sort(), expectedCases)
      // A broken suppressor may erase all speech. Preserve its zero STOI and
      // missing latency in analytics; only the unfiltered control must be measurable.
      if (engine === 'bypass') assert.ok(report.results.some(row => row.engine === engine && row.totalDelayMs !== null))
    }
    t.diagnostic('Conversation report: ' + path.join(output, 'conversation-report.json'))
  }
  async function checkControlCaptures() {
    const run = JSON.parse(await fs.readFile(path.join(output, 'conversation-run.json'), 'utf8'))
    for (const capture of run.captures.filter(row => row.engine === 'bypass')) {
      const levels = []
      for (let index = 0; index < 12; index++) {
        const data = await fs.readFile(path.join(output, `${capture.id}.${index}.f32`))
        const values = new Float32Array(data.buffer, data.byteOffset, data.length / 4)
        let power = 0
        for (const value of values) power += value * value
        levels.push(Math.sqrt(power / values.length))
      }
      assert.ok(levels.every(level => level > 1e-7), `Unfiltered control must contain audio at every measured stage (${capture.id}: ${levels})`)
    }
  }
  await python(['-m', 'unittest', 'discover', '-s', 'scripts/noise-benchmark', '-p', 'test_*.py'])
  if (process.env.LIRA_AUDIO_REPLAY_ONLY === '1') {
    const traceRequested = await fs.access(path.join(output, 'trace-categories.json')).then(() => true, () => false)
    const traceAvailable = await fs.access(path.join(output, 'native-trace.json')).then(() => true, () => false)
    if (traceRequested && !traceAvailable) {
      const original = JSON.parse(await fs.readFile(path.join(output, 'conversation-run.json'), 'utf8'))
      original.nativeTrace = { status: 'unavailable', reason: 'Native trace did not finalize; all PCM and encoded-frame captures were preserved and replayed' }
      await fs.writeFile(path.join(output, 'conversation-run.json'), JSON.stringify(original, null, 2) + '\n')
    }
    await checkControlCaptures()
    await python(['scripts/noise-benchmark/conversation_metrics.py', output])
    await python(['scripts/noise-benchmark/call_diagnostics.py', output])
    await checkReport()
    return
  }
  // A missing harness must fail before starting Electron or any connection.
  await fs.access(path.join(root, 'scripts/noise-benchmark/conversation.ts'))
  await fs.access(path.join(root, 'scripts/noise-benchmark/conversation-peer.ts'))
  await python(['scripts/noise-benchmark/dataset.py', 'prepare', output, '--profile', 'validation'])
  if (variant === 'replay-filtered') {
    assert.ok(process.env.LIRA_REPLAY_FILTERED_SOURCE)
    assert.deepEqual(engines, ['bypass'])
    await python(['scripts/noise-benchmark/call_diagnostics.py', '--prepare-replay', path.resolve(process.env.LIRA_REPLAY_FILTERED_SOURCE), output])
  }
  const { build } = await import('esbuild')
  const { _electron } = await import('playwright')
  const runtime = await fs.mkdtemp(path.join(output, 'runtime-'))
  let electron, server, signalingProcess, signalingPort, traceSession
  let logs = []
  try {
    await build({
      entryPoints: ['scripts/noise-benchmark/conversation.ts', 'scripts/noise-benchmark/conversation-peer.ts'],
      outdir: output, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
      assetNames: 'assets/[name]-[hash]', publicPath: '/',
      define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true,"BASE_URL":"/","MODE":"test"}' },
      plugins: [{ name: 'conversation-assets', setup(builder) {
        builder.onResolve({ filter: /^virtual:lira-(asset-atlases|individual-library)$/ }, args => ({ path: args.path, namespace: 'fixture-assets' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture-assets' }, () => ({ contents: 'export default []', loader: 'js' }))
        builder.onResolve({ filter: /\?(raw|url)$/ }, async args => {
          const kind = args.path.endsWith('?raw') ? 'raw' : 'url'
          const resolved = await builder.resolve(args.path.replace(/\?(raw|url)$/, ''), { resolveDir: args.resolveDir, kind: args.kind })
          assert.ok(resolved.path, args.path)
          return { path: resolved.path, namespace: `conversation-${kind}` }
        })
        builder.onLoad({ filter: /.*/, namespace: 'conversation-raw' }, async args => ({ contents: `export default ${JSON.stringify(await fs.readFile(args.path, 'utf8'))}`, loader: 'js' }))
        builder.onLoad({ filter: /.*/, namespace: 'conversation-url' }, async args => ({ contents: await fs.readFile(args.path), loader: 'file' }))
      } }],
    })
    console.log('[conversation-stage] bundles ready')
    // peer@1.0.2 has recurring housekeeping timers without a public dispose API.
    // Isolate its lifecycle so cleanup also releases these timers on failures.
    signalingProcess = spawn(process.execPath, ['-e', "process.on('disconnect',()=>process.exit(0));const {PeerServer}=require('peer');PeerServer({port:0,host:'127.0.0.1',path:'/'},server=>process.send({port:server.address().port}));"], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    signalingPort = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Local signaling startup timed out')), 15000)
      signalingProcess.once('message', message => { clearTimeout(timeout); resolve(message.port) })
      signalingProcess.once('error', error => { clearTimeout(timeout); reject(error) })
      signalingProcess.once('exit', code => { clearTimeout(timeout); reject(new Error(`Local signaling exited (${code})`)) })
    })
    server = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://fixture').pathname)
        if (pathname === '/' || pathname === '/participant.html') {
          response.setHeader('Content-Type', 'text/html')
          // Real users have separate profiles. Keep each iframe's test profile
          // independent while preserving same-origin access for the sample clock.
          const storage = pathname === '/' ? '' : '<script>const items=new Map();Object.defineProperty(window,"localStorage",{value:{getItem(k){return items.get(k)??null},setItem(k,v){items.set(k,String(v))},removeItem(k){items.delete(k)},clear(){items.clear()},key(i){return [...items.keys()][i]??null},get length(){return items.size}}})</script>'
          response.end(`<!doctype html><title>Lira conversation test</title>${storage}<script type="module" src="/${pathname === '/' ? 'conversation' : 'conversation-peer'}.js"></script>`)
          return
        }
        const file = path.resolve(output, '.' + pathname)
        const relative = path.relative(output, file)
        if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(404).end(); return }
        response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        response.end(await fs.readFile(file))
      } catch { response.writeHead(404).end() }
    })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const url = `http://127.0.0.1:${server.address().port}`
    console.log('[conversation-stage] local server ready')
    const main = path.join(runtime, 'main.cjs')
    await fs.writeFile(main, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(runtime, 'profile'))});app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');app.commandLine.appendSwitch('disable-background-timer-throttling');app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadURL(${JSON.stringify(url)})});app.on('window-all-closed',()=>app.quit());`)
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    // Mute the device output only. Keep remote elements at volume 1 so their
    // captureStream and real WebRTC playback path remain measurable.
    electron = await _electron.launch({ executablePath: require('electron'), args: ['--mute-audio', main], env: environment })
    assert.equal(await electron.evaluate(({ app }) => app.commandLine.hasSwitch('mute-audio')), true)
    console.log('[conversation-stage] Electron launched')
    const page = await electron.firstWindow()
    page.on('console', message => {
      logs.push(message.text()); if (logs.length > 50) logs.shift()
      if (message.text().startsWith('[conversation-stage]')) console.log(message.text())
    })
    page.on('pageerror', error => { logs.push(error.stack); console.error(error.stack) })
    await page.waitForFunction(() => Boolean(window.conversationBenchmark), null, { timeout: 30000 })
    if (process.env.LIRA_CONVERSATION_TRACE === '1') {
      const categories = await electron.evaluate(async ({ contentTracing }) => contentTracing.getCategories())
      await fs.writeFile(path.join(output, 'trace-categories.json'), JSON.stringify(categories))
      await electron.evaluate(async ({ contentTracing }) => contentTracing.startRecording({ included_categories: ['audio', 'webrtc', 'webaudio', 'v8.wasm', 'disabled-by-default-audio', 'disabled-by-default-webrtc'] }))
    }
    if (process.env.LIRA_CONVERSATION_CDP_TRACE === '1') {
      assert.notEqual(process.env.LIRA_CONVERSATION_TRACE, '1', 'Use one trace controller')
      traceSession = await page.context().newCDPSession(page)
      await traceSession.send('Tracing.start', { categories: 'audio,webrtc,webaudio,disabled-by-default-audio,disabled-by-default-audio.latency,disabled-by-default-webrtc', transferMode: 'ReturnAsStream' })
    }
    const cases = JSON.parse(await fs.readFile(path.join(output, 'cases.json'), 'utf8')).cases
    const pairs = selectPairs(cases)
    const run = {
      startedAt: new Date().toISOString(), engines, variant, encodedProbe, versions: await electron.evaluate(() => process.versions),
      sampleRate: 48000, sensitivity: variant === 'settled-open-gate' ? 'manual-always-open' : 'auto', inputVolume: 100, network: 'real WebRTC on loopback, local PeerJS signaling, no external STUN/TURN',
      method: 'Two isolated Lira realms. Shared instrumentation AudioContext schedules both Microsoft speech inputs and records raw input, mic bridge, local MediaManager output, remote decoded RTP, remote gain stream and HTMLAudioElement.captureStream. One sample clock, no cross-machine clock assumption. Full software delay includes instrumentation MediaStream bridges; excludes physical devices and external internet.',
      bundleSha256: {}, captures: [],
    }
    for (const name of ['conversation.js', 'conversation-peer.js']) run.bundleSha256[name] = createHash('sha256').update(await fs.readFile(path.join(output, name))).digest('hex')
    for (const [pairIndex, pair] of pairs.entries()) {
      for (const engine of engines) {
        const id = `${engine}-${pairIndex}`
        const result = await page.evaluate(config => Promise.race([
          window.conversationBenchmark.run(config),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Conversation scenario exceeded 100 seconds')), 100000)),
        ]), {
          urls: pair.map(row => `${url}/${row.id}/input.f32`), engine, variant, encodedProbe,
          signalingPort, room: `AUDIO-${Date.now()}-${id}`,
        })
        assert.equal(result.channels.length, 12)
        for (const [index, channel] of result.channels.entries()) await fs.writeFile(path.join(output, `${id}.${index}.f32`), Buffer.from(channel, 'base64'))
        run.captures.push({ id, engine, cases: pair.map(row => row.id), participants: result.participants, context: result.context,
          measurementStartMs: result.measurementStartMs, measurementEndMs: result.measurementEndMs })
        await fs.writeFile(path.join(output, 'conversation-run.json'), JSON.stringify(run, null, 2) + '\n')
        console.log(`[conversation] ${run.captures.length}/${pairs.length * engines.length}: ${id}, bidirectional RTP captured`)
        if (engine === 'bypass') await checkControlCaptures()
      }
    }
    if (process.env.LIRA_CONVERSATION_TRACE === '1') {
      let timer
      try {
        await Promise.race([
          electron.evaluate(async ({ contentTracing }, tracePath) => contentTracing.stopRecording(tracePath), path.join(output, 'native-trace.json')),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Native trace finalization timeout')), 15000) }),
        ])
        run.nativeTrace = { status: 'complete' }
      } catch (error) {
        run.nativeTrace = { status: 'unavailable', reason: String(error) }
        console.log('[conversation-stage] optional native trace unavailable; preserving all PCM/RTC measurements')
      } finally { clearTimeout(timer) }
      await fs.writeFile(path.join(output, 'conversation-run.json'), JSON.stringify(run, null, 2) + '\n')
    }
    if (traceSession) {
      let timer
      try {
        const complete = new Promise(resolve => traceSession.once('Tracing.tracingComplete', resolve))
        await traceSession.send('Tracing.end')
        const { stream } = await Promise.race([complete, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CDP native trace timeout')), 20000) })])
        const destination = await fs.open(path.join(output, 'native-trace.json'), 'w')
        try {
          while (true) {
            const data = await traceSession.send('IO.read', { handle: stream, size: 1048576 })
            await destination.write(data.base64Encoded ? Buffer.from(data.data, 'base64') : data.data)
            if (data.eof) break
          }
        } finally { await destination.close(); await traceSession.send('IO.close', { handle: stream }) }
        run.nativeTrace = { status: 'complete', method: 'CDP streaming trace' }
      } catch (error) { run.nativeTrace = { status: 'unavailable', reason: String(error) } }
      finally { clearTimeout(timer) }
      await fs.writeFile(path.join(output, 'conversation-run.json'), JSON.stringify(run, null, 2) + '\n')
    }
    await python(['scripts/noise-benchmark/conversation_metrics.py', output])
    await python(['scripts/noise-benchmark/call_diagnostics.py', output])
    await checkReport()
  } catch (error) {
    console.error(logs.slice(-35).join('\n'))
    throw error
  } finally {
    await electron?.close()
    if (server) await new Promise(resolve => server.close(resolve))
    if (signalingProcess && signalingProcess.exitCode === null) await new Promise(resolve => {
      signalingProcess.once('exit', resolve)
      signalingProcess.kill()
    })
    const relative = path.relative(output, runtime)
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
    await fs.rm(runtime, { recursive: true, force: true })
  }
})
