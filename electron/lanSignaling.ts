import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import { isIP } from 'node:net'

export function getLanAddresses(interfaces: Record<string, NetworkInterfaceInfo[] | undefined> = networkInterfaces(), ipv6 = true): string[] {
  return [...new Set(Object.values(interfaces).flatMap(items => (items || []).flatMap(item => {
    if (item.internal) return []
    if (item.family === 'IPv4' && !item.address.startsWith('169.254.')) return [item.address]
    // Global unicast and ULA addresses need no interface-specific zone ID.
    // Link-local addresses cannot be used in a portable internet invitation.
    if (ipv6 && item.family === 'IPv6' && isIP(item.address) === 6
      && /^(?:[23][0-9a-f]{3}|f[cd][0-9a-f]{2}):/i.test(item.address)) return [`[${item.address}]`]
    return []
  })))]
}

type BoundServer = { close: () => unknown }
type CreateServer = (options: { host: string; port: number; path: string; allow_discovery: boolean },
  listening: (server: BoundServer) => void) => { on: (event: 'error', listener: (error: NodeJS.ErrnoException) => void) => unknown }

export function startLocalSignalingServer(create: CreateServer, callbacks: {
  onReady: (state: { port: number; ipv6: boolean }) => void
  onError: (error: unknown) => void
}, initialPort = 9000) {
  let stopped = false, generation = 0
  let bound: BoundServer | undefined
  const closeBound = () => { try { bound?.close() } catch { } bound = undefined }
  function attempt(port: number, host: '::' | '0.0.0.0') {
    const ticket = ++generation
    let listening = false
    const onError = (error: NodeJS.ErrnoException) => {
      if (stopped || ticket !== generation) return
      if (listening) { callbacks.onError(error); return }
      if (error.code === 'EADDRINUSE' && port < Math.min(initialPort + 31, 65535)) attempt(port + 1, host)
      else if (host === '::' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'].includes(error.code || '')) attempt(port, '0.0.0.0')
      else callbacks.onError(error)
    }
    try {
      const server = create({ host, port, path: '/', allow_discovery: true }, httpServer => {
        if (stopped || ticket !== generation) { httpServer.close(); return }
        listening = true
        bound = httpServer
        callbacks.onReady({ port, ipv6: host === '::' })
      })
      server.on('error', onError)
    } catch (error) { onError(error as NodeJS.ErrnoException) }
  }
  // Node's IPv6 wildcard listener accepts IPv4-mapped clients by default.
  attempt(initialPort, '::')
  return { close: () => { stopped = true; generation++; closeBound() } }
}
