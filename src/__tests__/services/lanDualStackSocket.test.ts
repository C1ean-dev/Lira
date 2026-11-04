import { expect, it } from 'vitest'
import { createServer, createConnection, type Server, type AddressInfo } from 'node:net'
import { once } from 'node:events'
import { startLocalSignalingServer } from '../../../electron/lanSignaling'

it('accepts IPv6 and IPv4 loopback clients on the dual stack listening path', async context => {
  let server!: Server
  let resolveReady!: (state: { port: number; ipv6: boolean }) => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<{ port: number; ipv6: boolean }>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  const controller = startLocalSignalingServer((options, listening) => {
    const attempt = createServer(socket => socket.end('lira-direct'))
    server = attempt
    // A temporary OS-assigned port keeps this test separate from running apps.
    attempt.listen(0, options.host, () => listening(attempt))
    return attempt
  }, { onReady: resolveReady, onError: rejectReady })
  try {
    const state = await ready
    if (!state.ipv6) { context.skip('IPv6 unavailable on this host; fallback is covered by unit tests'); return }
    const port = (server.address() as AddressInfo).port
    const read = (host: string) => new Promise<string>((resolve, reject) => {
      const socket = createConnection({ host, port })
      let text = ''
      socket.setTimeout(2000, () => socket.destroy(new Error('Loopback connection timed out')))
      socket.on('data', chunk => { text += chunk.toString() })
      socket.on('end', () => resolve(text))
      socket.on('error', reject)
    })
    expect(await Promise.all([read('::1'), read('127.0.0.1')])).toEqual(['lira-direct', 'lira-direct'])
  } finally {
    const closed = server.listening ? once(server, 'close') : Promise.resolve()
    controller.close()
    await closed
  }
}, 10000)
