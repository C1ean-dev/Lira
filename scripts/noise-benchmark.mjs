import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import { _electron } from 'playwright'

const root = process.cwd()
const require = createRequire(import.meta.url)
const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback
const profile = option('profile', 'full')
const output = path.resolve(option('output', '.scratch/noise-benchmark/current'))
const engines = option('engines', 'classic,deepfilter,rnnoise').split(',')
const existingBundle = option('bundle', '')
const dynamicsOnly = process.argv.includes('--dynamics-only')
const reference = process.argv.includes('--reference')
if (reference && !existingBundle) throw new Error('Reference recording requires --bundle')
if (!['smoke', 'full', 'validation'].includes(profile) || engines.some(engine => !['classic', 'deepfilter', 'rnnoise', 'rnnoise-open'].includes(engine))) throw new Error('Invalid profile/engine')
const python = process.env.LIRA_PYTHON || 'python'
async function runPython(action) {
  await new Promise((resolve, reject) => {
    const compare = option('compare', '')
    const args = action === 'test' ? ['-m', 'unittest', 'discover', '-s', 'scripts/noise-benchmark', '-p', 'test_*.py'] : action === 'check'
      ? ['scripts/noise-benchmark/check_report.py', path.join(output, 'report.json'), ...(compare ? ['--compare', path.resolve(compare)] : [])]
      : ['scripts/noise-benchmark/dataset.py', action, output, '--profile', profile]
    const child = spawn(python, ['-B', ...args], { cwd: root, stdio: 'inherit', windowsHide: true,
      env: { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' },
    })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Dataset ${action} failed (${code})`)))
  })
}

if (!dynamicsOnly) {
  await runPython('test')
  await runPython('prepare')
}
await fs.mkdir(output, { recursive: true })
const runtime = await fs.mkdtemp(path.join(output, 'runtime-'))
let electron
let server
try {
  if (existingBundle) await fs.copyFile(path.resolve(existingBundle), path.join(runtime, 'renderer.js'))
  else await build({ entryPoints: ['scripts/noise-benchmark/renderer.ts'], outfile: path.join(runtime, 'renderer.js'), bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent',
    assetNames: 'assets/[name]-[hash]', publicPath: '/',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{"DEV":false,"PROD":true,"BASE_URL":"/","MODE":"test"}' },
    plugins: [{ name: 'raw-audio-sources', setup(builder) {
      builder.onResolve({ filter: /^virtual:lira-(asset-atlases|individual-library)$/ }, args => ({ path: args.path, namespace: 'benchmark-assets' }))
      builder.onLoad({ filter: /.*/, namespace: 'benchmark-assets' }, () => ({ contents: 'export default []', loader: 'js' }))
      builder.onResolve({ filter: /\?(raw|url)$/ }, async args => {
        const kind = args.path.endsWith('?raw') ? 'raw' : 'url'
        const resolved = await builder.resolve(args.path.replace(/\?(raw|url)$/, ''), { resolveDir: args.resolveDir, kind: args.kind })
        return { path: resolved.path, namespace: kind === 'raw' ? 'raw-audio-source' : 'audio-asset' }
      })
      builder.onLoad({ filter: /.*/, namespace: 'audio-asset' }, async args => ({ contents: await fs.readFile(args.path), loader: 'file' }))
      builder.onLoad({ filter: /.*/, namespace: 'raw-audio-source' }, async args => ({ contents: `export default ${JSON.stringify(await fs.readFile(args.path, 'utf8'))}`, loader: 'js' }))
    } }],
  })
  await fs.copyFile(path.join(runtime, 'renderer.js'), path.join(output, 'renderer.js'))
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://fixture').pathname)
      if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><script type="module" src="/renderer.js"></script>'); return }
      const file = pathname === '/renderer.js' || pathname.startsWith('/assets/') ? path.resolve(runtime, '.' + pathname) : path.resolve(output, '.' + pathname)
      if (!file.startsWith(output + path.sep)) { response.writeHead(404).end(); return }
      response.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
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
  page.on('pageerror', error => console.error(error.message))
  await page.waitForFunction(() => Boolean(window.noiseBenchmark))
  if (dynamicsOnly) {
    const dynamics = await page.evaluate(() => window.noiseBenchmark.checkDynamics())
    if (!process.argv.includes('--quiet')) console.log(JSON.stringify(dynamics, null, 2))
  }
  const caseId = option('case', '')
  const cases = dynamicsOnly ? [] : JSON.parse(await fs.readFile(path.join(output, 'cases.json'), 'utf8')).cases.filter(fixture => !caseId || fixture.id === caseId)
  if (!dynamicsOnly && !cases.length) throw new Error('Unknown benchmark case: ' + caseId)
  await fs.writeFile(path.join(output, 'run.json'), JSON.stringify({
    startedAt: new Date().toISOString(), profile, engines, reference, caseIds: cases.map(fixture => fixture.id),
    sourceSha256: createHash('sha256').update(await fs.readFile(path.join(runtime, 'renderer.js'))).digest('hex'),
    versions: await electron.evaluate(() => process.versions),
    sampleRate: 48000, sensitivity: 'auto', inputVolume: 100,
  }, null, 2) + '\n')
  let done = 0
  for (const fixture of cases) {
    for (const engine of engines) {
      const target = path.join(output, fixture.id, engine)
      const result = await page.evaluate(({ url, engine }) => window.noiseBenchmark.run(url, engine), { url: `${url}/${fixture.id}/input.f32`, engine })
      await fs.writeFile(target + '.raw.f32', Buffer.from(result.raw, 'base64'))
      await fs.writeFile(target + '.processed.f32', Buffer.from(result.processed, 'base64'))
      console.log(`[noise-benchmark] ${++done}/${cases.length * engines.length}: ${fixture.id}/${engine}`)
    }
  }
} finally {
  await electron?.close()
  if (server) await new Promise(resolve => server.close(resolve))
  if (!runtime.startsWith(output + path.sep)) throw new Error('Invalid benchmark cleanup path')
  await fs.rm(runtime, { recursive: true, force: true })
}
if (!dynamicsOnly) {
  await runPython('score')
  if (!reference) await runPython('check')
  console.log('Report: ' + path.join(output, 'report.json'))
}
