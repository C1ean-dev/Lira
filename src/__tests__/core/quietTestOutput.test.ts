import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { DefaultReporter } from 'vitest/node'
import QuietVitestReporter from '../../../scripts/quiet-vitest-reporter.mjs'
import quietNodeReporter from '../../../scripts/quiet-node-reporter.mjs'
import { runSuites, testSuites } from '../../../scripts/test-all.mjs'

const temporary: string[] = []
afterEach(() => { vi.restoreAllMocks(); temporary.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })) })
function fixture(name: string, content: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lira-quiet-tests-'))
  temporary.push(dir)
  const file = path.join(dir, name)
  writeFileSync(file, content)
  return file
}
async function nodeEvents(...events: unknown[]) {
  async function* source() { yield* events }
  let output = ''
  for await (const chunk of quietNodeReporter(source())) output += chunk
  return output
}

describe('quiet test:all output', () => {
  it.each([0, 4999, 5000, 5000.1, 6000])('uses a strict 5000ms threshold for Vitest (%s ms)', duration => {
    const reporter = new QuietVitestReporter()
    const log = vi.spyOn(reporter, 'log').mockImplementation(() => {})
    reporter.onTestCaseResult({ fullName: 'room > move', module: { moduleId: '/tests/room.test.ts' }, result: () => ({ state: 'passed' }), diagnostic: () => ({ duration }) })
    expect(log).toHaveBeenCalledTimes(duration > 5000 ? 1 : 0)
    if (duration > 5000) expect(log.mock.calls[0][0]).toContain('room > move')
  })

  it('hides Vitest progress and summaries while retaining its native error report', () => {
    const reporter = new QuietVitestReporter()
    const banner = vi.fn()
    reporter.onInit({ config: {}, logger: { printBanner: banner } })
    reporter.onTestModuleEnd({})
    reporter.reportTestSummary([], [], 0)
    expect(banner).not.toHaveBeenCalled()
    expect(reporter.onTestRunEnd).toBe(DefaultReporter.prototype.onTestRunEnd)
  })

  it('keeps warnings outside test cases but hides normal logs', () => {
    const reporter = new QuietVitestReporter()
    const output = vi.spyOn(reporter, 'error').mockImplementation(() => {})
    reporter.onUserConsoleLog({ type: 'stdout', content: 'normal progress\n' })
    reporter.onUserConsoleLog({ type: 'stderr', content: 'warning from a passing test\n' })
    reporter.onUserConsoleLog({ type: 'stdout', content: '[Warning] check this\n' })
    expect(output.mock.calls.map(([message]) => message)).toEqual(['[AVISO] warning from a passing test', '[AVISO] [Warning] check this'])
  })

  it('discards simulated failures and warnings once a Vitest test passes, including late logs', () => {
    const reporter = new QuietVitestReporter()
    const output = vi.spyOn(reporter, 'error').mockImplementation(() => {})
    reporter.onUserConsoleLog({ taskId: 'expected-failure', type: 'stderr', content: 'Error: simulated microphone failure' })
    reporter.onUserConsoleLog({ taskId: 'expected-failure', type: 'stderr', content: 'Warning: expected fallback' })
    expect(output).not.toHaveBeenCalled()
    reporter.onTestCaseResult({ id: 'expected-failure', result: () => ({ state: 'passed' }), diagnostic: () => ({ duration: 10 }) })
    reporter.onUserConsoleLog({ taskId: 'expected-failure', type: 'stderr', content: 'Error: late simulated failure' })
    expect(output).not.toHaveBeenCalled()
  })

  it('keeps diagnostic notices for failed Vitest tests, including late logs', () => {
    const reporter = new QuietVitestReporter()
    const output = vi.spyOn(reporter, 'error').mockImplementation(() => {})
    reporter.onUserConsoleLog({ taskId: 'broken', type: 'stderr', content: 'Error: useful failure context' })
    reporter.onTestCaseResult({ id: 'broken', result: () => ({ state: 'failed' }), diagnostic: () => ({ duration: 10 }) })
    reporter.onUserConsoleLog({ taskId: 'broken', type: 'stderr', content: 'Warning: late failure context' })
    expect(output.mock.calls).toEqual([
      ['[ERRO] Error: useful failure context'], ['[AVISO] Warning: late failure context'],
    ])
  })

  it('compacts repeated console warnings and excludes stacks and batched diagnostic progress', () => {
    const reporter = new QuietVitestReporter()
    const output = vi.spyOn(reporter, 'error').mockImplementation(() => {})
    for (let index = 0; index < 20; index++) {
      reporter.onUserConsoleLog({ type: 'stderr', content: 'Error: expected microphone failure\n    at simulated.test.ts:1:1\n    at runner.js:2:2\n' })
    }
    reporter.onUserConsoleLog({ type: 'stdout', content: "[diag:media] capture failed {\n  error: 'simulated',\n}\nnormal progress\nWarning: actual warning\n" })
    expect(output.mock.calls).toEqual([
      ['[ERRO] Error: expected microphone failure'],
      ['[AVISO] Warning: actual warning'],
    ])
  })

  it('shows only slow Node tests, warnings and complete error details', async () => {
    const output = await nodeEvents(
      { type: 'test:pass', data: { name: 'fast', details: { duration_ms: 5000 } } },
      { type: 'test:pass', data: { name: 'slow media', file: 'media.test.mjs', details: { duration_ms: 5000.1 } } },
      { type: 'test:diagnostic', data: { message: 'all images decoded' } },
      { type: 'test:stdout', data: { message: 'ordinary console log\n' } },
      { type: 'test:stderr', data: { message: 'DeprecationWarning: obsolete call\n' } },
      { type: 'test:fail', data: { name: 'broken', details: { duration_ms: 2, error: new Error('assertion failed\nwith context') } } },
    )
    expect(output).not.toContain('fast')
    expect(output).not.toContain('all images decoded')
    expect(output).not.toContain('ordinary console log')
    expect(output).toContain('slow media')
    expect(output).toContain('5000.1')
    expect(output).toContain('DeprecationWarning')
    expect(output).toContain('broken')
    expect(output).toContain('assertion failed')
    expect(output).toContain('with context')
  })

  it('works with the real Node test runner and preserves failure exit status', () => {
    const file = fixture('example.test.mjs', `import test from 'node:test'; import assert from 'node:assert/strict';
      test('quick success', () => console.log('hidden progress'));
      test('quick failure', () => { console.warn('keep this warning'); assert.equal(1, 2, 'failure context'); });`)
    const result = spawnSync(process.execPath, ['--test', '--test-reporter', pathToFileURL(path.resolve('scripts/quiet-node-reporter.mjs')).href, file], { encoding: 'utf8', timeout: 20000 })
    expect(result.status, result.stderr).toBe(1)
    const output = result.stdout + result.stderr
    expect(output).not.toContain('quick success')
    expect(output).not.toContain('hidden progress')
    expect(output).toContain('quick failure')
    expect(output).toContain('keep this warning')
    expect(output).toContain('failure context')
  })

  it('preserves real Vitest assertion and collection errors without passing-test output', () => {
    const file = fixture('example.test.mjs', `import { it, expect } from ${JSON.stringify(pathToFileURL(path.resolve('node_modules/vitest/dist/index.js')).href)};
      it('quick success', () => { console.log('hidden progress'); console.error('simulated passing error'); console.warn('simulated passing warning'); expect(() => { throw Error('expected'); }).toThrow('expected'); });
      it.fails('expected failing test', () => { console.error('expected fails output'); expect(1).toBe(2); });
      it('quick failure', () => { console.warn('keep Vitest warning'); expect(1, 'Vitest failure context').toBe(2); });`)
    const config = path.join(path.dirname(file), 'vitest.config.mjs')
    writeFileSync(config, `export default { test: { include: ['*.test.mjs'], maxWorkers: 1, reporters: [${JSON.stringify(path.resolve('scripts/quiet-vitest-reporter.mjs'))}] } }`)
    writeFileSync(path.join(path.dirname(file), 'collection.test.mjs'), "throw new Error('collection failure context')")
    const result = spawnSync(process.execPath, [path.resolve('node_modules/vitest/vitest.mjs'), 'run', '--root', path.dirname(file), '--config', config], { encoding: 'utf8', timeout: 20000 })
    expect(result.status, result.stderr).toBe(1)
    const output = result.stdout + result.stderr
    expect(output).not.toMatch(/[✓✔].*quick success/)
    expect(result.stdout).not.toContain('hidden progress')
    expect(output).not.toMatch(/\[(?:ERRO|AVISO)\].*(?:simulated passing|expected fails output)/)
    expect(output).not.toContain('Test Files')
    expect(output).not.toContain(' RUN ')
    expect(output).toContain('keep Vitest warning')
    expect(output).toContain('quick failure')
    expect(output).toContain('Vitest failure context')
    expect(output).toContain('collection failure context')
    expect(output).toContain('Expected')
  }, 30000)

  it('keeps Python warnings, slow tests and assertion tracebacks without progress or OK summaries', () => {
    const file = fixture('example_test.py', `import unittest, warnings
class Example(unittest.TestCase):
    def test_pass(self):
        print('hidden progress')
        warnings.warn('keep Python warning')
    def test_fail(self):
        self.assertEqual(1, 2, 'Python failure context')
if __name__ == '__main__':
    unittest.main()
`)
    const result = spawnSync('python', [path.resolve('scripts/quiet-unittest.py'), file, '--slow-ms', '0'], { encoding: 'utf8', timeout: 20000 })
    expect(result.status).toBe(1)
    const output = result.stdout + result.stderr
    expect(output).not.toContain('hidden progress')
    expect(output).not.toContain('Ran 2 tests')
    expect(output).toContain('keep Python warning')
    expect(output).toContain('test_pass')
    expect(output).toContain('Python failure context')
    expect(output).toContain('Traceback')
  })

  it('runs suites sequentially and stops on the first nonzero exit code', async () => {
    const execute = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(7)
    const suites = [{ name: 'unit' }, { name: 'migration' }, { name: 'browser' }]
    expect(await runSuites(suites, execute)).toBe(7)
    expect(execute.mock.calls.map(([suite]) => suite.name)).toEqual(['unit', 'migration'])
  })

  it('returns success after every suite succeeds', async () => {
    const execute = vi.fn().mockResolvedValue(0)
    const suites = [{ name: 'unit' }, { name: 'migration' }]
    expect(await runSuites(suites, execute)).toBe(0)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('keeps all five suites, opt-in flags, aliases and the individual verbose commands', () => {
    const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(scripts['test:all']).toBe('node scripts/test-all.mjs')
    expect(scripts['teste:all']).toBe('npm run test:all')
    expect(scripts.test).not.toContain('quiet')
    const suites = testSuites()
    expect(suites.map(suite => suite.name)).toEqual(['unit', 'migration', 'core:browser', 'sprites:electron', 'transcription:electron'])
    for (const [name, flag] of [['core:browser', 'LIRA_RUN_BROWSER_TESTS'], ['sprites:electron', 'LIRA_RUN_SPRITE_TESTS'], ['transcription:electron', 'LIRA_RUN_TRANSCRIPTION_TESTS']]) {
      const suite = suites.find(suite => suite.name === name)!
      expect(suite.env[flag]).toBe('1')
      expect(suite.args).toContain('--test-reporter')
    }
  })
})
