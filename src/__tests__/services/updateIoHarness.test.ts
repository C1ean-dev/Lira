import { afterAll, beforeAll, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createUpdateIoHarness } from '../helpers/updateIoHarness'

let root: string
let harness: ReturnType<typeof createUpdateIoHarness>
beforeAll(() => {
  if (process.platform !== 'win32') return
  root = mkdtempSync(path.join(os.tmpdir(), 'lira-io-harness-'))
  harness = createUpdateIoHarness(root)
})
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }) })

it.skipIf(process.platform !== 'win32')('reuses the compiled production helper while isolating process state and passing literal arguments', () => {
  const script = path.join(root, 'probe.ps1')
  writeFileSync(script, `param([string]$Value)
. '${path.resolve('build/update-io.ps1').replace(/'/g, "''")}'
$previous = [LiraUpdateIO]::FilesCopied
[LiraUpdateIO]::FilesCopied = 42
@{ Previous = $previous; Value = $Value } | ConvertTo-Json -Compress
`)
  const value = "space [value] ' quoted $literal"
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(JSON.parse(harness.run(script, { Value: value }))).toEqual({ Previous: 0, Value: value })
  }
})
