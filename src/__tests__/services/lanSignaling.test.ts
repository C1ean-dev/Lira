import { describe, expect, it } from 'vitest'
import { getLanAddresses, startLocalSignalingServer } from '../../../electron/lanSignaling'
import { EventEmitter } from 'node:events'
import { vi } from 'vitest'

describe('local signaling addresses', () => {
  it('offers reachable IPv4 adapters, excludes loopback and deduplicates interfaces', () => {
    const adapter = (address: string, internal = false, family = 'IPv4') => ({ address, internal, family }) as any
    expect(getLanAddresses({ Ethernet: [adapter('192.168.1.20'), adapter('fe80::1', false, 'IPv6')],
      Loopback: [adapter('127.0.0.1', true)], VPN: [adapter('10.0.0.4'), adapter('192.168.1.20')],
      Disconnected: [adapter('169.254.1.2')] })).toEqual(['192.168.1.20', '10.0.0.4'])
  })
  it('includes global and private IPv6, preserving brackets and excluding unusable scopes', () => {
    const adapter = (address: string) => ({ address, internal: false, family: 'IPv6' }) as any
    expect(getLanAddresses({ Ethernet: [adapter('2001:db8::20'), adapter('fd12:3456::4'), adapter('fe80::1'),
      adapter('fe90::1'), adapter('::'), adapter('::1'), adapter('ff02::1'), adapter('::ffff:192.168.1.2'),
      adapter('fe80::2%3'), adapter('2001:db8::20')] })).toEqual(['[2001:db8::20]', '[fd12:3456::4]'])
  })
  it('does not advertise IPv6 when the listener has fallen back to IPv4', () => {
    expect(getLanAddresses({ Ethernet: [{ address: '2001:db8::20', internal: false, family: 'IPv6' } as any] }, false)).toEqual([])
  })
})

describe('embedded dual stack signaling', () => {
  function fixture() {
    const attempts: any[] = [], ready = vi.fn(), error = vi.fn()
    const create = vi.fn((options, listening) => {
      const server = new EventEmitter()
      const close = vi.fn()
      attempts.push({ options, server, close, listening: () => listening({ close }) })
      return server
    })
    const controller = startLocalSignalingServer(create, { onReady: ready, onError: error })
    return { attempts, ready, error, controller }
  }
  it('listens on IPv6 with IPv4 compatibility and only advertises readiness after listening', () => {
    const f = fixture()
    expect(f.attempts[0].options).toMatchObject({ host: '::', port: 9000 })
    expect(f.ready).not.toHaveBeenCalled()
    f.attempts[0].listening()
    expect(f.ready).toHaveBeenCalledWith({ port: 9000, ipv6: true })
    f.controller.close()
    expect(f.attempts[0].close).toHaveBeenCalledOnce()
  })
  it.each(['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EPROTONOSUPPORT'])('falls back on the same port when IPv6 is unavailable: %s', code => {
    const f = fixture()
    f.attempts[0].server.emit('error', { code })
    expect(f.attempts[1].options).toMatchObject({ host: '0.0.0.0', port: 9000 })
    f.attempts[1].listening()
    expect(f.ready).toHaveBeenCalledWith({ port: 9000, ipv6: false })
    f.controller.close()
  })
  it('retries an occupied port without losing IPv6 and ignores retired attempts', () => {
    const f = fixture()
    f.attempts[0].server.emit('error', { code: 'EADDRINUSE' })
    expect(f.attempts[1].options).toMatchObject({ host: '::', port: 9001 })
    f.attempts[0].server.emit('error', { code: 'EADDRINUSE' })
    expect(f.attempts).toHaveLength(2)
    f.controller.close()
    f.attempts[1].listening()
    expect(f.ready).not.toHaveBeenCalled()
    expect(f.attempts[1].close).toHaveBeenCalledOnce()
  })
})
