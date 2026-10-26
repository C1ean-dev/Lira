import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createUpdateIoHarness } from '../helpers/updateIoHarness'

describe.skipIf(process.platform !== 'win32')('installer batch file IO', () => {
  let root: string
  let source: string
  let destination: string
  const helper = path.resolve('build/update-io.ps1')
  let compiledRoot: string
  let ioHarness: ReturnType<typeof createUpdateIoHarness>
  beforeAll(() => {
    compiledRoot = mkdtempSync(path.join(os.tmpdir(), 'lira-compiled-io-'))
    ioHarness = createUpdateIoHarness(compiledRoot)
  })
  afterAll(() => rmSync(compiledRoot, { recursive: true, force: true }))
  const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex').toUpperCase()
  const execute = (body: string, files: { Name: string; Length: number; Hash?: string }[], directories: string[] = []) => {
    const harness = path.join(root, 'batch-test.ps1')
    writeFileSync(path.join(root, 'request.json'), JSON.stringify({ Files: files, Directories: directories }))
    writeFileSync(harness, `param([string]$Helper, [string]$Root)
$ErrorActionPreference = 'Stop'
. $Helper
$source = Join-Path $Root 'saves'
$destination = Join-Path $Root 'copied'
$request = Get-Content -LiteralPath (Join-Path $Root 'request.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$entries = [LiraUpdateFile[]]@($request.Files)
${body}
`)
    return ioHarness.run(harness, { Helper: helper, Root: root })
  }
  const copy = '[LiraUpdateIO]::CopyTree($source, $destination, $entries, [string[]]@($request.Directories), $null)'
  const verify = '[LiraUpdateIO]::VerifyTree($destination, $entries, $false, $null)'

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'lira-batch-test-'))
    source = path.join(root, 'saves')
    destination = path.join(root, 'copied')
    mkdirSync(source)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('snapshots nested files and empty directories without following linked paths', () => {
    mkdirSync(path.join(source, 'nested', 'empty'), { recursive: true })
    writeFileSync(path.join(source, 'nested', 'save.json'), 'save')
    const result = JSON.parse(execute('[LiraUpdateIO]::SnapshotTree($source) | ConvertTo-Json -Depth 5 -Compress', []))
    expect(result.Existed).toBe(true)
    expect(result.Files).toEqual([{ Name: 'nested\\save.json', Length: 4, Hash: null }])
    expect(result.Directories.sort()).toEqual(['nested', 'nested\\empty'])
    const outside = path.join(root, 'outside')
    mkdirSync(outside)
    symlinkSync(outside, path.join(source, 'linked'), 'junction')
    expect(() => execute('[LiraUpdateIO]::SnapshotTree($source)', [])).toThrow()
  })

  it('snapshots missing trees without treating a file as a directory', () => {
    rmSync(source, { recursive: true })
    const result = JSON.parse(execute('[LiraUpdateIO]::SnapshotTree($source) | ConvertTo-Json -Depth 5 -Compress', []))
    expect(result).toEqual({ Existed: false, Files: [], Directories: [] })
    writeFileSync(source, 'file')
    expect(() => execute('[LiraUpdateIO]::SnapshotTree($source)', [])).toThrow()
  })

  it('detects a corrupted destination even when its length is unchanged', () => {
    writeFileSync(path.join(source, 'save.json'), 'original')
    expect(() => execute(`${copy}
[IO.File]::WriteAllText((Join-Path $destination 'save.json'), 'tampered')
${verify}`, [{ Name: 'save.json', Length: 8 }])).toThrow()
    expect(readFileSync(path.join(source, 'save.json'), 'utf8')).toBe('original')
  })

  it('continues copying saves while the progress callback is busy', () => {
    const files = Array.from({ length: 600 }, (_, index) => ({ Name: `${index}.bin`, Length: 4096 }))
    for (const file of files) writeFileSync(path.join(source, file.Name), Buffer.alloc(file.Length, 51))
    const result = JSON.parse(execute(`
$script:first = $true
$script:copiedDuringProgress = 0
$notify = [Action]{
  if ($script:first) {
    $script:first = $false
    $before = [LiraUpdateIO]::FilesCopied
    [Threading.Thread]::Sleep(350)
    $script:copiedDuringProgress = [LiraUpdateIO]::FilesCopied - $before
  }
}
[LiraUpdateIO]::CopyTree($source, $destination, $entries, [string[]]@($request.Directories), $notify)
${verify}
[pscustomobject]@{ CopiedDuringProgress = $script:copiedDuringProgress; FilesCopied = [LiraUpdateIO]::FilesCopied } | ConvertTo-Json -Compress
`, files))
    expect(result.CopiedDuringProgress).toBeGreaterThan(0)
    expect(result.FilesCopied).toBe(files.length)
  }, 30000)

  it('waits for every file writer before returning a progress error', () => {
    const files = Array.from({ length: 300 }, (_, index) => ({ Name: `${index}.bin`, Length: 4096 }))
    for (const file of files) writeFileSync(path.join(source, file.Name), Buffer.alloc(file.Length, 37))
    const result = JSON.parse(execute(`
$caught = $false
try { [LiraUpdateIO]::CopyTree($source, $destination, $entries, [string[]]@($request.Directories), [Action]{ throw 'Progress failed' }) }
catch { $caught = $true }
${verify}
[pscustomobject]@{ Caught = $caught; FilesCopied = [LiraUpdateIO]::FilesCopied } | ConvertTo-Json -Compress
`, files))
    expect(result.Caught).toBe(true)
    expect(result.FilesCopied).toBe(files.length)
  }, 30000)

  it('rejects changed source content and length during recovery', () => {
    writeFileSync(path.join(source, 'save.json'), 'tampered')
    expect(() => execute(copy, [{ Name: 'save.json', Length: 8, Hash: digest('original') }])).toThrow()
    rmSync(destination, { recursive: true, force: true })
    expect(() => execute(copy, [{ Name: 'save.json', Length: 100 }])).toThrow()
    expect(readFileSync(path.join(source, 'save.json'), 'utf8')).toBe('tampered')
  })

  it('preserves an existing destination instead of overwriting it', () => {
    writeFileSync(path.join(source, 'save.json'), 'source')
    mkdirSync(destination)
    writeFileSync(path.join(destination, 'save.json'), 'keep')
    expect(() => execute(copy, [{ Name: 'save.json', Length: 6 }])).toThrow()
    expect(readFileSync(path.join(destination, 'save.json'), 'utf8')).toBe('keep')
  })

  it('rejects file and directory entries outside the requested tree', () => {
    writeFileSync(path.join(root, 'outside.txt'), 'keep')
    expect(() => execute(copy, [{ Name: '..\\outside.txt', Length: 4 }])).toThrow()
    expect(() => execute(copy, [], ['..\\outside-directory'])).toThrow()
    expect(readFileSync(path.join(root, 'outside.txt'), 'utf8')).toBe('keep')
    expect(existsSync(path.join(root, 'outside-directory'))).toBe(false)
  })

  it('refuses to copy through a linked directory', () => {
    const unrelated = path.join(root, 'unrelated')
    mkdirSync(unrelated)
    writeFileSync(path.join(unrelated, 'save.json'), 'keep')
    symlinkSync(unrelated, path.join(source, 'linked'), 'junction')
    expect(() => execute(copy, [{ Name: 'linked\\save.json', Length: 4 }], ['linked'])).toThrow()
    expect(readFileSync(path.join(unrelated, 'save.json'), 'utf8')).toBe('keep')
  })

  it('preserves zero-byte saves and verifies their hash', () => {
    writeFileSync(path.join(source, 'empty.json'), '')
    const result = JSON.parse(execute(`${copy}
${verify}
[pscustomobject]@{ Hash = $entries[0].Hash; FilesCopied = [LiraUpdateIO]::FilesCopied } | ConvertTo-Json -Compress`, [{ Name: 'empty.json', Length: 0 }]))
    expect(result.Hash).toBe(digest(''))
    expect(result.FilesCopied).toBe(1)
    expect(statSync(path.join(destination, 'empty.json')).size).toBe(0)
  })
})
