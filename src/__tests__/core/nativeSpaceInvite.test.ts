import { describe, expect, it } from 'vitest'
import { gzipSync } from 'node:zlib'
import { expandNativeSpaceInvite } from '../../../electron/nativeSpaceInvite'
import { createSpaceInviteInbox } from '../../../electron/spaceInviteInbox'
import { encodeAllInvite } from '../../p2p/directInvite'
import { readSpaceInviteLink } from '../../utils/spaceInviteLink'

const compressed = (text: string) => 'lira://join?inviteGzip=' + gzipSync(text).toString('base64url')

describe('compressed Windows invitation transport', () => {
  it('preserves complete long invitations across native delivery below the Windows URL limit', () => {
    const invite = encodeAllInvite({ version: 1, room: 'ROOM', signaling: 'render', direct: {
      version: 1, kind: 'offer', room: 'ROOM', session: 'long-session', host: 'lira-ROOM-host', guest: 'lira-ROOM-peer-Guest',
      expiresAt: Date.now() + 600000, description: { type: 'offer', sdp: 'v=0\r\n' + 'a=candidate:MixedCase 192.168.1.20\r\n'.repeat(60) },
    } })
    expect(invite.length).toBeGreaterThan(2081)
    expect(compressed(invite).length).toBeLessThan(2081)
    const inbox = createSpaceInviteInbox(() => {})
    expect(inbox.receive(compressed(invite))).toBe(true)
    expect(readSpaceInviteLink(inbox.take()!)).toBe(invite)
  })
  it.each(['lira://join?inviteGzip=broken', 'lira://other?inviteGzip=a',
    compressed('lira://join?invite=ROOM'), compressed('https://example.com'),
    compressed('x'.repeat(200000))])('rejects malformed, nested or unbounded data', link => {
    expect(() => expandNativeSpaceInvite(link)).toThrow(/inválido/)
  })
  it('continues accepting existing uncompressed links', () => {
    expect(expandNativeSpaceInvite('lira://join?invite=ROOM')).toBe('lira://join?invite=ROOM')
  })
})
