import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { downloadUpdateFile, updateDownloadErrorMessage } from '../../../electron/updateFileDownload'

const servers: Server[] = []
const folders: string[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()) })))
  await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })))
})
async function fixture(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const folder = await mkdtemp(path.join(tmpdir(), 'lira-update-test-'))
  folders.push(folder)
  return { url: `http://127.0.0.1:${(server.address() as any).port}`, file: path.join(folder, 'installer.tmp') }
}
describe('update download recovery', () => {
  it('times out a stalled response, closes its file and restarts the transfer', async () => {
    let attempts = 0
    const f = await fixture((_req, res) => {
      res.writeHead(200, { 'Content-Length': '8' })
      if (++attempts === 1) { res.write('old'); return }
      res.end('new-data')
    })
    await downloadUpdateFile(f.url, f.file, vi.fn(), { timeoutMs: 50, delay: async () => {} })
    expect(attempts).toBe(2)
    expect(await readFile(f.file, 'utf8')).toBe('new-data')
  })
  it('retries temporary server errors and follows relative redirects without saving their body', async () => {
    let attempts = 0
    const f = await fixture((req, res) => {
      if (req.url === '/file') return void res.end('complete installer')
      if (++attempts === 1) { res.writeHead(503); res.end('unavailable'); return }
      res.writeHead(302, { Location: '/file' }); res.end('redirect body')
    })
    const delay = vi.fn(async () => {})
    await downloadUpdateFile(f.url, f.file, vi.fn(), { delay })
    expect(await readFile(f.file, 'utf8')).toBe('complete installer')
    expect(attempts).toBe(2)
    expect(delay).toHaveBeenCalledOnce()
  })
  it('restarts a broken response without appending stale bytes and caps progress until saving completes', async () => {
    let attempts = 0
    const f = await fixture((_req, res) => {
      res.writeHead(200, { 'Content-Length': '8' })
      if (++attempts === 1) { res.write('old'); setImmediate(() => res.destroy()); return }
      res.end('new-data')
    })
    const progress = vi.fn()
    await downloadUpdateFile(f.url, f.file, progress, { delay: async () => {} })
    expect(await readFile(f.file, 'utf8')).toBe('new-data')
    expect(attempts).toBe(2)
    expect(progress.mock.calls.every(([percent]) => percent < 100)).toBe(true)
  })
  it('does not retry a missing release or create an installer from an error page', async () => {
    let attempts = 0
    const f = await fixture((_req, res) => { attempts++; res.writeHead(404); res.end('not found') })
    await expect(downloadUpdateFile(f.url, f.file, vi.fn(), { delay: async () => {} })).rejects.toMatchObject({ status: 404 })
    expect(attempts).toBe(1)
    await expect(readFile(f.file)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('stops after three temporary failures and leaves no partial installer', async () => {
    let attempts = 0
    const f = await fixture((_req, res) => { attempts++; res.writeHead(502); res.end() })
    await expect(downloadUpdateFile(f.url, f.file, vi.fn(), { delay: async () => {} })).rejects.toMatchObject({ status: 502 })
    expect(attempts).toBe(3)
  })
  it('rejects a file whose size differs from the release even without Content-Length', async () => {
    const f = await fixture((_req, res) => { res.write('partial'); res.end() })
    await expect(downloadUpdateFile(f.url, f.file, vi.fn(), { expectedSize: 100, attempts: 1 })).rejects.toMatchObject({ code: 'UPDATE_INCOMPLETE' })
    await expect(readFile(f.file)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('reports distinguishable network, disk and server failures without exposing download URLs', () => {
    expect(updateDownloadErrorMessage({ code: 'ENOTFOUND' })).toMatch(/conexão|internet/i)
    expect(updateDownloadErrorMessage({ code: 'ENOSPC' })).toMatch(/espaço/i)
    expect(updateDownloadErrorMessage({ code: 'EACCES' })).toMatch(/permissão|bloque/i)
    expect(updateDownloadErrorMessage({ status: 503 })).toContain('503')
    expect(updateDownloadErrorMessage(new Error('https://secret.test/token'))).not.toContain('secret.test')
  })
})
