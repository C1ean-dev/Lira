import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function testSuites() {
  const nodeReporter = pathToFileURL(path.join(root, 'scripts/quiet-node-reporter.mjs')).href
  const nodeTest = (name, flag, file, extra = []) => ({
    name, command: process.execPath,
    args: ['--test', ...extra, '--test-reporter', nodeReporter, path.join(root, file)],
    env: { [flag]: '1' },
  })
  return [
    { name: 'unit', command: process.execPath, args: [path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs'), 'run', 'src/__tests__', '--maxWorkers=2', '--reporter', path.join(root, 'scripts/quiet-vitest-reporter.mjs')] },
    { name: 'migration', command: process.env.LIRA_PYTHON || 'python', args: [path.join(root, 'scripts/quiet-unittest.py'), path.join(root, 'scripts/test_migrate_individual_library.py')] },
    nodeTest('core:browser', 'LIRA_RUN_BROWSER_TESTS', 'scripts/core-realtime.browser.test.mjs', ['--test-force-exit']),
    nodeTest('sprites:electron', 'LIRA_RUN_SPRITE_TESTS', 'scripts/individual-library.electron.test.mjs'),
    nodeTest('transcription:electron', 'LIRA_RUN_TRANSCRIPTION_TESTS', 'scripts/transcription-module.electron.test.mjs'),
  ]
}

export function executeSuite(suite) {
  return new Promise(resolve => {
    const child = spawn(suite.command, suite.args, { cwd: root, env: { ...process.env, ...suite.env }, stdio: 'inherit', shell: false })
    child.once('error', error => { console.error(`[ERRO] ${suite.name}: ${error.message}`); resolve(1) })
    child.once('close', (code, signal) => {
      const result = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1)
      if (result) console.error(`[ERRO] ${suite.name}: execução encerrada com código ${result}`)
      resolve(result)
    })
  })
}

export async function runSuites(suites = testSuites(), execute = executeSuite) {
  for (const suite of suites) {
    const code = await execute(suite)
    if (code !== 0) return code
  }
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runSuites()
}
