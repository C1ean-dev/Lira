import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ParsecEchoResult } from '../src/types/parsecEcho'

interface ParsecEchoOptions {
  platform: string
  osRelease: string
  packaged: boolean
  executablePath: string
  appData?: string
  programData?: string
}

async function exists(file: string): Promise<boolean> {
  try { return (await fs.stat(file)).isFile() }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function mergeConfig(original: string, executable: string): string {
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : ''
  const content = original.slice(bom.length)
  const newline = content.includes('\n') && !content.includes('\r\n') ? '\n' : '\r\n'
  const settings: Record<string, string> = { host_audio_cancel: '2', echo_app_selection: executable }
  const seen = new Set<string>()
  const lines = content ? content.split(/\r?\n/) : []
  if (lines[lines.length - 1] === '') lines.pop()
  const updated: string[] = []
  for (const line of lines) {
    const key = /^\s*(host_audio_cancel|echo_app_selection)\s*=/.exec(line)?.[1]
    if (!key) updated.push(line)
    else if (!seen.has(key)) {
      updated.push(`${key}=${settings[key]}`)
      seen.add(key)
    }
  }
  for (const [key, value] of Object.entries(settings)) {
    if (!seen.has(key)) updated.push(`${key}=${value}`)
  }
  return bom + updated.join(newline) + newline
}

// Parsec officially supports importing config.txt into config.json on restart:
// https://support.parsec.app/hc/en-us/articles/32381346632596
// The exclusion targets a process tree by executable name; it is not microphone AEC.
export async function configureParsecEcho(options: ParsecEchoOptions): Promise<ParsecEchoResult> {
  const [major, , build] = options.osRelease.split('.').map(Number)
  if (options.platform !== 'win32' || !(major >= 10 && build >= 19043)) {
    return { ok: false, error: 'Esta integração requer Windows 10 21H1 ou mais recente.' }
  }
  if (!options.packaged) {
    return { ok: false, error: 'Use a versão instalada do Lira para configurar o Parsec.' }
  }
  const executable = path.win32.basename(options.executablePath)
  if (!/^[^\x00-\x1f\x7f<>:"/\\|?*=]+\.exe$/i.test(executable) || /^electron\.exe$/i.test(executable)) {
    return { ok: false, error: 'Não foi possível identificar o executável instalado do Lira.' }
  }

  let temporary: string | undefined
  try {
    const directories = [...new Set([options.appData, options.programData]
      .filter((base): base is string => !!base && path.isAbsolute(base))
      .map(base => path.join(base, 'Parsec')))]
    const installed: string[] = []
    for (const directory of directories) {
      if (await exists(path.join(directory, 'config.txt')) || await exists(path.join(directory, 'config.json'))) {
        installed.push(directory)
      }
    }
    if (installed.length === 0) return { ok: false, error: 'Parsec não encontrado. Instale e abra o Parsec neste computador antes de configurar.' }
    if (installed.length > 1) return { ok: false, error: 'Foram encontradas duas configurações do Parsec. Abra a configuração da instalação em uso e defina host_audio_cancel=2 e echo_app_selection=' + executable + '.' }

    const configPath = path.join(installed[0], 'config.txt')
    const hadConfig = await exists(configPath)
    const original = hadConfig ? await fs.readFile(configPath, 'utf8') : ''
    // Do not silently corrupt a file saved in an unsupported encoding.
    if (original.includes('\uFFFD') || original.includes('\0')) {
      return { ok: false, error: 'Salve o config.txt do Parsec em UTF-8 antes de configurar a proteção.' }
    }
    const updated = mergeConfig(original, executable)
    if (updated === original) return { ok: true, restartRequired: true, configPath }

    // Modern Parsec stores the previous selection in JSON, even when config.txt
    // is empty. Keep that state too, before Parsec imports our changes on restart.
    const jsonPath = path.join(installed[0], 'config.json')
    const jsonBackup = await exists(jsonPath) ? `${jsonPath}.lira-backup-${randomUUID()}` : undefined
    if (jsonBackup) await fs.copyFile(jsonPath, jsonBackup, constants.COPYFILE_EXCL)
    const textBackup = hadConfig ? `${configPath}.lira-backup-${randomUUID()}` : undefined
    if (textBackup) await fs.copyFile(configPath, textBackup, constants.COPYFILE_EXCL)
    const candidate = `${configPath}.lira-${randomUUID()}.tmp`
    // Create exclusively and only remove a temporary file that belongs to this call.
    const handle = await fs.open(candidate, 'wx')
    temporary = candidate
    try { await handle.writeFile(updated, 'utf8') }
    finally { await handle.close() }
    await fs.rename(candidate, configPath)
    temporary = undefined
    return { ok: true, restartRequired: true, configPath, backupPath: jsonBackup ?? textBackup }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return { ok: false, error: code === 'EACCES' || code === 'EPERM'
      ? 'Sem permissão para salvar a configuração do Parsec. Edite o config.txt pelo Parsec: host_audio_cancel=2 e echo_app_selection=' + executable + '.'
      : 'Não foi possível salvar a configuração do Parsec. Feche o Parsec e tente novamente.' }
  } finally {
    if (temporary) await fs.unlink(temporary).catch(() => {})
  }
}
