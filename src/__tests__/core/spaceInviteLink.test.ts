import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeAllInvite, encodeDirectInvite, encodeLanInvite } from '../../p2p/directInvite'
import { createNativeSpaceInviteLink, createSpaceInviteLink, MAX_SPACE_INVITE_LINK_LENGTH, normalizeSpaceInvite, readSpaceInviteLink, readSpaceInviteWebLink, spaceInviteRoom } from '../../utils/spaceInviteLink'
import { createSpaceInviteInbox } from '../../../electron/spaceInviteInbox'
import { useRoomJoinStore } from '../../store/useRoomJoinStore'

const offer = () => ({ version: 1 as const, kind: 'offer' as const, session: 'session-Test123', room: 'ROOM',
  host: 'lira-ROOM-host', guest: 'lira-ROOM-peer-Test', expiresAt: Date.now() + 600000,
  description: { type: 'offer' as const, sdp: 'v=0\r\na=MixedCase+/-_\r\n' } })

afterEach(() => { vi.useRealTimers(); useRoomJoinStore.getState().clear() })

describe('space invitation links', () => {
  it('copies a standard HTTPS invitation that messaging apps can recognize', () => {
    const link = new URL(createSpaceInviteLink('ROOM-42'))
    expect(link.protocol).toBe('https:')
    expect(link.hash).toBe('#invite=ROOM-42')
    expect(link.origin + link.pathname).toBe('https://lira-signaling.onrender.com/join')
    expect(link.search).toBe('')
    expect(normalizeSpaceInvite(link.href)).toBe('ROOM-42')
  })
  it.each([
    'https://example.com/join#invite=ROOM',
    'https://lira-signaling.onrender.com/join#invite=ROOM&invite=OTHER',
    'https://user:password@lira-signaling.onrender.com/join#invite=ROOM',
    'https://lira-signaling.onrender.com/join?url=evil#invite=ROOM',
    'https://lira-signaling.onrender.com/join#invite=lira%3A%2F%2Fjoin%3Finvite%3DROOM',
    'https://lira-signaling.onrender.com/join#invite=https%3A%2F%2Fexample.com',
  ])('rejects malformed HTTPS invitations: %s', link => {
    expect(() => readSpaceInviteWebLink(link)).toThrow(/inválido/)
  })
  it('round trips complete invites with all routes without changing their case', () => {
    const invite = encodeAllInvite({ version: 1, room: 'ROOM', signaling: 'render',
      ipv6: { addresses: ['[2001:db8::20]'], port: 9000 }, direct: offer() })
    expect(readSpaceInviteWebLink(createSpaceInviteLink(invite))).toBe(invite)
    expect(readSpaceInviteLink(createNativeSpaceInviteLink(invite))).toBe(invite)
    expect(normalizeSpaceInvite(`  ${createSpaceInviteLink(invite)}  `)).toBe(invite)
    expect(spaceInviteRoom(invite)).toBe('ROOM')
    expect(spaceInviteRoom(createSpaceInviteLink(invite))).toBe('ROOM')
  })

  it.each([() => 'room-42', () => encodeLanInvite({ room: 'ROOM', host: '192.168.1.20', port: 9000 }),
    () => encodeDirectInvite(offer())])('also supports ordinary codes, LAN and direct offers', make => {
    const invite = make()
    expect(readSpaceInviteWebLink(createSpaceInviteLink(invite))).toBe(normalizeSpaceInvite(invite))
  })

  it.each(['https://join?invite=ROOM', 'lira://other?invite=ROOM', 'lira://join/path?invite=ROOM',
    'lira://user@join?invite=ROOM', 'lira://join:9000?invite=ROOM', 'lira://join?invite=ROOM#other',
    'lira://join', 'lira://join?invite=', 'lira://join?invite=ROOM&invite=OTHER',
    'lira://join?invite=ROOM&command=quit', 'lira://join?invite=LIRA-ALL%3Abroken',
    'lira://join?invite=lira%3A%2F%2Fjoin%3Finvite%3DROOM', 'lira://join?invite=%3Cscript%3E'])('rejects malformed or ambiguous links: %s', link => {
    expect(() => readSpaceInviteLink(link)).toThrow(/inválido/)
  })

  it('rejects an answer used as an invitation', () => {
    expect(() => createSpaceInviteLink(encodeDirectInvite({ ...offer(), kind: 'answer', description: { type: 'answer', sdp: 'v=0' } }))).toThrow()
  })

  it('keeps the online route usable when the embedded direct offer expires', () => {
    vi.useFakeTimers()
    const direct = encodeDirectInvite(offer())
    const invite = encodeAllInvite({ version: 1, room: 'ROOM', signaling: 'render', direct: offer() })
    const link = createSpaceInviteLink(invite)
    vi.advanceTimersByTime(600001)
    expect(readSpaceInviteWebLink(link)).toBe(invite)
    expect(() => createSpaceInviteLink(direct)).toThrow(/expirado/)
  })

  it('bounds OS command line size without breaking the original complete invite', () => {
    const large = encodeAllInvite({ version: 1, room: 'ROOM', direct: {
      ...offer(), description: { type: 'offer', sdp: 'v=0' + 'x'.repeat(30000) },
    } })
    expect(normalizeSpaceInvite(large)).toBe(large)
    expect(() => createSpaceInviteLink(large)).toThrow(/grande demais/)
    expect(() => readSpaceInviteLink('lira://join?invite=' + 'x'.repeat(MAX_SPACE_INVITE_LINK_LENGTH))).toThrow()
  })
})

describe('OS invitation delivery', () => {
  it('keeps a startup invite until the renderer subscribes and consumes it only once', () => {
    const notify = vi.fn()
    const inbox = createSpaceInviteInbox(notify)
    const link = createNativeSpaceInviteLink('ROOM')
    inbox.receiveArgv(['Lira.exe', '--', link])
    expect(notify).toHaveBeenCalledOnce()
    expect(inbox.take()).toBe(link)
    expect(inbox.take()).toBeNull()
  })

  it('delivers a second launch, replaces a pending invite and ignores invalid URLs', () => {
    const inbox = createSpaceInviteInbox(vi.fn())
    inbox.receive(createNativeSpaceInviteLink('FIRST'))
    inbox.receiveArgv(['Lira.exe', '--', createNativeSpaceInviteLink('SECOND')])
    expect(inbox.receive('lira://join?invite=<script>')).toBe(false)
    expect(inbox.take()).toBe(createNativeSpaceInviteLink('SECOND'))
  })

  it('passes the full case-sensitive payload through the room join store', () => {
    const invite = encodeAllInvite({ version: 1, room: 'ROOM', signaling: 'render', direct: offer() })
    const inbox = createSpaceInviteInbox(() => {})
    inbox.receiveArgv([createNativeSpaceInviteLink(invite)])
    useRoomJoinStore.getState().requestJoin(inbox.take()!)
    expect(useRoomJoinStore.getState().pendingRoomCode).toBe(invite)
    useRoomJoinStore.getState().requestJoin('lira://invalid')
    expect(useRoomJoinStore.getState().pendingRoomCode).toBe(invite)
  })
})
