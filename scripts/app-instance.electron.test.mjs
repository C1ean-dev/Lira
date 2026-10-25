import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

test('native Electron locks isolate development and still reject duplicate installed and development launches', {
  skip: process.env.LIRA_RUN_INSTANCE_TESTS !== '1', timeout: 45000,
}, async () => {
  const { build } = await import('esbuild')
  const require = createRequire(import.meta.url)
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-instance-test-'))
  const entry = path.join(temporary, 'main.cjs')
  const children = []
  try {
    await build({ stdin: { resolveDir: process.cwd(), contents: `
      import { app } from 'electron';
      import fs from 'node:fs';
      import { resolveAppInstance } from './electron/appInstance';
      import { setupSingleInstanceLock } from './electron/singleInstance';
      const profile = resolveAppInstance({ defaultUserData: ${JSON.stringify(path.join(temporary, 'profile'))}, isPackaged: process.argv.includes('--installed') });
      fs.mkdirSync(profile.userData, { recursive: true });
      app.setPath('userData', profile.userData);
      app.setPath('sessionData', profile.userData);
      const locked = setupSingleInstanceLock({ requestLock: () => app.requestSingleInstanceLock(), quit: () => {}, onSecondInstance: cb => app.on('second-instance', cb), getWindows: () => [] });
      app.whenReady().then(() => process.stdout.write('LIRA_LOCK:' + JSON.stringify({ locked, userData: app.getPath('userData') }) + '\\n', () => { if (!locked) app.exit(0); }));
      setTimeout(() => app.exit(0), 30000);
    ` }, outfile: entry, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'silent' })
    async function launch(installed) {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
      const child = spawn(require('electron'), [entry, ...(installed ? ['--installed'] : [])], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      const closed = new Promise(resolve => child.once('close', resolve))
      children.push({ child, closed })
      return new Promise((resolve, reject) => {
        let output = ''; let errors = ''
        const timer = setTimeout(() => reject(new Error('Electron lock fixture timed out: ' + errors.slice(-500))), 10000)
        child.once('error', error => { clearTimeout(timer); reject(error) })
        child.stderr.on('data', data => { errors += data })
        child.stdout.on('data', data => {
          output += data
          const match = output.match(/LIRA_LOCK:(\{[^\n]+\})/)
          if (match) { clearTimeout(timer); resolve(JSON.parse(match[1])) }
        })
        child.once('close', () => { clearTimeout(timer); reject(new Error('Electron exited without lock result: ' + errors.slice(-500))) })
      })
    }
    const installed = await launch(true)
    const dev = await launch(false)
    assert.equal(installed.locked, true)
    assert.equal(dev.locked, true)
    assert.notEqual(dev.userData, installed.userData)
    assert.equal((await launch(true)).locked, false)
    assert.equal((await launch(false)).locked, false)
  } finally {
    for (const { child } of children) if (child.exitCode === null) child.kill()
    await Promise.all(children.map(({ closed }) => closed))
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(temporary).startsWith('lira-instance-test-'))
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})
