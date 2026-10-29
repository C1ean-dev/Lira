import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

test('locate timing instability in saved Lira conversation recordings', {
  skip: !process.env.LIRA_DIAGNOSE_AUDIO_OUTPUT, timeout: 240000,
}, async () => {
  const output = path.resolve(process.env.LIRA_DIAGNOSE_AUDIO_OUTPUT)
  for (const args of [
    ['-m', 'unittest', 'discover', '-s', 'scripts/noise-benchmark', '-p', 'test_call_diagnostics.py'],
    ['scripts/noise-benchmark/call_diagnostics.py', output],
  ]) await new Promise((resolve, reject) => {
    const child = spawn('python', ['-B', ...args], { stdio: 'inherit', windowsHide: true,
      env: { ...process.env, OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' } })
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error('Diagnostic scorer failed: ' + code)))
  })
  const report = JSON.parse(await fs.readFile(path.join(output, 'call-diagnostics.json'), 'utf8'))
  assert.ok(report.length > 0)
  for (const row of report) for (const window of row.windows) {
    assert.ok(Number.isFinite(window.delayMs) && window.delayMs >= 0)
    assert.ok(window.correlation >= 0 && window.correlation <= 1.0000001)
  }
})
