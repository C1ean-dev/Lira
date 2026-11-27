import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createEphemeralIdentityForTests } from '../../crypto/identityStore'
import { deriveChainStep, randomBytes, utf8Bytes } from '../../crypto/primitives'
import { PairwiseRatchetManager, MAX_SKIPPED_KEYS } from '../../crypto/ratchet'
import { SenderKeyManager } from '../../crypto/senderKeys'
import {
  base64ToUint8Array,
  decryptAttachment,
  encryptAttachment,
  uint8ArrayToBase64,
} from '../../crypto/attachmentCrypto'
import { E2EESessionManager } from '../../crypto/sessionManager'
import { PeerManager } from '../../p2p/PeerManager'
import { FriendsPresenceService } from '../../services/friendsPresenceService'
import { useGameStore } from '../../store/useGameStore'
import { useChatStore } from '../../store/useChatStore'
import { useMapStore } from '../../store/useMapStore'
import { useSecurityStore } from '../../store/useSecurityStore'

const flushAsync = async (turns = 12) => {
  for (let i = 0; i < turns; i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('Phase 2: Chat E2EE (Ratchet, Attachments, SenderKeys, PeerManager, FriendsPresence)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    useSecurityStore.getState().reset()
  })

  describe('PairwiseRatchetManager', () => {
    it('advances symmetric chain with forward secrecy, supports out-of-order up to limit, and blocks replay/tamper/DoS', async () => {
      const rootSend = randomBytes(32)
      const rootRecv = randomBytes(32)

      const alice = new PairwiseRatchetManager()
      const bob = new PairwiseRatchetManager()
      alice.initSession('bob', rootSend, rootRecv)
      bob.initSession('alice', rootRecv, rootSend)

      const env0 = await alice.encryptJson('bob', 'alice', 'bob', { text: 'msg-0' })
      const env1 = await alice.encryptJson('bob', 'alice', 'bob', { text: 'msg-1' })
      const env2 = await alice.encryptJson('bob', 'alice', 'bob', { text: 'msg-2' })

      expect(env0.seq).toBe(0)
      expect(env1.seq).toBe(1)
      expect(env2.seq).toBe(2)
      expect(env0.ciphertext).not.toBe(env1.ciphertext)

      // Anti-DoS: forged ciphertext with seq=200 must NOT advance or wipe Bob's recvChainKey
      await expect(
        bob.decryptJson('alice', {
          ...env0,
          seq: 200,
          ciphertext: env2.ciphertext,
        })
      ).rejects.toThrow()

      // Excessive skip gap (> MAX_SKIPPED_KEYS) is rejected before key derivation
      await expect(
        bob.decryptJson('alice', {
          ...env0,
          seq: MAX_SKIPPED_KEYS + 5,
        })
      ).rejects.toThrow(/exceeds limit/)

      // Out-of-order: deliver seq 2 first, then seq 0 and seq 1 still succeed via skippedKeys
      expect(await bob.decryptJson('alice', env2)).toEqual({ text: 'msg-2' })
      expect(await bob.decryptJson('alice', env0)).toEqual({ text: 'msg-0' })
      expect(await bob.decryptJson('alice', env1)).toEqual({ text: 'msg-1' })

      // Replay rejected
      await expect(bob.decryptJson('alice', env1)).rejects.toThrow(/Replay detected/)

      // Concurrent sends serialize cleanly without seq collision
      const parallel = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          alice.encryptJson('bob', 'alice', 'bob', { idx: i })
        )
      )
      expect(parallel.map((e) => e.seq)).toEqual([3, 4, 5, 6, 7])
      for (let i = 0; i < parallel.length; i++) {
        expect(await bob.decryptJson('alice', parallel[i])).toEqual({ idx: i })
      }
    })
  })

  describe('attachmentCrypto', () => {
    it('encrypts/decrypts attachments safely including >128KB chunked base64 and rejects tampering', async () => {
      const largeBytes = new Uint8Array(160 * 1024)
      for (let i = 0; i < largeBytes.length; i++) largeBytes[i] = i % 251
      const b64 = uint8ArrayToBase64(largeBytes)
      expect(base64ToUint8Array(b64)).toEqual(largeBytes)

      const att = {
        id: 'att-1',
        name: 'big.bin',
        size: largeBytes.byteLength,
        type: 'application/octet-stream',
        dataUrl: `data:application/octet-stream;base64,${b64}`,
      }

      const encrypted = await encryptAttachment(att)
      expect(encrypted.ciphertextB64).not.toContain(b64.slice(0, 32))

      const restored = await decryptAttachment(encrypted)
      expect(restored).toEqual(att)

      await expect(
        decryptAttachment({
          ...encrypted,
          ciphertextB64: encrypted.ciphertextB64.slice(0, -4) + 'AAAA',
        })
      ).rejects.toThrow(/digest mismatch/i)
    })
  })

  describe('SenderKeyManager', () => {
    it('verifies ECDSA group signatures, blocks epoch downgrade, and rotates keys on member leave', async () => {
      const aliceId = await createEphemeralIdentityForTests()
      const eveId = await createEphemeralIdentityForTests()

      const aliceSk = new SenderKeyManager()
      const bobSk = new SenderKeyManager()

      const dist1 = await aliceSk.exportDistribution('room', 'peer-alice', aliceId)
      await bobSk.acceptDistribution(dist1, aliceId.publicKeyB64)

      const env1 = await aliceSk.encryptGroupJson('room', 'peer-alice', aliceId, {
        text: 'hello room epoch 1',
      })
      expect(await bobSk.decryptGroupJson(env1, aliceId.publicKeyB64)).toEqual({
        text: 'hello room epoch 1',
      })

      // Spoofed/mismatched pinned key or tampered ciphertext must fail
      await expect(bobSk.decryptGroupJson(env1, eveId.publicKeyB64)).rejects.toThrow()
      await expect(
        bobSk.decryptGroupJson(
          { ...env1, ciphertext: env1.ciphertext.slice(0, -3) + 'xyz' },
          aliceId.publicKeyB64
        )
      ).rejects.toThrow()

      // Reject stale/same epoch redistribution
      await expect(bobSk.acceptDistribution(dist1, aliceId.publicKeyB64)).rejects.toThrow(/downgrade/i)

      // Member leaves -> rotate epoch to 2; un-distributed peer cannot decrypt epoch 2
      const nextEpoch = aliceSk.rotateScope('room')
      expect(nextEpoch).toBe(2)
      const dist2 = await aliceSk.exportDistribution('room', 'peer-alice', aliceId)
      const env2 = await aliceSk.encryptGroupJson('room', 'peer-alice', aliceId, {
        text: 'secret epoch 2',
      })
      await expect(bobSk.decryptGroupJson(env2, aliceId.publicKeyB64)).rejects.toThrow(/Epoch mismatch/i)

      await bobSk.acceptDistribution(dist2, aliceId.publicKeyB64)
      expect(await bobSk.decryptGroupJson(env2, aliceId.publicKeyB64)).toEqual({
        text: 'secret epoch 2',
      })
    })
  })

  describe('PeerManager E2EE Room + DM + Zone Isolation + Fail-Closed Downgrade', () => {
    beforeEach(() => {
      useGameStore.setState({
        localPlayer: {
          id: 'lira-ROOM1-host',
          gameId: 'uid-host',
          name: 'Host',
          x: 5,
          y: 5,
          direction: 'down',
          isMoving: false,
          avatar: {} as any,
          status: 'available',
          lastUpdated: 0,
          currentZoneId: 'zone-a',
        },
        remotePlayers: {
          'peer-bob': {
            id: 'peer-bob',
            gameId: 'uid-bob',
            name: 'Bob',
            x: 6,
            y: 5,
            direction: 'down',
            isMoving: false,
            avatar: {} as any,
            status: 'available',
            lastUpdated: 0,
            currentZoneId: 'zone-a',
          },
          'peer-carol': {
            id: 'peer-carol',
            gameId: 'uid-carol',
            name: 'Carol',
            x: 20,
            y: 20,
            direction: 'down',
            isMoving: false,
            avatar: {} as any,
            status: 'available',
            lastUpdated: 0,
            currentZoneId: null,
          },
        },
        connectionHostId: 'lira-ROOM1-host',
        friends: [],
        friendProfiles: {},
      })
      useMapStore.getState().setMapData({
        width: 32,
        height: 24,
        tiles: [],
        objects: [],
        zones: [
          {
            id: 'zone-a',
            name: 'Sala VIP',
            x: 2,
            y: 2,
            width: 8,
            height: 8,
            type: 'private',
            color: '#fff',
            isLocked: false,
          },
        ],
      } as any)
      useChatStore.setState({ messages: [] })
    })

    it('queues a DM until its recipient negotiates E2EE and reports partial group delivery', async () => {
      const pm = new (PeerManager as any)()
      pm.peer = { id: 'lira-ROOM1-host', destroyed: false }
      pm.isHost = true
      const sendBob = vi.fn()
      const sendCarol = vi.fn()
      pm.connections.set('peer-bob', { open: true, peer: 'peer-bob', send: sendBob })
      pm.connections.set('peer-carol', { open: true, peer: 'peer-carol', send: sendCarol })
      const bob = useGameStore.getState().remotePlayers['peer-bob']
      useGameStore.getState().setRemotePlayer({ ...bob, e2eeVersion: 1 })
      pm.pairwiseRatchets.initSession('peer-carol', randomBytes(32), randomBytes(32))
      vi.spyOn(pm, 'initiateE2EEHandshake').mockResolvedValue(undefined)

      const dm = { id: 'queued-dm', senderId: pm.peer.id, senderName: 'Host', recipientId: bob.id,
        channelId: 'dm-peer-bob', content: 'Mensagem privada', timestamp: Date.now() }
      try {
        await pm.sendChatMessageEncrypted(dm)
        expect(sendBob).not.toHaveBeenCalled()
        expect(useChatStore.getState().roomSendNotices[dm.id]?.text).toContain('Aguardando')

        await pm.sendChatMessageEncrypted({ ...dm, id: 'partial-room', recipientId: undefined, channelId: 'general' })
        expect(sendCarol).toHaveBeenCalledWith(expect.objectContaining({ type: 'E2EE_GROUP_ENVELOPE' }))
        expect(useChatStore.getState().roomSendNotices['partial-room']?.text).toContain('1 de 2')

        pm.pairwiseRatchets.initSession('peer-bob', randomBytes(32), randomBytes(32))
        pm.flushPendingRoomDms('peer-bob')
        await vi.waitFor(() => expect(sendBob).toHaveBeenCalledWith(expect.objectContaining({ type: 'E2EE_DIRECT_ENVELOPE' })))
        expect(useChatStore.getState().roomSendNotices[dm.id]).toBeUndefined()
      } finally {
        pm.cancelPendingRoomDms()
      }
    })

    it('encrypts DMs (unicast only, with encrypted attachment), room chat, and zone-isolated #zona-atual', async () => {
      const hostPm = PeerManager.getInstance() as any
      hostPm.disconnect()
      useGameStore.setState({
        localPlayer: {
          id: 'lira-ROOM1-host',
          gameId: 'uid-host',
          name: 'Host',
          x: 5,
          y: 5,
          direction: 'down',
          isMoving: false,
          avatar: {} as any,
          status: 'available',
          lastUpdated: 0,
          currentZoneId: 'zone-a',
        },
        remotePlayers: {
          'peer-bob': {
            id: 'peer-bob',
            gameId: 'uid-bob',
            name: 'Bob',
            x: 6,
            y: 5,
            direction: 'down',
            isMoving: false,
            avatar: {} as any,
            status: 'available',
            lastUpdated: 0,
            currentZoneId: 'zone-a',
          },
          'peer-carol': {
            id: 'peer-carol',
            gameId: 'uid-carol',
            name: 'Carol',
            x: 20,
            y: 20,
            direction: 'down',
            isMoving: false,
            avatar: {} as any,
            status: 'available',
            lastUpdated: 0,
            currentZoneId: null,
          },
        },
        connectionHostId: 'lira-ROOM1-host',
        friends: [],
        friendProfiles: {},
      })
      useMapStore.getState().setMapData({
        width: 32,
        height: 24,
        tiles: [],
        objects: [],
        zones: [
          {
            id: 'zone-a',
            name: 'Sala VIP',
            x: 2,
            y: 2,
            width: 8,
            height: 8,
            type: 'private',
            color: '#fff',
            isLocked: false,
          },
        ],
      } as any)
      useChatStore.setState({ messages: [] })

      const hostId = await createEphemeralIdentityForTests()
      const bobId = await createEphemeralIdentityForTests()
      const carolId = await createEphemeralIdentityForTests()

      const hostE2ee = new E2EESessionManager(async () => hostId)
      const bobE2ee = new E2EESessionManager(async () => bobId)
      const carolE2ee = new E2EESessionManager(async () => carolId)
      hostPm.e2eeSessions = hostE2ee
      hostPm.localIdentity = hostId
      hostPm.isHost = true
      hostPm.roomCode = 'ROOM1'
      hostPm.peer = { id: 'lira-ROOM1-host', destroyed: false }

      const bobSent: any[] = []
      const carolSent: any[] = []
      hostPm.connections.set('peer-bob', {
        peer: 'peer-bob',
        open: true,
        send: (d: any) => bobSent.push(d),
        close: vi.fn(),
      })
      hostPm.connections.set('peer-carol', {
        peer: 'peer-carol',
        open: true,
        send: (d: any) => carolSent.push(d),
        close: vi.fn(),
      })

      // Complete E2EE handshakes host <-> bob and host <-> carol
      const initBob = await bobE2ee.startHandshake('lira-ROOM1-host', 'peer-bob')
      await hostPm.handleIncomingE2EEHandshake(initBob, 'peer-bob')
      const ackBob = bobSent.find((m) => m.type === 'E2EE_HANDSHAKE')?.payload
      expect(ackBob).toBeDefined()
      const bobRes = await bobE2ee.handleHandshake(ackBob, {
        localId: 'peer-bob',
        remotePeerId: 'lira-ROOM1-host',
      })
      expect(bobRes.ok).toBe(true)

      const bobRatchet = new PairwiseRatchetManager()
      const bobSk = new SenderKeyManager()
      bobRatchet.initSession(
        'lira-ROOM1-host',
        bobRes.session!.sendChainKey,
        bobRes.session!.recvChainKey
      )

      const initCarol = await carolE2ee.startHandshake('lira-ROOM1-host', 'peer-carol')
      await hostPm.handleIncomingE2EEHandshake(initCarol, 'peer-carol')
      const ackCarol = carolSent.find((m) => m.type === 'E2EE_HANDSHAKE')?.payload
      const carolRes = await carolE2ee.handleHandshake(ackCarol, {
        localId: 'peer-carol',
        remotePeerId: 'lira-ROOM1-host',
      })
      expect(carolRes.ok).toBe(true)
      const carolRatchet = new PairwiseRatchetManager()
      carolRatchet.initSession(
        'lira-ROOM1-host',
        carolRes.session!.sendChainKey,
        carolRes.session!.recvChainKey
      )

      bobSent.length = 0
      carolSent.length = 0

      // 1. DM + attachment from Host -> Bob (must NOT leak to Carol and must be encrypted on wire)
      const dmPayload = {
        id: 'dm-1',
        senderId: 'lira-ROOM1-host',
        senderName: 'Host',
        channelId: 'dm-peer-bob-uid-host',
        recipientId: 'peer-bob',
        content: 'segredo confidencial',
        timestamp: Date.now(),
        attachment: {
          id: 'att-dm',
          name: 'secret.txt',
          size: 4,
          type: 'text/plain',
          dataUrl: 'data:text/plain;base64,dGVzdA==',
        },
      }
      hostPm.sendChatMessage(dmPayload)
      await vi.waitFor(() => {
        expect(bobSent).toHaveLength(1)
      })

      expect(carolSent).toHaveLength(0)
      expect(bobSent[0].type).toBe('E2EE_DIRECT_ENVELOPE')
      const wireJson = JSON.stringify(bobSent[0])
      expect(wireJson).not.toContain('segredo confidencial')
      expect(wireJson).not.toContain('dGVzdA==')

      const decodedDm = await bobRatchet.decryptJson<any>('lira-ROOM1-host', bobSent[0].payload)
      expect(decodedDm.message.content).toBe('segredo confidencial')
      expect(decodedDm.message.attachment).toBeUndefined()
      const restoredAtt = await decryptAttachment(decodedDm.message.encryptedAttachment)
      expect(restoredAtt.dataUrl).toBe('data:text/plain;base64,dGVzdA==')

      // 2. #zona-atual message inside zone-a -> MUST reach Bob only (Carol is outside zone-a!)
      bobSent.length = 0
      carolSent.length = 0
      hostPm.sendChatMessage({
        id: 'zone-msg-1',
        senderId: 'lira-ROOM1-host',
        senderName: 'Host',
        channelId: 'current-zone',
        zoneId: 'zone-a',
        content: 'só quem está na VIP lê isso',
        timestamp: Date.now(),
      })
      await vi.waitFor(() => {
        expect(bobSent).toHaveLength(2)
      })

      expect(carolSent).toHaveLength(0)
      expect(bobSent.map((m) => m.type)).toEqual([
        'E2EE_KEY_DISTRIBUTION',
        'E2EE_GROUP_ENVELOPE',
      ])
      const distWire = bobSent[0].payload
      const distDecrypted = await bobRatchet.decryptJson<any>('lira-ROOM1-host', distWire.envelope)
      await bobSk.acceptDistribution(distDecrypted, hostId.publicKeyB64)
      const zoneDecoded = await bobSk.decryptGroupJson<any>(
        bobSent[1].payload,
        hostId.publicKeyB64
      )
      expect(zoneDecoded.message.content).toBe('só quem está na VIP lê isso')

      // 3. Bob exits zone-a -> host rotates zone-a sender key epoch
      hostPm.handlePeerZoneChange('peer-bob', null)
      const epochAfterExit = hostPm.getSenderKeyManager().getOrCreateOutbound('zone:zone-a').epoch
      expect(epochAfterExit).toBeGreaterThan(1)

      // 4. Plaintext downgrade attack from Bob while E2EE session active must fail closed
      const countBefore = useChatStore.getState().messages.length
      hostPm.handleNetworkMessage(
        {
          type: 'CHAT_MESSAGE',
          senderId: 'peer-bob',
          payload: {
            message: {
              id: 'downgrade-1',
              senderId: 'peer-bob',
              senderName: 'Bob',
              channelId: 'general',
              content: 'plaintext bypass attempt',
              timestamp: Date.now(),
            },
          },
          timestamp: Date.now(),
        },
        'peer-bob'
      )
      expect(useChatStore.getState().messages.length).toBe(countBefore)
      expect(
        useSecurityStore
          .getState()
          .alerts.some((a) => a.peerId === 'peer-bob' && a.reason === 'plaintext_downgrade')
      ).toBe(true)

      // 5. Encrypted envelope carrying malformed inner ChatMessage (e.g. javascript: attachment URL) is dropped by Zod
      const beforeInvalidCount = useChatStore.getState().messages.length
      const badInnerEnv = await bobRatchet.encryptJson('lira-ROOM1-host', 'peer-bob', 'lira-ROOM1-host', {
        kind: 'dm',
        message: {
          id: 'bad-inner-msg',
          senderId: 'peer-bob',
          senderName: 'Bob',
          channelId: 'dm-peer-bob-uid-host',
          content: 'xss payload',
          timestamp: Date.now(),
          attachment: {
            id: 'att-bad',
            name: 'evil.html',
            size: 10,
            type: 'text/html',
            dataUrl: 'javascript:alert(1)',
          },
        },
      })
      await hostPm.handleIncomingDirectEnvelope('peer-bob', { ...badInnerEnv, kind: 'dm' })
      expect(useChatStore.getState().messages.length).toBe(beforeInvalidCount)
      expect(useChatStore.getState().messages.some((m) => m.id === 'bad-inner-msg')).toBe(false)

      hostPm.disconnect()
    })
  })

  describe('FriendsPresenceService E2EE & Strict BroadcastChannel', () => {
    it('encrypts DMs and receipts after handshake, rejects plaintext downgrade, and ignores BroadcastChannel recipientName matches', async () => {
      const ME = 'u-me000000000000000001'
      const FRIEND = 'u-alice000000000000002'
      const localIdentity = await createEphemeralIdentityForTests()
      const aliceIdentity = await createEphemeralIdentityForTests()
      const aliceE2ee = new E2EESessionManager(async () => aliceIdentity)

      useGameStore.setState({
        localPlayer: {
          id: ME,
          gameId: ME,
          name: 'EuLocal',
          x: 0,
          y: 0,
          direction: 'down',
          isMoving: false,
          avatar: {} as any,
          status: 'available',
          lastUpdated: 0,
        },
        friends: [FRIEND],
        friendProfiles: {
          [FRIEND]: {
            id: FRIEND,
            name: 'Alice',
            actualUserId: FRIEND,
            identityKey: aliceIdentity.publicKeyB64,
            identityKeyVerified: true,
          },
        },
      })
      useChatStore.setState({ messages: [] })

      const service = FriendsPresenceService.getInstance() as any
      service.pairwiseRatchets.clear()
      service.e2eeSessions = new E2EESessionManager(async () => localIdentity)
      service.authenticatedFriends.clear()

      const sentToAlice: any[] = []
      service.network = {
        isLinked: (id: string) => id === FRIEND,
        send: (_id: string, pkt: any) => {
          sentToAlice.push(pkt)
          return true
        },
        syncContacts: vi.fn(),
        getPeerConnection: () => null,
        disconnectUser: vi.fn(),
        refresh: vi.fn(),
        stop: vi.fn(),
      }

      // Perform handshake FRIEND <-> ME
      const aliceInit = await aliceE2ee.startHandshake(ME, FRIEND)
      await service.handleFriendHandshake(FRIEND, aliceInit)
      const replyPkt = sentToAlice.find((p) => p.t === 'e2ee-hello')?.payload
      expect(replyPkt).toBeDefined()
      const aliceRes = await aliceE2ee.handleHandshake(replyPkt, {
        localId: FRIEND,
        remotePeerId: ME,
      })
      expect(aliceRes.ok).toBe(true)

      const aliceRatchet = new PairwiseRatchetManager()
      aliceRatchet.initSession(
        ME,
        aliceRes.session!.sendChainKey,
        aliceRes.session!.recvChainKey
      )

      sentToAlice.length = 0

      // Send DM + attachment -> must use `{ t: 'e2ee', payload: { kind: 'dm', envelope } }`
      await service.sendDirectMessage({
        id: 'fp-dm-1',
        senderId: ME,
        senderName: 'EuLocal',
        recipientId: FRIEND,
        recipientName: 'Alice',
        channelId: `dm-${[ME, FRIEND].sort().join('-')}`,
        content: 'oi alice e2ee',
        timestamp: Date.now(),
        attachment: {
          id: 'att-fp',
          name: 'note.txt',
          size: 2,
          type: 'text/plain',
          dataUrl: 'data:text/plain;base64,b2s=',
        },
      })
      const e2eePkt = sentToAlice.find((p) => p.t === 'e2ee')
      expect(e2eePkt).toBeDefined()
      expect(JSON.stringify(e2eePkt)).not.toContain('oi alice e2ee')
      expect(JSON.stringify(e2eePkt)).not.toContain('b2s=')

      const decFromMe = await aliceRatchet.decryptJson<any>(ME, e2eePkt.payload.envelope)
      expect(decFromMe.message.content).toBe('oi alice e2ee')

      // Alice sends E2EE DM back -> decrypted & ingested + encrypted delivered receipt returned
      sentToAlice.length = 0
      const envFromAlice = await aliceRatchet.encryptJson(ME, FRIEND, ME, {
        message: {
          id: 'fp-dm-2',
          senderId: FRIEND,
          senderName: 'Alice',
          content: 'oi de volta',
          timestamp: Date.now(),
        },
      })
      await service.handleEncryptedLinkPacket(FRIEND, {
        kind: 'dm',
        envelope: envFromAlice,
      })

      const stored = useChatStore.getState().messages.find((m) => m.id === 'fp-dm-2')
      expect(stored?.content).toBe('oi de volta')
      expect(stored?.encrypted).toBe(true)
      await vi.waitFor(() => {
        expect(sentToAlice.some((p) => p.t === 'e2ee' && p.payload.kind === 'receipt')).toBe(true)
      })

      // Plaintext downgrade rejected
      const msgCountBefore = useChatStore.getState().messages.length
      service.handleLinkPacket(FRIEND, {
        t: 'dm',
        message: {
          id: 'fp-plain-bad',
          senderId: FRIEND,
          content: 'plaintext attack',
          timestamp: Date.now(),
        },
      })
      expect(useChatStore.getState().messages.length).toBe(msgCountBefore)
      expect(
        useSecurityStore
          .getState()
          .alerts.some((a) => a.peerId === FRIEND && a.reason === 'plaintext_downgrade')
      ).toBe(true)

      // BroadcastChannel strict matching: matching only recipientName ('EuLocal') MUST NOT ingest
      service.handleIncomingMessage({
        type: 'DIRECT_MESSAGE',
        message: {
          id: 'bc-spoof',
          senderId: FRIEND,
          senderName: 'Alice',
          recipientId: 'u-someone-else00000003',
          recipientName: 'EuLocal',
          channelId: `dm-${FRIEND}-u-someone-else00000003`,
          content: 'spoofed by display name',
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      })
      expect(useChatStore.getState().messages.some((m) => m.id === 'bc-spoof')).toBe(false)

      // Back-to-back synchronous e2ee-hello followed by e2ee processes in FIFO order without dropping first DM
      const FRESH_FRIEND = 'u-carol000000000000003'
      const carolIdentity = await createEphemeralIdentityForTests()
      const carolE2ee = new E2EESessionManager(async () => carolIdentity)
      useGameStore.setState({
        friends: [FRIEND, FRESH_FRIEND],
        friendProfiles: {
          ...useGameStore.getState().friendProfiles,
          [FRESH_FRIEND]: {
            id: FRESH_FRIEND,
            name: 'Carol',
            actualUserId: FRESH_FRIEND,
            identityKey: carolIdentity.publicKeyB64,
            identityKeyVerified: true,
          },
        },
      })
      const carolSentPkts: any[] = []
      service.network = {
        isLinked: (id: string) => id === FRESH_FRIEND,
        send: (_id: string, pkt: any) => {
          carolSentPkts.push(pkt)
          return true
        },
        syncContacts: vi.fn(),
        getPeerConnection: () => null,
        disconnectUser: vi.fn(),
        refresh: vi.fn(),
        stop: vi.fn(),
      }
      const carolInit = await carolE2ee.startHandshake(ME, FRESH_FRIEND)
      const localInitForCarol = await service.e2eeSessions.startHandshake(FRESH_FRIEND, ME)
      const carolAck = await carolE2ee.handleHandshake(localInitForCarol, {
        localId: FRESH_FRIEND,
        remotePeerId: ME,
      })
      expect(carolAck.ok).toBe(true)
      const carolRatchet = new PairwiseRatchetManager()
      carolRatchet.initSession(
        ME,
        carolAck.session!.sendChainKey,
        carolAck.session!.recvChainKey
      )
      const firstCarolDmEnv = await carolRatchet.encryptJson(ME, FRESH_FRIEND, ME, {
        message: {
          id: 'fifo-first-dm',
          senderId: FRESH_FRIEND,
          senderName: 'Carol',
          content: 'fifo guaranteed',
          timestamp: Date.now(),
        },
      })
      void carolInit
      // Deliver handshake ack and first E2EE DM back-to-back without awaiting in between
      service.handleLinkPacket(FRESH_FRIEND, { t: 'e2ee-hello', payload: carolAck.reply! })
      service.handleLinkPacket(FRESH_FRIEND, {
        t: 'e2ee',
        payload: { kind: 'dm', envelope: firstCarolDmEnv },
      })
      await vi.waitFor(() => {
        expect(useChatStore.getState().messages.some((m) => m.id === 'fifo-first-dm')).toBe(true)
      })
    })
  })
})
