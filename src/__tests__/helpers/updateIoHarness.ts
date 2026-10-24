import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`
const powershell = (code: string) => execFileSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64'),
], { windowsHide: true, encoding: 'utf8', stdio: 'pipe' })

/** Compile the real production source once; each invocation still gets a fresh process. */
export function createUpdateIoHarness(directory: string) {
  const assembly = path.join(directory, 'update-io.dll')
  const compiler = path.join(directory, 'compile-io.ps1')
  const source = readFileSync(path.resolve('build/update-io.ps1'), 'utf8')
  if (!source.includes('Add-Type -TypeDefinition')) throw new Error('Update IO compilation entry point changed')
  writeFileSync(compiler, source.replace('Add-Type -TypeDefinition', `Add-Type -OutputAssembly ${literal(assembly)} -TypeDefinition`))
  powershell(`$ErrorActionPreference = 'Stop'; & ${literal(compiler)}`)
  return {
    run(script: string, parameters: Record<string, string>) {
      const entries = Object.entries(parameters).map(([key, value]) => `${literal(key)} = ${literal(value)}`).join('; ')
      return powershell(`$ErrorActionPreference = 'Stop'; Add-Type -Path ${literal(assembly)}; $parameters = @{ ${entries} }; & ${literal(script)} @parameters`)
    },
  }
}
