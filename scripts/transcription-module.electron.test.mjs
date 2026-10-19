import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

test('optional transcription installs from file origin and starts again offline', {
  skip: process.env.LIRA_RUN_TRANSCRIPTION_TESTS !== '1', timeout: 300000,
}, async () => {
  const { build } = await import('esbuild')
  const { _electron } = await import('playwright')
  const require = createRequire(import.meta.url)
  const root = process.cwd()
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-transcription-'))
  const screenshots = path.join(root, 'node_modules/.cache/transcription-preview')
  let electron
  try {
    await fs.mkdir(screenshots, { recursive: true })
    await build({ entryPoints: ['src/media/transcription.worker.ts'], outfile: path.join(temporary, 'worker.js'), bundle: true, platform: 'browser', format: 'esm', logLevel: 'silent' })
    await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
      import React, { useState, useEffect, useRef } from 'react';
      import { createRoot } from 'react-dom/client';
      import { CallTranscriptPanel } from './src/components/grid/CallTranscriptPanel';
      import { CallTranscription } from './src/media/callTranscription';
      import { isTranscriptionInstalled } from './src/media/transcriptionModule';
      function Harness() {
        const [status, setStatus] = useState('idle');
        const [error, setError] = useState();
        const [installed, setInstalled] = useState(false);
        const [download, setDownload] = useState();
        const session = useRef();
        window.transcriptionTestState = { status, error, installed };
        useEffect(() => { isTranscriptionInstalled().then(setInstalled); }, []);
        const start = () => {
          session.current?.dispose(); setError(undefined);
          const next = new CallTranscription(new Worker('./worker.js', { type: 'module' }),
            (nextStatus, message) => { setStatus(nextStatus); setError(message); if (nextStatus === 'recording') setInstalled(true); },
            () => {}, () => {}, setDownload);
          session.current = next; void next.start();
        };
        return <div className="flex justify-end h-screen bg-slate-950"><CallTranscriptPanel status={status} entries={[]} error={error} installed={installed} download={download} onStart={start} onStop={() => session.current?.stop()} onClose={() => {}} /></div>;
      }
      createRoot(document.getElementById('root')).render(<Harness />);
    ` }, outfile: path.join(temporary, 'panel.js'), bundle: true, platform: 'browser', format: 'esm', logLevel: 'silent' })
    const css = (await fs.readdir(path.join(root, 'dist/assets'))).find(name => /^bootstrap-.*\.css$/.test(name))
    await fs.copyFile(path.join(root, 'dist/assets', css), path.join(temporary, 'panel.css'))
    await fs.writeFile(path.join(temporary, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="./panel.css"><div id="root"></div><script type="module" src="./panel.js"></script>')
    const main = path.join(temporary, 'main.cjs')
    await fs.writeFile(main, `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(path.join(temporary, 'profile'))});app.whenReady().then(()=>{const window=new BrowserWindow({show:false,width:1280,height:800,webPreferences:{webSecurity:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});window.loadFile(${JSON.stringify(path.join(temporary, 'index.html'))})});app.on('window-all-closed',()=>app.quit());`)
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    electron = await _electron.launch({ executablePath: require('electron'), args: [main], env: environment })
    const page = await electron.firstWindow()
    const capture = async name => { if (process.env.LIRA_TRANSCRIPTION_SCREENSHOTS === '1') await page.screenshot({ path: path.join(screenshots, name) }) }
    const requests = []
    page.on('request', request => { if (request.url().startsWith('https:')) requests.push(request.url()) })
    page.on('console', message => { if (message.type() === 'error') console.error('[Transcription test]', message.text()) })
    await page.getByRole('button', { name: 'Baixar e iniciar transcrição' }).waitFor()
    assert.equal(requests.length, 0, 'Opening the panel must not download dependencies')
    await capture('before-download.png')
    await page.getByRole('button', { name: 'Baixar e iniciar transcrição' }).click()
    await page.getByRole('button', { name: 'Cancelar', exact: true }).waitFor()
    await capture('downloading.png')
    console.log('Downloading pinned runtime and Whisper model for the isolated test profile…')
    await page.waitForFunction(() => ['recording', 'error'].includes(window.transcriptionTestState?.status), undefined, { timeout: 240000 })
    assert.equal(await page.evaluate(() => window.transcriptionTestState.status), 'recording', await page.evaluate(() => window.transcriptionTestState.error))
    assert(requests.some(url => url.includes('transformers@3.8.1')), 'Runtime must be fetched on first use')
    await capture('ready.png')
    await page.getByRole('button', { name: 'Parar transcrição' }).click()
    await page.waitForFunction(() => window.transcriptionTestState?.status === 'idle')
    await page.context().setOffline(true)
    requests.length = 0
    await page.reload()
    await page.getByRole('button', { name: 'Iniciar transcrição', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Iniciar transcrição', exact: true }).click()
    await page.waitForFunction(() => ['recording', 'error'].includes(window.transcriptionTestState?.status), undefined, { timeout: 60000 })
    assert.equal(await page.evaluate(() => window.transcriptionTestState.status), 'recording', await page.evaluate(() => window.transcriptionTestState.error))
    assert.equal(requests.length, 0, 'A new worker must reuse the installed module and model offline')
    await page.setViewportSize({ width: 412, height: 800 })
    await capture('narrow.png')
    console.log('Verified: no initial download, real Whisper/WASM installation, profile persistence and offline restart.')
  } finally {
    await electron?.close()
    assert(path.resolve(temporary).startsWith(path.resolve(os.tmpdir()) + path.sep))
    await fs.rm(temporary, { recursive: true, force: true })
  }
})
