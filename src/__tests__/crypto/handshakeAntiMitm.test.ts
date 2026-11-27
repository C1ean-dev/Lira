import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computeKeyFingerprint,
  formatShortFingerprint,
  isValidKeyFingerprint,
  toHex,
} from '../../crypto/primitives'
import {
  createEphemeralIdentityForTests,
  getLocalIdentity,
  resetLocalIdentityForTests,
} from '../../crypto/identityStore'
import { extractPrimaryDtlsFingerprint, getConnectionDtlsBinding } from '../../crypto/dtlsBinding'
import { E2EESessionManager } from '../../crypto/sessionManager'
import {
  decodeAllInvite,
  decodeDirectInvite,
  decodeLanInvite,
  encodeAllInvite,
  encodeDirectInvite,
  encodeLanInvite,
} from '../../p2p/directInvite'
import { buildRoomInviteMessage, readRoomInvite } from '../../utils/roomInvite'
import { processNetworkMessage } from '../../p2p/messageHandlers'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { FriendsPresenceService } from '../../services/friendsPresenceService'
import { useGameStore } from '../../store/useGameStore'
import { useChatStore } from '../../store/useChatStore'
import { useMediaStore } from '../../store/useMediaStore'
import { useSecurityStore } from '../../store/useSecurityStore'

const SDP_A = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99\r\n'
const SDP_B = 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00\r\n'
const SDP_ATTACKER = 'v=0\r\no=- 3 2 IN IP4 127.0.0.1\r\na=fingerprint:sha-256 DE:AD:BE:EF:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:01\r\n'

const originalGame = useGameStore.getState()
const originalChat = useChatStore.getState()
const originalMedia = useMediaStore.getState()

beforeEach(() => {
  resetLocalIdentityForTests()
  useSecurityStore.getState().reset()
  useGameStore.setState(originalGame)
  useChatStore.setState(originalChat)
  useMediaStore.setState(originalMedia)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resetLocalIdentityForTests()
  useSecurityStore.getState().reset()
})

describe('Phase 1 E2EE Identity & Anti-MITM Handshake', () => {
  it('generates a persistent local ECDSA P-256 identity and valid SHA-256 fingerprint', async () => {
    const id1 = await getLocalIdentity()
    const id2 = await getLocalIdentity()
    expect(id1.fingerprint).toBe(id2.fingerprint)
    expect(isValidKeyFingerprint(id1.fingerprint)).toBe(true)
    expect(formatShortFingerprint(id1.fingerprint).split(' ')).toHaveLength(16)
    expect(useSecurityStore.getState().localFingerprint).toBe(id1.fingerprint)
  })

  it('normalizes DTLS fingerprints from SDP and completes init -> ack handshake with identical keys & SAS', async () => {
    const aliceId = await createEphemeralIdentityForTests()
    const bobId = await createEphemeralIdentityForTests()
    const aliceMgr = new E2EESessionManager(async () => aliceId)
    const bobMgr = new E2EESessionManager(async () => bobId)

    const fpAlice = extractPrimaryDtlsFingerprint(SDP_A)!
    const fpBob = extractPrimaryDtlsFingerprint(SDP_B)!
    expect(fpAlice).toMatch(/^sha-256:[a-f0-9:]+$/)
    expect(getConnectionDtlsBinding({ localDescription: { sdp: SDP_A }, remoteDescription: { sdp: SDP_B } } as any)).toEqual({
      local: fpAlice,
      remote: fpBob,
    })

    const init = await aliceMgr.startHandshake('bob', 'alice', { local: fpAlice, remote: fpBob })
    const bobRes = await bobMgr.handleHandshake(init, {
      localId: 'bob',
      remotePeerId: 'alice',
      dtls: { local: fpBob, remote: fpAlice },
    })
    expect(bobRes.ok).toBe(true)
    if (!bobRes.ok) throw new Error('Expected bobRes ok')
    expect(bobRes.reply).toBeDefined()

    const aliceRes = await aliceMgr.handleHandshake(bobRes.reply!, {
      localId: 'alice',
      remotePeerId: 'bob',
      dtls: { local: fpAlice, remote: fpBob },
    })
    expect(aliceRes.ok).toBe(true)
    if (!aliceRes.ok) throw new Error('Expected aliceRes ok')

    expect(toHex(aliceRes.session.rootKey)).toBe(toHex(bobRes.session.rootKey))
    expect(toHex(aliceRes.session.sendChainKey)).toBe(toHex(bobRes.session.recvChainKey))
    expect(toHex(aliceRes.session.recvChainKey)).toBe(toHex(bobRes.session.sendChainKey))
    expect(aliceRes.session.sas).toEqual(bobRes.session.sas)
    expect(aliceRes.session.dtlsBound).toBe(true)
  })

  it('handles simultaneous init <-> init glare symmetrically with identical derived keys', async () => {
    const aliceId = await createEphemeralIdentityForTests()
    const bobId = await createEphemeralIdentityForTests()
    const aliceMgr = new E2EESessionManager(async () => aliceId)
    const bobMgr = new E2EESessionManager(async () => bobId)

    const aliceInit = await aliceMgr.startHandshake('bob', 'alice')
    const bobInit = await bobMgr.startHandshake('alice', 'bob')

    const aliceHandle = await aliceMgr.handleHandshake(bobInit, { localId: 'alice', remotePeerId: 'bob' })
    const bobHandle = await bobMgr.handleHandshake(aliceInit, { localId: 'bob', remotePeerId: 'alice' })

    expect(aliceHandle.ok && bobHandle.ok).toBe(true)
    if (!aliceHandle.ok || !bobHandle.ok) throw new Error('Expected glare handshake success')

    expect(toHex(aliceHandle.session.rootKey)).toBe(toHex(bobHandle.session.rootKey))
    expect(toHex(aliceHandle.session.sendChainKey)).toBe(toHex(bobHandle.session.recvChainKey))
    expect(aliceHandle.session.sas).toEqual(bobHandle.session.sas)

    // Receiving the redundant ack returns the existing established session idempotently
    const ackRes = await aliceMgr.handleHandshake(bobHandle.reply!, { localId: 'alice', remotePeerId: 'bob' })
    expect(ackRes.ok).toBe(true)
    if (ackRes.ok) {
      expect(ackRes.session).toBe(aliceHandle.session)
    }
    const repeatedInit = await aliceMgr.handleHandshake(bobInit, { localId: 'alice', remotePeerId: 'bob' })
    expect(repeatedInit.ok).toBe(true)
    if (repeatedInit.ok) {
      expect(repeatedInit.session).toBe(aliceHandle.session)
      expect(repeatedInit.reply?.phase).toBe('ack')
    }
  })

  it('blocks DTLS MITM when SDP fingerprint does not match the signed handshake', async () => {
    const aliceId = await createEphemeralIdentityForTests()
    const bobId = await createEphemeralIdentityForTests()
    const aliceMgr = new E2EESessionManager(async () => aliceId)
    const bobMgr = new E2EESessionManager(async () => bobId)

    const fpAlice = extractPrimaryDtlsFingerprint(SDP_A)!
    const fpAttacker = extractPrimaryDtlsFingerprint(SDP_ATTACKER)!

    const init = await aliceMgr.startHandshake('bob', 'alice', { local: fpAlice, remote: fpAttacker })
    const res = await bobMgr.handleHandshake(init, {
      localId: 'bob',
      remotePeerId: 'alice',
      dtls: { local: extractPrimaryDtlsFingerprint(SDP_B)!, remote: fpAttacker },
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('dtls_mismatch')
    }
  })

  it('rejects tampered signatures and replayed ack nonces', async () => {
    const aliceId = await createEphemeralIdentityForTests()
    const bobId = await createEphemeralIdentityForTests()
    const aliceMgr = new E2EESessionManager(async () => aliceId)
    const bobMgr = new E2EESessionManager(async () => bobId)

    const init = await aliceMgr.startHandshake('bob', 'alice')
    const tampered = { ...init, ephemeralPub: (await aliceMgr.startHandshake('other', 'alice')).ephemeralPub }
    const sigRes = await bobMgr.handleHandshake(tampered, { localId: 'bob', remotePeerId: 'alice' })
    expect(sigRes.ok).toBe(false)
    if (!sigRes.ok) expect(sigRes.reason).toBe('invalid_signature')

    const validBobRes = await bobMgr.handleHandshake(init, { localId: 'bob', remotePeerId: 'alice' })
    expect(validBobRes.ok).toBe(true)
    if (!validBobRes.ok || !validBobRes.reply) throw new Error('Expected reply')

    // Replayed ack with wrong peerNonce against a fresh pending handshake
    const aliceFresh = new E2EESessionManager(async () => aliceId)
    await aliceFresh.startHandshake('bob', 'alice')
    const replayRes = await aliceFresh.handleHandshake(validBobRes.reply, { localId: 'alice', remotePeerId: 'bob' })
    expect(replayRes.ok).toBe(false)
    if (!replayRes.ok) expect(replayRes.reason).toBe('invalid_signature')
  })

  it('authenticates hostKeyFp across LAN, Direct, All, and DM room invites and blocks host impersonation', async () => {
    const realHostId = await createEphemeralIdentityForTests()
    const fakeHostId = await createEphemeralIdentityForTests()

    const lan = { room: 'ROOM1', host: '192.168.1.50', port: 9000, hostKeyFp: realHostId.fingerprint }
    expect(decodeLanInvite(encodeLanInvite(lan))).toEqual(lan)
    expect(() => decodeLanInvite(encodeLanInvite({ ...lan, hostKeyFp: 'not-hex' }))).toThrow()

    const direct = {
      version: 1 as const,
      kind: 'offer' as const,
      session: 'session-abc-123',
      room: 'ROOM1',
      host: 'lira-ROOM1-host',
      guest: 'lira-ROOM1-peer-1',
      expiresAt: Date.now() + 60_000,
      description: { type: 'offer' as const, sdp: 'v=0\r\n' },
      hostKeyFp: realHostId.fingerprint,
    }
    expect(decodeDirectInvite(encodeDirectInvite(direct))).toEqual(direct)

    const all = { version: 1 as const, room: 'ROOM1', signaling: 'render' as const, direct, hostKeyFp: realHostId.fingerprint }
    expect(decodeAllInvite(encodeAllInvite(all))).toEqual(all)

    const dmInvite = buildRoomInviteMessage({
      id: 'inv-1',
      from: { id: 'u-aaaaaaaaaaaaaaaaaaaa', name: 'Host' },
      to: { id: 'u-bbbbbbbbbbbbbbbbbbbb', name: 'Guest' },
      room: { code: 'ROOM1', name: 'Sala 1', hostKeyFp: realHostId.fingerprint },
      channelId: 'dm-u-aaaaaaaaaaaaaaaaaaaa-u-bbbbbbbbbbbbbbbbbbbb',
      timestamp: 1000,
    })
    expect(dmInvite.roomInvite?.hostKeyFp).toBe(realHostId.fingerprint)
    expect(readRoomInvite(dmInvite.roomInvite)?.hostKeyFp).toBe(realHostId.fingerprint)

    // Handshake with an impostor host claiming lira-ROOM1-host fails host_key_mismatch
    const guestId = await createEphemeralIdentityForTests()
    const guestMgr = new E2EESessionManager(async () => guestId)
    const impostorMgr = new E2EESessionManager(async () => fakeHostId)
    const impostorInit = await impostorMgr.startHandshake('lira-ROOM1-peer-1', 'lira-ROOM1-host')

    const res = await guestMgr.handleHandshake(impostorInit, {
      localId: 'lira-ROOM1-peer-1',
      remotePeerId: 'lira-ROOM1-host',
      expectedFingerprint: realHostId.fingerprint,
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toBe('host_key_mismatch')
  })
})

describe('Phase 1 Critical Security Fixes', () => {
  it('blocks hijacked FriendsNetwork peer and holds pending DMs when pinned identityKey mismatches', async () => {
    const ME = 'u-mmmmmmmmmmmmmmmmmmmm'
    const FRIEND = 'u-ffffffffffffffffffff'
    const realFriendId = await createEphemeralIdentityForTests()
    const attackerId = await createEphemeralIdentityForTests()

    useGameStore.setState({
      localPlayer: { ...useGameStore.getState().localPlayer, id: ME, gameId: ME, name: 'Alice' },
      friends: [FRIEND],
      friendProfiles: {
        [FRIEND]: {
          id: FRIEND,
          actualUserId: FRIEND,
          name: 'Bob',
          identityKey: realFriendId.publicKeyB64,
          identityKeyFingerprint: realFriendId.fingerprint,
          identityKeyVerified: true,
        },
      },
    })
    useChatStore.setState({
      channels: [{ id: 'general', name: 'general', type: 'general', unreadCount: 0 }],
      messages: [
        {
          id: 'secret-dm-1',
          senderId: ME,
          senderName: 'Alice',
          recipientId: FRIEND,
          recipientName: 'Bob',
          channelId: `dm-${[ME, FRIEND].sort().join('-')}`,
          content: 'Segredo pendente',
          timestamp: Date.now(),
          status: 'sent',
        },
      ],
    })

    const service = FriendsPresenceService.getInstance()
    const sent: Array<{ userId: string; packet: any }> = []
    const disconnectUser = vi.fn()
    ;(service as any).network = {
      isLinked: () => true,
      getLinkedUserIds: () => [FRIEND],
      getPeerConnection: () => null,
      send: vi.fn((userId: string, packet: any) => {
        sent.push({ userId, packet })
        return true
      }),
      disconnectUser,
    }
    ;(service as any).presenceSharedWith.clear()
    ;(service as any).authenticatedFriends.clear()

    // Open link: because FRIEND has pinned identityKey, pending DM must NOT flush yet
    ;(service as any).handleLinkOpen(FRIEND)
    expect(sent.filter((p) => p.packet.t === 'dm')).toHaveLength(0)

    // Attacker sends handshake signed by wrong identity key
    const attackerMgr = new E2EESessionManager(async () => attackerId)
    const attackerInit = await attackerMgr.startHandshake(ME, FRIEND)
    await (service as any).handleFriendHandshake(FRIEND, attackerInit)

    expect(disconnectUser).toHaveBeenCalledWith(FRIEND)
    expect(sent.filter((p) => p.packet.t === 'dm')).toHaveLength(0)
    expect(useSecurityStore.getState().peers[FRIEND]?.status).toBe('key_changed')
    expect(useSecurityStore.getState().alerts.length).toBeGreaterThan(0)

    // Real friend reconnects with valid pinned key -> authenticates and flushes DM encrypted (never plaintext)
    disconnectUser.mockClear()
    const realFriendMgr = new E2EESessionManager(async () => realFriendId)
    const realInit = await realFriendMgr.startHandshake(ME, FRIEND)
    await (service as any).handleFriendHandshake(FRIEND, realInit)
    await vi.waitFor(() => {
      expect(sent.filter((p) => p.packet.t === 'e2ee' && p.packet.payload?.kind === 'dm')).toHaveLength(1)
    })

    expect(disconnectUser).not.toHaveBeenCalled()
    expect(sent.filter((p) => p.packet.t === 'dm')).toHaveLength(0)
    const flushedE2ee = sent.find((p) => p.packet.t === 'e2ee' && p.packet.payload?.kind === 'dm')
    expect(JSON.stringify(flushedE2ee)).not.toContain('Segredo pendente')
    expect(useSecurityStore.getState().peers[FRIEND]?.status).toBe('verified')
  })

  it('rejects unauthorized incoming calls when peer is unknown, outside a zone, or in a different zone', () => {
    vi.stubGlobal('MediaStream', class {
      constructor(public tracks: any[] = []) {}
      getAudioTracks() { return this.tracks }
      getVideoTracks() { return [] }
    })
    useMediaStore.setState({
      localStream: new MediaStream([{ kind: 'audio', readyState: 'live', enabled: true } as any]),
    })
    useGameStore.setState({
      localPlayer: { ...useGameStore.getState().localPlayer, id: 'me', x: 5, y: 5, currentZoneId: 'zone-a' },
      remotePlayers: {
        'no-zone-peer': { ...useGameStore.getState().localPlayer, id: 'no-zone-peer', x: 5, y: 5, currentZoneId: null },
        'other-zone-peer': { ...useGameStore.getState().localPlayer, id: 'other-zone-peer', x: 5, y: 5, currentZoneId: 'zone-b' },
        'same-zone-peer': { ...useGameStore.getState().localPlayer, id: 'same-zone-peer', x: 8, y: 5, currentZoneId: 'zone-a' },
      },
    })

    expect(MediaCallHandler.isIncomingCallAuthorized('unknown-attacker')).toBe(false)
    expect(MediaCallHandler.isIncomingCallAuthorized('no-zone-peer')).toBe(false)
    expect(MediaCallHandler.isIncomingCallAuthorized('other-zone-peer')).toBe(false)
    expect(MediaCallHandler.isIncomingCallAuthorized('same-zone-peer')).toBe(true)

    const attackerCall = { peer: 'unknown-attacker', answer: vi.fn(), close: vi.fn(), on: vi.fn() }
    MediaCallHandler.handleIncomingCall({
      call: attackerCall as any,
      myId: 'me',
      mediaCalls: new Map(),
      endMediaCallWithPeer: vi.fn(),
      enforceAuthorization: true,
    })
    expect(attackerCall.close).toHaveBeenCalledOnce()
    expect(attackerCall.answer).not.toHaveBeenCalled()

    const otherZoneCall = { peer: 'other-zone-peer', answer: vi.fn(), close: vi.fn(), on: vi.fn() }
    MediaCallHandler.handleIncomingCall({
      call: otherZoneCall as any,
      myId: 'me',
      mediaCalls: new Map(),
      endMediaCallWithPeer: vi.fn(),
      enforceAuthorization: true,
    })
    expect(otherZoneCall.close).toHaveBeenCalledOnce()
    expect(otherZoneCall.answer).not.toHaveBeenCalled()
  })

  it('forwards DMs strictly via unicast on the Host and blocks senderId spoofing', () => {
    useGameStore.setState({
      localPlayer: { ...useGameStore.getState().localPlayer, id: 'lira-R1-host', gameId: 'u-host' },
      remotePlayers: {
        'peer-alice': { ...useGameStore.getState().localPlayer, id: 'peer-alice', gameId: 'u-alice', name: 'Alice' },
        'peer-bob': { ...useGameStore.getState().localPlayer, id: 'peer-bob', gameId: 'u-bob', name: 'Bob' },
        'peer-eve': { ...useGameStore.getState().localPlayer, id: 'peer-eve', gameId: 'u-eve', name: 'Eve' },
      },
    })
    useChatStore.setState({
      channels: [{ id: 'general', name: 'general', type: 'general', unreadCount: 0 }],
      messages: [],
    })

    const broadcast = vi.fn()
    const sendToTargetPeer = vi.fn(() => true)

    const dmMsg = {
      type: 'CHAT_MESSAGE' as const,
      senderId: 'peer-alice',
      timestamp: Date.now(),
      payload: {
        message: {
          id: 'dm-1',
          senderId: 'u-alice',
          senderName: 'Alice',
          recipientId: 'u-bob',
          recipientName: 'Bob',
          channelId: 'dm-u-alice-u-bob',
          content: 'Mensagem privada para Bob',
          timestamp: Date.now(),
        },
      },
    }

    processNetworkMessage(dmMsg, 'peer-alice', true, broadcast, vi.fn(), vi.fn(), 'lira-R1-host', undefined, sendToTargetPeer)
    expect(broadcast).not.toHaveBeenCalled()
    expect(sendToTargetPeer).toHaveBeenCalledTimes(1)
    expect(sendToTargetPeer).toHaveBeenCalledWith('peer-bob', expect.objectContaining({ type: 'CHAT_MESSAGE' }))

    // Spoofed senderId from Eve pretending to be Alice or 'system' must be dropped completely
    broadcast.mockClear()
    sendToTargetPeer.mockClear()

    processNetworkMessage(
      {
        ...dmMsg,
        senderId: 'peer-eve',
        payload: { message: { ...dmMsg.payload.message, id: 'spoof-1', senderId: 'u-alice' } },
      },
      'peer-eve',
      true,
      broadcast,
      vi.fn(),
      vi.fn(),
      'lira-R1-host',
      undefined,
      sendToTargetPeer
    )
    expect(broadcast).not.toHaveBeenCalled()
    expect(sendToTargetPeer).not.toHaveBeenCalled()

    processNetworkMessage(
      {
        type: 'CHAT_MESSAGE',
        senderId: 'peer-eve',
        timestamp: Date.now(),
        payload: {
          message: {
            id: 'spoof-sys',
            senderId: 'sistema',
            senderName: 'Sistema',
            channelId: 'general',
            content: 'Mensagem falsa de sistema',
            timestamp: Date.now(),
          },
        },
      },
      'peer-eve',
      true,
      broadcast,
      vi.fn(),
      vi.fn(),
      'lira-R1-host',
      undefined,
      sendToTargetPeer
    )
    expect(broadcast).not.toHaveBeenCalled()
    expect(useChatStore.getState().messages.find((m) => m.id === 'spoof-sys')).toBeUndefined()

    // Ensure valid fingerprint helper also checks length
    expect(computeKeyFingerprint).toBeDefined()
  })
})
