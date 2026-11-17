import { build } from 'esbuild'
import { _electron } from 'playwright'
import { createRequire } from 'node:module'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const require = createRequire(import.meta.url)

// Build the real desktop entry and preload into a disposable application. Each
// process has its own working directory and userData; only test-local presence
// and cross-process messages share a temp directory, just as electron:dual does.
export async function electronSystem({ output, microphone, visible }) {
  const project = process.cwd()
  const runtime = await mkdtemp(path.join(output, 'desktop-'))
  const application = path.join(runtime, 'application')
  const sharedTemp = path.join(runtime, 'shared-temp')
  const applications = []
  await mkdir(path.join(application, 'out'), { recursive: true })
  await mkdir(path.join(application, 'public'), { recursive: true })
  await mkdir(sharedTemp, { recursive: true })
  const { version } = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'))
  await writeFile(path.join(application, 'package.json'), JSON.stringify({ name: 'lira-e2e', version, type: 'module', main: 'bootstrap.mjs' }))
  await writeFile(path.join(application, 'bootstrap.mjs'), `
    import { app } from 'electron';
    import fs from 'node:fs';
    import path from 'node:path';
    const profile = path.join(process.cwd(), 'profile');
    fs.mkdirSync(profile, {recursive:true});
    app.setPath('userData', profile);
    app.setPath('sessionData', profile);
    app.setPath('temp', ${JSON.stringify(sharedTemp)});
    // Update availability is an external boundary, never a real download.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, options) => {
      const url = new URL(typeof input === 'string' ? input : input.url || String(input));
      if (!['127.0.0.1','localhost'].includes(url.hostname)) return new Response('{}', {status:503});
      return originalFetch(input, options);
    };
    await import('./out/main.mjs');
  `)
  await Promise.all([
    build({ entryPoints: [path.join(project, 'electron/main.ts')], outfile: path.join(application, 'out/main.mjs'),
      bundle: true, packages: 'external', platform: 'node', format: 'esm', logLevel: 'silent' }),
    build({ entryPoints: [path.join(project, 'electron/preload.ts')], outfile: path.join(application, 'out/preload.js'),
      bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent' }),
  ])

  async function close() {
    for (const desktop of applications) await desktop.close().catch(() => {})
    // Only this invocation's freshly created directory can be removed.
    if (path.dirname(path.resolve(runtime)) !== path.resolve(output) || !path.basename(runtime).startsWith('desktop-')) throw new Error('Diretório temporário do Electron inválido')
    await rm(runtime, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  return { close, async open(index) {
    const working = path.join(runtime, `instance-${index + 1}`)
    await mkdir(path.join(working, 'src/data'), { recursive: true })
    await writeFile(path.join(working, 'src/data/nativeSpaces.json'), '[]')
    await cp(path.join(project, 'src/data/nativeAssets.json'), path.join(working, 'src/data/nativeAssets.json')).catch(error => { if (error.code !== 'ENOENT') throw error })
    await cp(path.join(project, 'public/assets/library'), path.join(working, 'public/assets/library'), { recursive: true })
    for (const icon of ['icon.png', 'tray-icon.png']) {
      await cp(path.join(project, 'public', icon), path.join(application, 'public', icon), { force: true }).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
    const env = { ...process.env, VITE_DEV_SERVER_URL: 'about:blank', INSTANCE: String(index + 1) }
    delete env.ELECTRON_RUN_AS_NODE
    const desktop = await _electron.launch({ executablePath: require('electron'), cwd: working, env,
      args: [application, '--multi', `--instance=${index + 1}`, ...(!visible ? ['--hidden'] : []),
        '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-audio-capture=${microphone}`, '--disable-background-timer-throttling', '--disable-renderer-backgrounding'], timeout: 30000 })
    applications.push(desktop)
    const page = await desktop.firstWindow()
    await desktop.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(1600, 950)
    })
    const native = await desktop.evaluate(({ app, BrowserWindow }) => ({ pid: process.pid,
      electron: process.versions.electron, userData: app.getPath('userData'), cwd: process.cwd(),
      instance: process.argv.find(arg => arg.startsWith('--instance=')),
      title: BrowserWindow.getAllWindows()[0].getTitle(), visible: BrowserWindow.getAllWindows()[0].isVisible() }))

    // Substitute hardware sources only. The production get-sources handler,
    // preload, set-screen-source handler, PCM bridge, worklet and live pipeline
    // stay in use. Never capture the user's real windows or process audio.
    await desktop.evaluate(({ desktopCapturer, ipcMain, nativeImage, app }) => {
      desktopCapturer.getSources = async () => [{ id: 'screen:e2e:0', name: 'Tela sintética E2E',
        thumbnail: nativeImage.createEmpty(), appIcon: null, display_id: 'e2e' }]
      for (const channel of ['get-process-audio-capture-info', 'start-process-audio-capture', 'stop-process-audio-capture']) ipcMain.removeHandler(channel)
      ipcMain.handle('get-process-audio-capture-info', () => ({ supported: true, osRelease: 'E2E', helperPath: 'synthetic-pcm', helperExists: true }))
      let timer, frame = 0
      const stop = () => { clearInterval(timer); timer = undefined; return true }
      ipcMain.handle('start-process-audio-capture', event => {
        stop()
        const send = () => {
          const samples = new Int16Array(960 * 2)
          for (let i = 0; i < 960; i++) {
            const value = Math.round(32767 * .12 * Math.sin(2 * Math.PI * 880 * frame++ / 48000))
            samples[i * 2] = value; samples[i * 2 + 1] = value
          }
          if (!event.sender.isDestroyed()) event.sender.send('process-audio-data', new Uint8Array(samples.buffer))
        }
        timer = setInterval(send, 20)
        event.sender.send('process-audio-status', { status: 'started' })
        return { ok: true }
      })
      ipcMain.handle('stop-process-audio-capture', stop)
      app.on('before-quit', stop)
    })
    return { desktop, context: desktop.context(), page, native }
  } }
}
