import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`
const PAYLOAD_BUFFER_BYTES = 4 * 1024 * 1024
const DEFAULT_CALL_TIMEOUT_MS = 60_000

const WORKER_SCRIPT = `
const { parentPort, workerData } = require('node:worker_threads')
const { spawn } = require('node:child_process')
const { createInterface } = require('node:readline')

const control = new Int32Array(workerData.controlSab)
const payload = new Uint8Array(workerData.payloadSab)
const READY_MARKER = '__LIRA_READY__'
const RES_PREFIX = '__LIRA_RES__'

const ps = spawn('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', workerData.runnerScript,
  '-Assembly', workerData.assembly,
], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })

let stderr = ''
let closed = false
let inFlight = false
ps.stderr.on('data', chunk => { stderr += String(chunk) })

function complete(isError, text) {
  if (!inFlight) return
  inFlight = false
  const bytes = Buffer.from(text, 'utf8')
  const len = Math.min(bytes.length, payload.byteLength)
  payload.set(bytes.subarray(0, len), 0)
  Atomics.store(control, 1, len)
  Atomics.store(control, 2, isError ? 1 : 0)
  Atomics.store(control, 0, 1)
  Atomics.notify(control, 0)
}

const rl = createInterface({ input: ps.stdout })
rl.on('line', line => {
  if (line === READY_MARKER) {
    complete(false, 'ready')
    return
  }
  if (!line.startsWith(RES_PREFIX)) return
  try {
    const parsed = JSON.parse(line.slice(RES_PREFIX.length))
    if (parsed.ok) complete(false, typeof parsed.out === 'string' ? parsed.out : '')
    else complete(true, typeof parsed.error === 'string' ? parsed.error : 'PowerShell error')
  } catch (err) {
    complete(true, 'Invalid PowerShell worker response: ' + String(err))
  }
})

ps.on('error', err => {
  closed = true
  complete(true, 'PowerShell worker error: ' + err.message)
})

ps.on('close', code => {
  closed = true
  complete(true, 'PowerShell worker exited (code ' + code + '): ' + stderr.trim())
})

inFlight = true

parentPort.on('message', msg => {
  if (msg.type === 'close') {
    if (!closed) {
      try {
        ps.stdin.write('__LIRA_EXIT__\\n')
        ps.stdin.end()
      } catch {}
    }
    setTimeout(() => {
      if (!closed) { try { ps.kill() } catch {} }
      process.exit(0)
    }, 500).unref()
    ps.once('close', () => process.exit(0))
    return
  }
  if (msg.type === 'run') {
    if (closed) {
      inFlight = true
      complete(true, 'PowerShell worker is closed: ' + stderr.trim())
      return
    }
    inFlight = true
    ps.stdin.write(JSON.stringify({ Script: msg.script, Parameters: msg.parameters }) + '\\n', 'utf8')
  }
})
`

const RUNNER_PS1 = `param([string]$Assembly)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$null = [Reflection.Assembly]::LoadFrom($Assembly)
[Console]::WriteLine('__LIRA_READY__')
while ($null -ne ($line = [Console]::ReadLine())) {
  if ($line -eq '__LIRA_EXIT__') { break }
  try {
    $request = $line | ConvertFrom-Json
    [LiraUpdateIO]::SourceReadBytes = 0
    [LiraUpdateIO]::VerificationReadBytes = 0
    [LiraUpdateIO]::FilesCopied = 0
    $params = @{}
    if ($null -ne $request.Parameters) {
      foreach ($prop in $request.Parameters.PSObject.Properties) {
        $params[$prop.Name] = [string]$prop.Value
      }
    }
    $captured = (& $request.Script @params | Out-String)
    $payload = @{ ok = $true; out = $captured } | ConvertTo-Json -Compress
    [Console]::WriteLine('__LIRA_RES__' + $payload)
  } catch {
    $msg = if ($_.Exception) { $_.Exception.Message } else { [string]$_ }
    $payload = @{ ok = $false; error = $msg } | ConvertTo-Json -Compress
    [Console]::WriteLine('__LIRA_RES__' + $payload)
  }
}
`

function resolveCacheDirectory(): string {
  const preferred = path.resolve('node_modules/.cache/lira-test-io')
  try {
    mkdirSync(preferred, { recursive: true })
    return preferred
  } catch {
    const fallback = path.join(os.tmpdir(), 'lira-test-io')
    mkdirSync(fallback, { recursive: true })
    return fallback
  }
}

/** Compile build/update-io.ps1 once per content hash and share the DLL across parallel test workers. */
export function ensureCompiledUpdateIoAssembly(): string {
  const source = readFileSync(path.resolve('build/update-io.ps1'), 'utf8')
  if (!source.includes('Add-Type -TypeDefinition')) throw new Error('Update IO compilation entry point changed')
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 16)
  const cacheDir = resolveCacheDirectory()
  const targetAssembly = path.join(cacheDir, `update-io-${hash}.dll`)
  if (existsSync(targetAssembly)) return targetAssembly

  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const tempAssembly = path.join(cacheDir, `update-io-${hash}-${unique}.dll`)
  const tempCompiler = path.join(cacheDir, `compile-io-${unique}.ps1`)
  try {
    writeFileSync(tempCompiler, source.replace('Add-Type -TypeDefinition', `Add-Type -OutputAssembly ${literal(tempAssembly)} -TypeDefinition`))
    const code = `$ErrorActionPreference = 'Stop'; & ${literal(tempCompiler)}`
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64'),
    ], { windowsHide: true, encoding: 'utf8', stdio: 'pipe' })
    try {
      renameSync(tempAssembly, targetAssembly)
    } catch {
      // Another worker finished publishing the exact same content-addressed DLL first.
      if (!existsSync(targetAssembly)) throw new Error('Failed to publish compiled update-io assembly')
    }
    return targetAssembly
  } finally {
    rmSync(tempCompiler, { force: true })
    rmSync(tempAssembly, { force: true })
  }
}

/** Share one compiled C# assembly and one persistent PowerShell process per suite for fast, isolated runs. */
export function createUpdateIoHarness(directory: string) {
  const assembly = ensureCompiledUpdateIoAssembly()
  const runnerScript = path.join(directory, 'run-io-worker.ps1')
  writeFileSync(runnerScript, RUNNER_PS1, 'utf8')

  const controlSab = new SharedArrayBuffer(12)
  const payloadSab = new SharedArrayBuffer(PAYLOAD_BUFFER_BYTES)
  const control = new Int32Array(controlSab)
  const payload = new Uint8Array(payloadSab)

  const worker = new Worker(WORKER_SCRIPT, {
    eval: true,
    workerData: { assembly, runnerScript, controlSab, payloadSab },
  })
  worker.unref()

  const awaitResponse = (timeoutMs = DEFAULT_CALL_TIMEOUT_MS): string => {
    const status = Atomics.wait(control, 0, 0, timeoutMs)
    if (status === 'timed-out') {
      throw new Error(`PowerShell test worker timed out after ${timeoutMs}ms`)
    }
    const len = Atomics.load(control, 1)
    const isError = Atomics.load(control, 2) === 1
    const text = Buffer.from(payload.slice(0, len)).toString('utf8')
    if (isError) throw new Error(text)
    return text
  }

  // Wait for the persistent PowerShell process to load the assembly and signal ready.
  awaitResponse(DEFAULT_CALL_TIMEOUT_MS)

  let closed = false
  return {
    run(script: string, parameters: Record<string, string>) {
      if (closed) throw new Error('Update IO harness is already closed')
      Atomics.store(control, 0, 0)
      worker.postMessage({ type: 'run', script, parameters })
      return awaitResponse(DEFAULT_CALL_TIMEOUT_MS)
    },
    close(): Promise<void> {
      if (closed) return Promise.resolve()
      closed = true
      return new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); resolve() }
        const timer = setTimeout(() => { void worker.terminate().finally(done) }, 2000)
        timer.unref()
        worker.once('exit', done)
        worker.postMessage({ type: 'close' })
      })
    },
  }
}
