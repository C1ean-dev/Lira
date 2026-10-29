import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'

// Explicit opt-in: starts an isolated, invisible Electron renderer and replays
// fixed dataset files through the real Lira engines. No physical mic is used.
test('measure real Lira engine delay and intelligibility in Electron', {
  skip: process.env.LIRA_RUN_AUDIO_BENCHMARK !== '1', timeout: 900000,
}, async t => {
  const root = process.cwd()
  const require = createRequire(import.meta.url)
  const { build } = await import('esbuild')
  const { _electron } = await import('playwright')
  const profile = process.env.LIRA_AUDIO_PROFILE || 'validation'
  assert.ok(['smoke', 'validation', 'full'].includes(profile))
  const output = path.resolve(process.env.LIRA_AUDIO_OUTPUT || `.scratch/noise-benchmark/delay-${Date.now()}`)
  await fs.mkdir(output, { recursive: true })
  const engines = ['deepfilter', 'rnnoise', 'classic']
  async function python(action) {
    const args = action === 'test' ? ['-m', 'unittest', 'discover', '-s', 'scripts/noise-benchmark', '-p', 'test_*.py']
      : ['scripts/noise-benchmark/dataset.py', action, output, '--profile', profile]
    await new Promise((resolve, reject) => {
      const child = spawn(process.env.LIRA_PYTHON || 'python', ['-B', ...args], {
        cwd: root, stdio: 'inherit', windowsHide: true,
        env: { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
      })
      child.once('error', reject)
      child.once('close', code => code === 0 ? resolve() : reject(new Error(`Audio metrics ${action} failed (${code})`)))
    })
  }
  async function checkReport() {
    const report = JSON.parse(await fs.readFile(path.join(output, 'report.json'), 'utf8'))
    assert.equal(report.results.length, report.run.caseIds.length * engines.length)
    assert.equal(report.run.captures.length, report.results.length)
    assert.equal(report.run.sourceSha256, createHash('sha256').update(await fs.readFile(path.join(output, 'renderer.js'))).digest('hex'))
    for (const capture of report.run.captures) {
      if (capture.engine !== 'classic') assert.equal(capture.neuralReady, true, 'No neural fallback may be scored')
    }
    for (const result of report.results) {
      if (result.processingDelayMs === null) {
        assert.equal(result.delayUnavailableReason, 'speech erased')
        assert.equal(result.stoi, 0)
      } else assert.ok(Number.isFinite(result.processingDelayMs) && result.processingDelayMs >= 0 && result.processingDelayMs < 1000)
      // STOI can legitimately be zero/negative on severe speech loss. Report it;
      // a measurement test must not reject and conceal an engine's poor result.
      assert.ok(Number.isFinite(result.stoi) && result.stoi >= -1 && result.stoi <= 1)
    }
    for (const engine of engines) {
      assert.ok(report.results.filter(result => result.engine === engine && result.noise === null && result.processingDelayMs !== null).length >= 2)
    }
    t.diagnostic('Actual captures and report: ' + path.join(output, 'report.json'))
  }
  if (process.env.LIRA_AUDIO_REPLAY_ONLY === '1') {
    await python('test')
    await python('score')
    await checkReport()
    return
  }
  const runtime = await fs.mkdtemp(path.join(output, 'runtime-'))
  let electron
  let server
  try {
    await python('test')
    await python('prepare')
    await build({
      entryPoints: ['scripts/noise-benchmark/renderer.ts'], outfile: path.join(output, 'renderer.js'),
      bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
      assetNames: 'assets/[name]-[hash]', publicPath: '/',
      define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true,"BASE_URL":"/","MODE":"test"}' },
      plugins: [{ name: 'actual-audio-assets', setup(builder) {
        builder.onResolve({ filter: /^virtual:lira-(asset-atlases|individual-library)$/ }, args => ({ path: args.path, namespace: 'benchmark-assets' }))
        builder.onLoad({ filter: /.*/, namespace: 'benchmark-assets' }, () => ({ contents: 'export default []', loader: 'js' }))
        builder.onResolve({ filter: /\?(raw|url)$/ }, async args => {
          const kind = args.path.endsWith('?raw') ? 'raw' : 'url'
          const resolved = await builder.resolve(args.path.replace(/\?(raw|url)$/, ''), { resolveDir: args.resolveDir, kind: args.kind })
          assert.ok(resolved.path, args.path)
          return { path: resolved.path, namespace: `audio-${kind}` }
        })
        builder.onLoad({ filter: /.*/, namespace: 'audio-raw' }, async args => ({ contents: `export default ${JSON.stringify(await fs.readFile(args.path, 'utf8'))}`, loader: 'js' }))
        builder.onLoad({ filter: /.*/, namespace: 'audio-url' }, async args => ({ contents: await fs.readFile(args.path), loader: 'file' }))
      } }],
    })
    server = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://fixture').pathname)
        if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><script type="module" src="/renderer.js"></script>'); return }
        const file = path.resolve(output, '.' + pathname)
        const relative = path.relative(output, file)
        if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(404).end(); return }
        response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream')
        response.end(await fs.readFile(file))
      } catch { response.writeHead(404).end() }
    })
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    const url = `http://127.0.0.1:${server.address().port}`
    const main = path.join(runtime, 'main.cjs')
    await fs.writeFile(main, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(runtime, 'profile'))});app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');app.commandLine.appendSwitch('disable-background-timer-throttling');app.whenReady().then(()=>{const w=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});w.loadURL(${JSON.stringify(url)})});app.on('window-all-closed',()=>app.quit());`)
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    electron = await _electron.launch({ executablePath: require('electron'), args: ['--mute-audio', main], env: environment })
    const page = await electron.firstWindow()
    page.on('pageerror', error => console.error(error.stack))
    await page.waitForFunction(() => Boolean(window.noiseBenchmark))
    const cases = JSON.parse(await fs.readFile(path.join(output, 'cases.json'), 'utf8')).cases
    const run = {
      startedAt: new Date().toISOString(), profile, engines, caseIds: cases.map(fixture => fixture.id),
      sourceSha256: createHash('sha256').update(await fs.readFile(path.join(output, 'renderer.js'))).digest('hex'),
      versions: await electron.evaluate(() => process.versions),
      sampleRate: 48000, sensitivity: 'auto', inputVolume: 100,
      method: 'Lag(processed capture, clean reference) minus lag(raw capture, exact input); both channels recorded by one AudioWorklet. Includes real processStream graphs and MediaStream/AudioContext buffers. Excludes physical input/output and network.',
      captures: [],
    }
    let done = 0
    for (const fixture of cases) {
      for (const engine of engines) {
        const target = path.join(output, fixture.id, engine)
        const result = await page.evaluate(({ url, engine }) => window.noiseBenchmark.run(url, engine), { url: `${url}/${fixture.id}/input.f32`, engine })
        await fs.writeFile(target + '.raw.f32', Buffer.from(result.raw, 'base64'))
        await fs.writeFile(target + '.processed.f32', Buffer.from(result.processed, 'base64'))
        if (engine !== 'classic') assert.equal(result.graph.neuralReady, true, `${engine} must process without fallback`)
        run.captures.push({ case: fixture.id, engine, ...result.graph })
        await fs.writeFile(path.join(output, 'run.json'), JSON.stringify(run, null, 2) + '\n')
        console.log(`[audio-latency] ${++done}/${cases.length * engines.length}: ${fixture.id}/${engine}`)
      }
    }
    await python('score')
    await checkReport()
  } finally {
    await electron?.close()
    if (server) await new Promise(resolve => server.close(resolve))
    const relative = path.relative(output, runtime)
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'temporary runtime must remain inside its output folder')
    await fs.rm(runtime, { recursive: true, force: true })
  }
})
