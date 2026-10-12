import WebSocket from 'ws'
import type { PlaybackConnection } from './spotifyPlayback'

export async function playbackJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(2500), redirect: 'error' })
  if (!response.ok) throw new Error('Não foi possível conectar aos controles do Spotify.')
  return response.json()
}

export function connectPlayback(url: string): Promise<PlaybackConnection> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { handshakeTimeout: 2500, maxPayload: 3_000_000 })
    const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
    let id = 0
    const fail = (error: Error) => {
      for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error) }
      pending.clear()
    }
    socket.on('error', error => { reject(error); fail(error) })
    socket.on('close', () => { const error = new Error('A conexão com o Spotify foi encerrada.'); reject(error); fail(error) })
    socket.on('message', data => {
      let message: any
      try { message = JSON.parse(data.toString()) } catch { return }
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      clearTimeout(entry.timer)
      if (message.error) entry.reject(new Error('O Spotify não respondeu ao controle.'))
      else entry.resolve(message.result)
    })
    socket.once('open', () => resolve({
      request: (method, params, timeoutMs = 2500) => new Promise((resolveRequest, rejectRequest) => {
        if (socket.readyState !== WebSocket.OPEN) { rejectRequest(new Error('Spotify desconectado.')); return }
        const requestId = ++id
        const timer = setTimeout(() => { pending.delete(requestId); rejectRequest(new Error('O Spotify demorou para responder.')) }, timeoutMs)
        pending.set(requestId, { resolve: resolveRequest, reject: rejectRequest, timer })
        socket.send(JSON.stringify({ id: requestId, method, params }), error => {
          if (!error) return
          pending.delete(requestId)
          clearTimeout(timer)
          rejectRequest(error)
        })
      }),
      close: () => { fail(new Error('Conexão encerrada.')); socket.close() },
    }))
  })
}
