import { describe, expect, it } from 'vitest'
import { encodeDirectInvite, decodeDirectInvite, encodeLanInvite, decodeLanInvite, encodeAllInvite, decodeAllInvite, type AllInvite } from '../../p2p/directInvite'

const invitation = { version: 1 as const, kind: 'offer' as const, session: 'session-123', room: 'ROOM',
  host: 'lira-ROOM-host', guest: 'lira-ROOM-peer-abc', expiresAt: Date.now() + 600000,
  description: { type: 'offer' as const, sdp: 'v=0\r\ns=conexão\r\n' } }

describe('portable direct invitations', () => {
  it('round trips complete connection descriptions without uppercasing or losing Unicode', () => {
    expect(decodeDirectInvite(encodeDirectInvite(invitation))).toEqual(invitation)
  })
  it('rejects expired, oversized, mismatched identities and malformed descriptions', () => {
    for (const value of [ { ...invitation, expiresAt: 1 }, { ...invitation, host: 'lira-OTHER-host' },
      { ...invitation, guest: invitation.host }, { ...invitation, description: { type: 'answer', sdp: 'v=0' } } ]) {
      expect(() => decodeDirectInvite(encodeDirectInvite(value as any))).toThrow()
    }
    expect(() => decodeDirectInvite('LIRA-DIRECT:' + 'x'.repeat(200000))).toThrow()
  })
  it('supports LAN addresses and excludes credentials, paths and unrelated URLs', () => {
    const lan = { room: 'ROOM', host: '192.168.1.20', port: 9001 }
    expect(decodeLanInvite(encodeLanInvite(lan))).toEqual(lan)
    for (const host of ['user:secret@host', 'https://host/path', 'host/path']) {
      expect(() => decodeLanInvite(encodeLanInvite({ ...lan, host }))).toThrow()
    }
  })
  it('round trips IPv6 address invitations and rejects malformed IPv6 literals', () => {
    const invite = { room: 'ROOM', host: '[2001:db8:1234::20]', port: 9000 }
    expect(decodeLanInvite(encodeLanInvite(invite))).toEqual(invite)
    for (const host of ['[:::]', '[1:2:3]', '[12345::1]', '[fe80::1%3]', '[::1]:9000', '2001:db8::20']) {
      expect(() => decodeLanInvite(encodeLanInvite({ ...invite, host }))).toThrow()
    }
  })
})

describe('complete invitations', () => {
  const invite: AllInvite = { version: 1, room: 'ROOM', signaling: 'render',
    ipv6: { addresses: ['[2001:db8::20]'], port: 9000 }, direct: invitation }

  it('keeps all available routes and tolerates an expired direct offer while other routes remain', () => {
    expect(decodeAllInvite(encodeAllInvite(invite))).toEqual(invite)
    const expired = { ...invitation, expiresAt: 1 }
    expect(decodeAllInvite(encodeAllInvite({ ...invite, direct: expired }))).toEqual({ ...invite, direct: undefined })
    expect(() => decodeAllInvite(encodeAllInvite({ version: 1, room: 'ROOM', direct: expired }))).toThrow()
  })

  it('rejects another room’s offer, private IPv6 and invalid ports', () => {
    for (const value of [
      { ...invite, direct: { ...invitation, room: 'OTHER' } },
      { ...invite, ipv6: { addresses: ['[fd12::20]'], port: 9000 } },
      { ...invite, ipv6: { addresses: ['[2001:db8::20]'], port: 65536 } },
    ]) expect(() => decodeAllInvite(encodeAllInvite(value))).toThrow()
  })
})
