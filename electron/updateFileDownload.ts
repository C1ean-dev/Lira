import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'
import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

type Options = { attempts?: number; timeoutMs?: number; expectedSize?: number; delay?: (ms: number) => Promise<void> }
type Failure = Error & { code?: string; status?: number }
function failure(message: string, code: string): Failure { return Object.assign(new Error(message), { code }) }

async function responseFor(url: string, timeoutMs: number, redirects = 0): Promise<IncomingMessage> {
  if (redirects > 10) throw failure('Too many update redirects', 'UPDATE_REDIRECTS')
  const target = new URL(url)
  if (!['http:', 'https:'].includes(target.protocol)) throw failure('Invalid download protocol', 'UPDATE_URL')
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    let received: IncomingMessage | undefined
    const request = (target.protocol === 'https:' ? https : http).get(target,
      { headers: { 'User-Agent': 'lira-updater', Accept: 'application/octet-stream' } }, res => { received = res; resolve(res) })
    request.on('error', error => { received?.destroy(error); reject(error) })
    request.setTimeout(timeoutMs, () => request.destroy(failure('Update download timeout', 'ETIMEDOUT')))
  })
  const status = response.statusCode || 0
  if (status >= 300 && status < 400 && response.headers.location) {
    response.resume()
    return responseFor(new URL(response.headers.location, url).toString(), timeoutMs, redirects + 1)
  }
  if (status !== 200) {
    response.resume()
    throw Object.assign(new Error(`Update server returned HTTP ${status}`), { status })
  }
  return response
}

function temporary(error: Failure): boolean {
  return [408, 429, 500, 502, 503, 504].includes(error.status || 0)
    || ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'UPDATE_INCOMPLETE'].includes(error.code || '')
}

export async function downloadUpdateFile(url: string, file: string,
  progress: (percent: number, downloaded: number, total: number) => void, options: Options = {}): Promise<void> {
  const attempts = Math.max(1, Math.min(3, options.attempts || 3))
  const delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)))
  for (let attempt = 0; attempt < attempts; attempt++) {
    let opened = false
    try {
      progress(0, 0, options.expectedSize || 0)
      const response = await responseFor(url, options.timeoutMs || 60_000)
      const declaredSize = Number(response.headers['content-length']) || 0
      const total = options.expectedSize || declaredSize
      let downloaded = 0
      const count = new Transform({ transform(chunk: Buffer, _encoding, done) {
        downloaded += chunk.length
        try { progress(total ? Math.min(99, Math.floor(downloaded / total * 100)) : 0, downloaded, total); done(null, chunk) }
        catch (error) { done(error as Error) }
      } })
      opened = true
      // Pipeline waits for the file to close and tears down every stream on failure.
      await pipeline(response, count, createWriteStream(file, { flags: 'w' }))
      if (!downloaded || (declaredSize > 0 && downloaded !== declaredSize) || (options.expectedSize && downloaded !== options.expectedSize)) {
        throw failure('Update download size mismatch', 'UPDATE_INCOMPLETE')
      }
      return
    } catch (error) {
      if (opened) await unlink(file).catch(() => {})
      if (attempt + 1 >= attempts || !temporary(error as Failure)) throw error
      await delay(500 * (attempt + 1))
    }
  }
}

export function updateDownloadErrorMessage(error: unknown): string {
  const { code, status } = (error || {}) as Failure
  if (code === 'ENOSPC') return 'Sem espaço no disco para salvar a atualização.'
  if (['EACCES', 'EPERM', 'EBUSY'].includes(code || '')) return 'O Windows bloqueou a gravação da atualização. Verifique as permissões e a proteção do computador.'
  if (status) return `O servidor de atualização respondeu com erro ${status}. Tente novamente em alguns instantes.`
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'].includes(code || '')) return 'A conexão com o servidor de atualização falhou. Verifique a internet e tente novamente.'
  if (code === 'UPDATE_INCOMPLETE') return 'O download da atualização ficou incompleto. Tente novamente.'
  return 'Não foi possível baixar ou salvar a atualização. Tente novamente.'
}
