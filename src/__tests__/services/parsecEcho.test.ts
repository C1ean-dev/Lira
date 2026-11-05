import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { configureParsecEcho } from '../../../electron/parsecEcho'

let root: string
let options: Parameters<typeof configureParsecEcho>[0]
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lira-parsec-test-'))
  options = { platform: 'win32', osRelease: '10.0.19043', packaged: true,
    executablePath: 'C:\\Program Files\\Lira\\Lira.exe', appData: path.join(root, 'user'), programData: path.join(root, 'shared') }
})
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }) })

async function install(base = options.appData, content = '# Parsec\r\nencoder_bitrate=35\r\nhost_audio_cancel=1\r\necho_app_selection=discord.exe\r\n') {
  const directory = path.join(base!, 'Parsec')
  await fs.mkdir(directory, { recursive: true })
  const file = path.join(directory, 'config.txt')
  await fs.writeFile(file, content)
  return file
}

describe('Parsec call echo integration', () => {
  it('excludes the running Lira executable, preserves other settings and backs up the original', async () => {
    const file = await install()
    const original = await fs.readFile(file, 'utf8')
    const result = await configureParsecEcho(options)
    expect(result).toMatchObject({ ok: true, restartRequired: true, configPath: file })
    expect(await fs.readFile(file, 'utf8')).toBe('# Parsec\r\nencoder_bitrate=35\r\nhost_audio_cancel=2\r\necho_app_selection=Lira.exe\r\n')
    expect(await fs.readFile(result.backupPath!, 'utf8')).toBe(original)
  })

  it('supports the shared installation and custom executable names', async () => {
    const file = await install(options.programData, 'encoder_fps=60\n')
    const result = await configureParsecEcho({ ...options, executablePath: 'D:\\Apps\\Meu Lira.exe' })
    expect(result.ok).toBe(true)
    expect(await fs.readFile(file, 'utf8')).toBe('encoder_fps=60\nhost_audio_cancel=2\necho_app_selection=Meu Lira.exe\n')
  })

  it('uses the supported config.txt migration for a JSON-only Parsec installation without changing JSON', async () => {
    const directory = path.join(options.appData!, 'Parsec')
    await fs.mkdir(directory, { recursive: true })
    const json = '{"encoder_bitrate":{"value":35}}'
    await fs.writeFile(path.join(directory, 'config.json'), json)
    const result = await configureParsecEcho(options)
    expect(result.ok).toBe(true)
    expect(result.backupPath).toContain('config.json.lira-backup-')
    expect(await fs.readFile(result.backupPath!, 'utf8')).toBe(json)
    expect(await fs.readFile(path.join(directory, 'config.txt'), 'utf8')).toBe('host_audio_cancel=2\r\necho_app_selection=Lira.exe\r\n')
    expect(await fs.readFile(path.join(directory, 'config.json'), 'utf8')).toBe(json)
  })

  it('backs up both configuration formats when the current settings are in JSON', async () => {
    const file = await install()
    const json = '{"echo_app_selection":{"value":"discord.exe"}}'
    await fs.writeFile(path.join(path.dirname(file), 'config.json'), json)
    const result = await configureParsecEcho(options)
    expect(result.ok).toBe(true)
    expect(result.backupPath).toContain('config.json.lira-backup-')
    expect(await fs.readFile(result.backupPath!, 'utf8')).toBe(json)
    const names = await fs.readdir(path.dirname(file))
    expect(names.filter(name => name.startsWith('config.txt.lira-backup-'))).toHaveLength(1)
  })

  it('removes conflicting duplicate keys while preserving comments, BOM and LF endings', async () => {
    const file = await install(options.appData, '\uFEFF# host_audio_cancel=0\nhost_audio_cancel = 1\nhost_audio_cancel=0\necho_app_selection=discord.exe\necho_app_selection=other.exe')
    expect((await configureParsecEcho(options)).ok).toBe(true)
    expect(await fs.readFile(file, 'utf8')).toBe('\uFEFF# host_audio_cancel=0\nhost_audio_cancel=2\necho_app_selection=Lira.exe\n')
  })

  it('is idempotent and still asks for a restart when configuration is already staged', async () => {
    const file = await install(options.appData, 'host_audio_cancel=2\necho_app_selection=Lira.exe\n')
    expect(await configureParsecEcho(options)).toMatchObject({ ok: true, restartRequired: true })
    expect(await fs.readdir(path.dirname(file))).toEqual(['config.txt'])
  })

  it.each([
    { platform: 'linux' }, { osRelease: '10.0.19042' }, { packaged: false },
    { executablePath: 'C:\\Electron\\electron.exe' }, { executablePath: 'C:\\Lira\ninjected.exe' },
  ])('refuses unsupported hosts or unsafe executable names: %j', async (override) => {
    const file = await install()
    const original = await fs.readFile(file, 'utf8')
    expect(await configureParsecEcho({ ...options, ...override })).toMatchObject({ ok: false })
    expect(await fs.readFile(file, 'utf8')).toBe(original)
  })

  it('does not create configuration for an absent Parsec installation', async () => {
    expect(await configureParsecEcho(options)).toMatchObject({ ok: false, error: expect.stringContaining('não encontrado') })
    expect(await fs.readdir(root)).toEqual([])
  })

  it('does not guess when both per-user and shared configurations exist', async () => {
    const user = await install()
    const shared = await install(options.programData)
    expect(await configureParsecEcho(options)).toMatchObject({ ok: false, error: expect.stringContaining('duas') })
    expect(await fs.readFile(user, 'utf8')).toContain('echo_app_selection=discord.exe')
    expect(await fs.readFile(shared, 'utf8')).toContain('echo_app_selection=discord.exe')
  })

  it('leaves the original intact when saving fails and returns an actionable error', async () => {
    const file = await install()
    const original = await fs.readFile(file, 'utf8')
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    expect(await configureParsecEcho(options)).toMatchObject({ ok: false, error: expect.stringContaining('permissão') })
    expect(await fs.readFile(file, 'utf8')).toBe(original)
    expect((await fs.readdir(path.dirname(file))).some(name => name.endsWith('.tmp'))).toBe(false)
  })

  it('does not change the configuration if it cannot create the backup', async () => {
    const file = await install()
    const original = await fs.readFile(file, 'utf8')
    vi.spyOn(fs, 'copyFile').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    expect(await configureParsecEcho(options)).toMatchObject({ ok: false })
    expect(await fs.readFile(file, 'utf8')).toBe(original)
  })

  it('refuses to corrupt a UTF-16 configuration', async () => {
    const file = await install()
    const original = Buffer.from('\uFEFFencoder_fps=60\r\n', 'utf16le')
    await fs.writeFile(file, original)
    expect(await configureParsecEcho(options)).toMatchObject({ ok: false, error: expect.stringContaining('UTF-8') })
    expect(await fs.readFile(file)).toEqual(original)
  })
})
