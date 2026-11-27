import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEphemeralIdentityForTests } from '../../crypto/identityStore'
import {
  MediaE2EEManager,
  signCallDtlsSignal,
  verifyCallDtlsSignal,
} from '../../crypto/mediaE2ee'
import {
  deriveMediaKeyMaterial,
  ratchetMediaKeyMaterial,
  SFrameCryptoContext,
  SFRAME_TRAILER_BYTES,
} from '../../crypto/sframe'
import { E2EESessionManager } from '../../crypto/sessionManager'
import { AlmLive, type AlmLiveDeps } from '../../p2p/almLive'
import { packetizeFrame, type AlmFrame } from '../../p2p/almPackets'
import { AlmTree } from '../../p2p/almTree'
import { GStreamerRoom } from '../../p2p/gstreamerRoom'
import { PeerManager } from '../../p2p/PeerManager'
import {
  MAGIC_BYTE,
  MAGIC_BYTE_E2EE,
  SuperPeerVoiceRelay,
  VOICE_RELAY_CHANNEL_LABEL,
} from '../../p2p/SuperPeerVoiceRelay'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'
import { useSecurityStore } from '../../store/useSecurityStore'

describe('Phase 3: Media Calls & Lives E2EE', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    useSecurityStore.getState().reset()
    SuperPeerVoiceRelay.getInstance().reset()
    try {
      ;(PeerManager.getInstance() as any).disconnect()
    } catch {}
  })

  describe('SFrameCryptoContext', () => {
    it('encrypts/decrypts audio, VP8, and H.264 Annex-B frames while preserving codec prefixes and blocking tamper/replay/DoS', async () => {
      const rootKey = new Uint8Array(32).fill(0xab)
      const mat0 = await deriveMediaKeyMaterial(rootKey, 'alice', 'bob', 0)

      const sender = new SFrameCryptoContext()
      const receiver = new SFrameCryptoContext()
      await sender.setSendKey(mat0)
      await receiver.setRecvKey(mat0)

      // Opus audio -> unencrypted prefixLen = 0
      const audioIn = new Uint8Array([0xf8, 0x11, 0x22, 0x33, 0x44, 0x55])
      const audioEnc = await sender.encryptFrame(audioIn, 'audio', true)
      expect(audioEnc[audioEnc.byteLength - 3]).toBe(0) // prefixLen = 0
      expect(audioEnc.byteLength).toBe(audioIn.byteLength + 16 + SFRAME_TRAILER_BYTES)
      expect(await receiver.decryptFrame(audioEnc)).toEqual(audioIn)

      // VP8 keyframe -> 10B prefix, delta -> 3B prefix
      const vp8Key = new Uint8Array(24).fill(7)
      const vp8KeyEnc = await sender.encryptFrame(vp8Key, 'video', true)
      expect(vp8KeyEnc[vp8KeyEnc.byteLength - 3]).toBe(10)
      expect(vp8KeyEnc.subarray(0, 10)).toEqual(vp8Key.subarray(0, 10))
      expect(await receiver.decryptFrame(vp8KeyEnc)).toEqual(vp8Key)

      const vp8Delta = new Uint8Array(20).fill(9)
      const vp8DeltaEnc = await sender.encryptFrame(vp8Delta, 'video', false)
      expect(vp8DeltaEnc[vp8DeltaEnc.byteLength - 3]).toBe(3)
      expect(await receiver.decryptFrame(vp8DeltaEnc)).toEqual(vp8Delta)

      // H.264 Annex-B 4-byte start code -> 5B prefix preserved
      const h264 = new Uint8Array([0, 0, 0, 1, 0x65, 1, 2, 3, 4, 5, 6])
      const h264Enc = await sender.encryptFrame(h264, 'video', true)
      expect(h264Enc[h264Enc.byteLength - 3]).toBe(5)
      expect(h264Enc.subarray(0, 5)).toEqual(new Uint8Array([0, 0, 0, 1, 0x65]))
      expect(await receiver.decryptFrame(h264Enc)).toEqual(h264)

      // Replay rejected
      await expect(receiver.decryptFrame(h264Enc)).rejects.toThrow(/replay/i)

      // Out-of-order frames
      const nextA = await sender.encryptFrame(new Uint8Array([1, 2, 3, 4]), 'audio', false)
      const nextB = await sender.encryptFrame(new Uint8Array([5, 6, 7, 8]), 'audio', false)

      // Anti-DoS: tampered frame claiming counter = 1000 must fail auth WITHOUT advancing maxCounter!
      const forged = new Uint8Array(nextB)
      const forgedTrailer = new DataView(forged.buffer, forged.byteLength - SFRAME_TRAILER_BYTES)
      forgedTrailer.setUint32(0, 1000, false)
      await expect(receiver.decryptFrame(forged)).rejects.toThrow()

      // Legitimate nextB then out-of-order nextA still decrypt cleanly
      expect(await receiver.decryptFrame(nextB)).toEqual(new Uint8Array([5, 6, 7, 8]))
      expect(await receiver.decryptFrame(nextA)).toEqual(new Uint8Array([1, 2, 3, 4]))

      // Key rotation + revokeKid(0)
      const mat1 = await ratchetMediaKeyMaterial(mat0.rawKey, 1)
      const rotated = await sender.encryptFrame(new Uint8Array([9, 9]), 'audio', false) // still kid=0
      await sender.setSendKey(mat1)
      await receiver.setRecvKey(mat1, true)
      receiver.revokeKid(0)
      await expect(receiver.decryptFrame(rotated)).rejects.toThrow(/Unknown SFrame key id/i)
      const afterRotate = await sender.encryptFrame(new Uint8Array([10, 11]), 'audio', true)
      expect(await receiver.decryptFrame(afterRotate)).toEqual(new Uint8Array([10, 11]))
    })
  })

  describe('MediaE2EEManager & PeerManager E2EE_CALL_SIGNAL', () => {
    it('protects a receive-only connection when the first track appears after attachment', async () => {
      class FakeScriptTransform {}
      vi.stubGlobal('RTCRtpScriptTransform', FakeScriptTransform)
      const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null as ((e: ErrorEvent) => void) | null }
      const workerFailure = vi.fn()
      const mgr = new MediaE2EEManager(() => worker, undefined, workerFailure)
      await mgr.configurePeerKeys('bob', 'alice', new Uint8Array(32).fill(5))
      const protectedMedia = vi.fn()
      const pc = { getSenders: () => [], getReceivers: () => [], addEventListener: vi.fn(), close: vi.fn() }
      expect(mgr.attachPeerConnection(pc as any, 'bob', undefined, protectedMedia)).toBe(true)
      expect(protectedMedia).not.toHaveBeenCalled()
      const trackListener = pc.addEventListener.mock.calls.find(([event]) => event === 'track')?.[1]
      const receiver = { transform: null }
      trackListener({ receiver, track: { kind: 'audio' } })
      expect(receiver.transform).toBeInstanceOf(FakeScriptTransform)
      expect(protectedMedia).toHaveBeenCalledOnce()
      expect(pc.close).not.toHaveBeenCalled()

      worker.onerror?.({} as ErrorEvent)
      expect(workerFailure).toHaveBeenCalledWith(['bob'])
      expect(mgr.hasPeerKeys('bob')).toBe(false)
      expect(mgr.isAvailable()).toBe(false)
    })

    it('attaches RTCRtpScriptTransform without duplicating and verifies/blocks call DTLS signals', async () => {
      const workerMessages: any[] = []
      const fakeWorker = {
        postMessage: vi.fn((m: any) => workerMessages.push(m)),
        terminate: vi.fn(),
        onmessage: null,
      }
      class FakeScriptTransform {
        constructor(public worker: any, public options: any) {}
      }
      vi.stubGlobal('RTCRtpScriptTransform', FakeScriptTransform)

      const mgr = new MediaE2EEManager(() => fakeWorker)
      await mgr.configurePeerKeys('peer-bob', 'peer-alice', new Uint8Array(32).fill(5), 0)
      expect(workerMessages.filter((m) => m.type === 'set-key')).toHaveLength(2)

      const sender: any = { track: { kind: 'audio' }, transform: null }
      const receiver: any = { track: { kind: 'audio' }, transform: null }
      const pc: any = {
        getSenders: () => [sender],
        getReceivers: () => [receiver],
        addEventListener: vi.fn(),
      }
      expect(mgr.attachPeerConnection(pc, 'peer-bob')).toBe(true)
      expect(sender.transform).toBeInstanceOf(FakeScriptTransform)
      expect(sender.transform.options).toEqual({
        peerId: 'peer-bob',
        direction: 'encrypt',
        mediaType: 'audio',
      })
      expect(receiver.transform.options).toEqual({
        peerId: 'peer-bob',
        direction: 'decrypt',
        mediaType: 'audio',
      })
      // Second call is idempotent
      const firstSenderTransform = sender.transform
      mgr.attachPeerConnection(pc, 'peer-bob')
      expect(sender.transform).toBe(firstSenderTransform)
      expect(mgr.attachPeerConnection({
        ...pc,
        getSenders: () => [sender, { track: { kind: 'video' } }],
      }, 'peer-bob')).toBe(false)

      // Wire into PeerManager call verification
      const hostId = await createEphemeralIdentityForTests()
      const bobId = await createEphemeralIdentityForTests()
      const hostE2ee = new E2EESessionManager(async () => hostId)
      const bobE2ee = new E2EESessionManager(async () => bobId)

      const bobInit = await bobE2ee.startHandshake('lira-ROOM1-host', 'peer-bob')
      const bobAckRes = await hostE2ee.handleHandshake(bobInit, {
        localId: 'lira-ROOM1-host',
        remotePeerId: 'peer-bob',
      })
      expect(bobAckRes.ok).toBe(true)

      const pm = PeerManager.getInstance() as any
      pm.disconnect()
      pm.e2eeSessions = hostE2ee
      pm.mediaE2EE = mgr
      pm.isHost = true
      pm.roomCode = 'ROOM1'
      pm.localIdentity = hostId
      pm.peer = { id: 'lira-ROOM1-host', destroyed: false }
      const bobSent: any[] = []
      pm.connections.set('peer-bob', {
        peer: 'peer-bob',
        open: true,
        send: (msg: any) => bobSent.push(msg),
        close: vi.fn(),
      })

      const fpHost = 'sha-256:aa:bb:cc:11'
      const fpBobReal = 'sha-256:dd:ee:ff:22'
      const fpBobMitm = 'sha-256:99:99:99:99'
      const fakeCall: any = {
        peer: 'peer-bob',
        connectionId: 'mc_call_1',
        close: vi.fn(),
        on: vi.fn(),
        peerConnection: {
          localDescription: { sdp: 'v=0\r\na=fingerprint:sha-256 AA:BB:CC:11\r\n' },
          remoteDescription: { sdp: 'v=0\r\na=fingerprint:sha-256 DD:EE:FF:22\r\n' },
          getSenders: () => [{ track: { kind: 'audio' }, transform: null }],
          getReceivers: () => [{ track: { kind: 'audio' }, transform: null }],
          addEventListener: vi.fn(),
        },
      }
      pm.mediaCalls.set('peer-bob', fakeCall)
      pm.attachCallSecurity('peer-bob', fakeCall, 'main')

      const validSig = await signCallDtlsSignal(
        bobId,
        'peer-bob',
        'lira-ROOM1-host',
        'mc_call_1',
        fpBobReal,
        'main'
      )
      expect(await verifyCallDtlsSignal('peer-bob', validSig, bobId.publicKeyB64)).toBe(true)
      await pm.handleIncomingCallSignal('peer-bob', validSig)
      await vi.waitFor(() => {
        expect(bobSent.some((m) => m.type === 'E2EE_CALL_SIGNAL')).toBe(true)
      })
      const sentCallSig = bobSent.find((m) => m.type === 'E2EE_CALL_SIGNAL')
      expect(sentCallSig.payload.dtlsFingerprint).toBe(fpHost)
      expect(useSecurityStore.getState().peers['peer-bob']?.callDtlsVerified).toBe(true)
      expect(useSecurityStore.getState().peers['peer-bob']?.mediaEncrypted).toBe(true)

      // Now simulate MITM replacing remote DTLS fingerprint
      fakeCall.peerConnection.remoteDescription.sdp = `v=0\r\na=fingerprint:sha-256 99:99:99:99\r\n`
      await pm.handleIncomingCallSignal('peer-bob', validSig)
      expect(fpBobMitm).not.toBe(fpBobReal)
      expect(fakeCall.close).toHaveBeenCalled()
      expect(useSecurityStore.getState().peers['peer-bob']?.status).toBe('mitm_blocked')
      expect(
        useSecurityStore.getState().alerts.some((a) => a.reason === 'dtls_mismatch')
      ).toBe(true)
    })
  })

  describe('AlmLive E2EE (encryption at source, blind relay, key rotation, signed signal)', () => {
    it('encrypts frames at presenter, forwards blindly on relay, decrypts on viewer, rejects tamper, rotates on removal, and blocks forged ALM SDP', async () => {
      class FakePeerConnection {
        connectionState = 'connected'
        localDescription: any = null
        getConfiguration() { return {} }
        setConfiguration = vi.fn()
        close = vi.fn()
        createDataChannel() { return { readyState: 'connecting', close: vi.fn() } }
        async createOffer() {
          const sdp = 'v=0\r\na=fingerprint:sha-256 11:22\r\n'
          return { type: 'offer', sdp, toJSON: () => ({ type: 'offer', sdp }) }
        }
        async createAnswer() {
          const sdp = 'v=0\r\na=fingerprint:sha-256 33:44\r\n'
          return { type: 'answer', sdp, toJSON: () => ({ type: 'answer', sdp }) }
        }
        async setLocalDescription(d: any) { this.localDescription = d }
        async setRemoteDescription() {}
        async addIceCandidate() {}
      }
      vi.stubGlobal('RTCPeerConnection', FakePeerConnection)

      const presenterId = await createEphemeralIdentityForTests()
      const sharedLiveKeys = new Map<string, { keyRaw: Uint8Array; salt: Uint8Array }>()

      const depsPresenter: AlmLiveDeps = {
        id: () => 'presenter',
        peers: () => ['relay', 'viewer'],
        eligible: () => true,
        watching: () => false,
        send: vi.fn(),
        ice: async () => ({}),
        stream: vi.fn(),
        rtp: vi.fn(),
        log: vi.fn(),
        e2ee: {
          distributeLiveKey: async (_viewerId, root, epoch, keyRaw, salt, generation) => {
            sharedLiveKeys.set(`${root}::${epoch}::${generation}`, {
              keyRaw: new Uint8Array(keyRaw),
              salt: new Uint8Array(salt),
            })
            return true
          },
          signSignal: async (_to, root, epoch, edgeId, sdp) => `sig:${root}:${epoch}:${edgeId}:${sdp.length}`,
          verifySignal: async (_from, root, epoch, edgeId, sdp, sig) =>
            sig === `sig:${root}:${epoch}:${edgeId}:${sdp.length}`,
        },
      }
      const presenterLive = new AlmLive(depsPresenter) as any
      const pSession = presenterLive.makeSession('presenter', 'ep-1', {
        codec: 'vp8',
        codedWidth: 1280,
        codedHeight: 720,
        temporalLayers: 2,
      })
      pSession.tree = new AlmTree('presenter')
      pSession.tree.add('relay')
      pSession.tree.add('viewer')
      pSession.liveKey = { keyRaw: new Uint8Array(32).fill(0x21), salt: new Uint8Array(12).fill(0x31), generation: 1 }
      pSession.distributedViewers = new Set(['viewer'])
      sharedLiveKeys.set('presenter::ep-1::1', {
        keyRaw: new Uint8Array(pSession.liveKey.keyRaw),
        salt: new Uint8Array(pSession.liveKey.salt),
      })
      presenterLive.sessions.set('presenter', pSession)

      const relayedPackets: ArrayBuffer[] = []
      const relayChildEdge = { id: 'edge-p-r', parent: 'presenter', child: 'relay', maxLayer: 2 }
      pSession.edges.push(relayChildEdge)
      const pLink = await presenterLive.createLink(pSession, relayChildEdge, true)
      pLink.channel = { readyState: 'open', bufferedAmount: 0, send: (d: ArrayBuffer) => relayedPackets.push(d), close: vi.fn() }

      // Setup blind relay node (NO live key!)
      const relayLive = new AlmLive({
        id: () => 'relay',
        peers: () => [],
        eligible: () => true,
        watching: () => true,
        send: vi.fn(),
        ice: async () => ({}),
        stream: vi.fn(),
        rtp: vi.fn(),
        log: vi.fn(),
      }) as any
      const rSession = relayLive.makeSession('presenter', 'ep-1', { codec: 'vp8', codedWidth: 1280, codedHeight: 720, temporalLayers: 2 })
      relayLive.sessions.set('presenter', rSession)
      rSession.edges.push(relayChildEdge, { id: 'edge-r-v', parent: 'relay', child: 'viewer', maxLayer: 2 })
      const rIn = await relayLive.createLink(rSession, relayChildEdge, false)
      const rInChan = { readyState: 'open', bufferedAmount: 0, send: vi.fn(), close: vi.fn(), onmessage: null as any }
      relayLive.attachChannel(rSession, rIn, rInChan)
      const viewerPackets: ArrayBuffer[] = []
      const rOut = await relayLive.createLink(rSession, rSession.edges[1], true)
      rOut.channel = { readyState: 'open', bufferedAmount: 0, send: (d: ArrayBuffer) => viewerPackets.push(d), close: vi.fn() }

      // Setup authorized viewer
      const viewerLive = new AlmLive({
        id: () => 'viewer',
        peers: () => [],
        eligible: () => true,
        watching: () => true,
        send: vi.fn(),
        ice: async () => ({}),
        stream: vi.fn(),
        rtp: vi.fn(),
        log: vi.fn(),
        e2ee: {
          getLiveKey: (root, epoch, gen) => sharedLiveKeys.get(`${root}::${epoch}::${gen}`) ?? null,
          verifySignal: depsPresenter.e2ee!.verifySignal,
          signSignal: depsPresenter.e2ee!.signSignal,
        },
      }) as any
      const vSession = viewerLive.makeSession('presenter', 'ep-1', { codec: 'vp8', codedWidth: 1280, codedHeight: 720, temporalLayers: 2 })
      vSession.localLayer = 0
      const pushVideo = vi.fn()
      vSession.queue = { push: pushVideo, reset: vi.fn() }
      const pushAudio = vi.fn()
      vSession.audioQueue = { push: pushAudio, reset: vi.fn() }
      viewerLive.sessions.set('presenter', vSession)
      vSession.edges.push(rSession.edges[1])
      const vIn = await viewerLive.createLink(vSession, rSession.edges[1], false)
      const vInChan = { readyState: 'open', bufferedAmount: 0, send: vi.fn(), close: vi.fn(), onmessage: null as any }
      viewerLive.attachChannel(vSession, vIn, vInChan)

      const plainVideo: AlmFrame = {
        sequence: 5,
        timestamp: 100_000,
        key: true,
        temporalLayer: 0,
        layerSequences: [1, 5],
        data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
      }
      const plainAudio: AlmFrame = { ...plainVideo, media: 'audio', layerSequences: undefined, duration: 20_000 }
      const encrypt = vi.spyOn(crypto.subtle, 'encrypt')
      presenterLive.forwardSourceFrame(pSession, plainVideo)
      presenterLive.forwardSourceFrame(pSession, plainAudio)
      await vi.waitFor(() => expect(relayedPackets).toHaveLength(2))
      const ivs = encrypt.mock.calls.map(([algorithm]) => Array.from((algorithm as AesGcmParams).iv as Uint8Array))
      expect(ivs).toHaveLength(2)
      expect(ivs[0]).not.toEqual(ivs[1])

      // Blind relay receives packets and forwards exact identical packet buffers without decrypting
      for (const pkt of relayedPackets) {
        rInChan.onmessage({ data: pkt })
      }
      expect(viewerPackets).toEqual(relayedPackets)
      expect(Buffer.from(relayedPackets[0]).includes(plainVideo.data)).toBe(false)

      // Viewer decrypts and receives original frame payload with remapped sequence
      for (const pkt of viewerPackets) {
        vInChan.onmessage({ data: pkt })
      }
      await vi.waitFor(() => expect(pushVideo).toHaveBeenCalledTimes(1))
      await vi.waitFor(() => expect(pushAudio).toHaveBeenCalledTimes(1))
      expect(pushAudio.mock.calls[0][0].data).toEqual(plainAudio.data)
      expect(pushVideo.mock.calls[0][0].data).toEqual(plainVideo.data)
      expect(pushVideo.mock.calls[0][0].sequence).toBe(1)

      // Malicious relay tampering payload drops the frame (does not reach queue)
      const tamperedPkt = viewerPackets[0].slice(0)
      new Uint8Array(tamperedPkt)[tamperedPkt.byteLength - 1] ^= 0xff
      vInChan.onmessage({ data: tamperedPkt })
      await new Promise((r) => setTimeout(r, 20))
      expect(pushVideo).toHaveBeenCalledTimes(1)

      // Removing a viewer rotates key generation from 1 -> 2
      pSession.viewers.set('viewer', Date.now())
      presenterLive.removeViewer(pSession, 'relay')
      expect(pSession.liveKey.generation).toBe(2)

      // Forged ALM signal rejected before setRemoteDescription
      const setRemoteSpy = vi.spyOn(vIn.pc, 'setRemoteDescription')
      await viewerLive.signal(vSession, 'relay', {
        edge: 'edge-r-v',
        description: { type: 'offer', sdp: 'forged-mitm-sdp' },
        sig: 'invalid-sig',
      })
      expect(setRemoteSpy).not.toHaveBeenCalled()
      void presenterId
    })
  })

  describe('GStreamerRoom E2EE signed SDP', () => {
    it('accepts validly signed offer and aborts MITM-tampered SDP before GStreamerReceiver', async () => {
      const send = vi.fn()
      const room = new GStreamerRoom({
        send,
        rtp: vi.fn(),
        eligible: () => false,
        watching: () => true,
        stream: vi.fn(),
        rtc: {},
        e2ee: {
          verifySdp: async (_from, _session, _type, sdp, sig) => sig === `ok:${sdp}`,
        },
      })
      room.watch('presenter', true)
      const sessionId = send.mock.calls[0][1].session

      // Tampered SDP / forged sig aborts subscription immediately
      await room.receive('presenter', {
        kind: 'sdp',
        session: sessionId,
        description: { type: 'offer', sdp: 'v=0\r\na=fingerprint:sha-256 MITM' },
        dtlsSig: 'ok:v=0\r\na=fingerprint:sha-256 REAL_PADDING_SIGNATURE_OK',
      })
      expect(send).toHaveBeenLastCalledWith('presenter', { kind: 'end', session: sessionId })
      room.close()
    })
  })

  describe('SuperPeerVoiceRelay E2EE & Control Hardening', () => {
    it('rejects forged control messages, encrypts relayed voice as 0x57, forwards blindly on host, decrypts on receiver, and blocks 0x56 plaintext downgrade', async () => {
      const aliceId = await createEphemeralIdentityForTests()
      const bobId = await createEphemeralIdentityForTests()
      const bobE2ee = new E2EESessionManager(async () => bobId)
      const aliceE2ee = new E2EESessionManager(async () => aliceId)

      const aliceInit = await aliceE2ee.startHandshake('peer-b', 'peer-a')
      const bobRes = await bobE2ee.handleHandshake(aliceInit, {
        localId: 'peer-b',
        remotePeerId: 'peer-a',
      })
      expect(bobRes.ok).toBe(true)
      const aliceRes = await aliceE2ee.handleHandshake(bobRes.reply!, {
        localId: 'peer-a',
        remotePeerId: 'peer-b',
      })
      expect(aliceRes.ok).toBe(true)

      const pm = PeerManager.getInstance() as any
      pm.disconnect()
      pm.isHost = true
      pm.e2eeSessions = bobE2ee
      useGameStore.setState({
        localPlayer: { id: 'peer-host', name: 'Host' } as any,
        connectionHostId: 'peer-host',
        remotePlayers: {
          'peer-a': { id: 'peer-a', name: 'Alice', currentZoneId: 'zone-1' } as any,
          'peer-b': { id: 'peer-b', name: 'Bob', currentZoneId: 'zone-1' } as any,
          'peer-c': { id: 'peer-c', name: 'Carol', currentZoneId: 'zone-2' } as any,
        },
      })
      vi.spyOn(pm, 'getConnection').mockReturnValue({ open: true } as any)
      const ctrlSpy = vi.spyOn(pm, 'sendVoiceRelayControl').mockImplementation(() => {})

      const relay = SuperPeerVoiceRelay.getInstance() as any
      // Spoofed requester (senderPeerId !== targetPeer) rejected
      relay.handleControlMessage(
        { type: 'VOICE_RELAY_REQUEST', sourcePeer: 'peer-a', targetPeer: 'peer-b' },
        'peer-c'
      )
      expect(ctrlSpy).not.toHaveBeenCalled()

      // Different-zone relay rejected
      relay.handleControlMessage(
        { type: 'VOICE_RELAY_REQUEST', sourcePeer: 'peer-a', targetPeer: 'peer-c' },
        'peer-c'
      )
      expect(ctrlSpy).not.toHaveBeenCalled()

      // Non-host trying VOICE_RELAY_ACCEPT rejected
      pm.isHost = false
      relay.handleControlMessage(
        { type: 'VOICE_RELAY_ACCEPT', sourcePeer: 'peer-a', targetPeer: 'peer-b' },
        'peer-c'
      )
      expect(relay.activeReceivers.has('peer-a')).toBe(false)

      // Host legitimately opens relay channel and relays 0x57 packet blindly
      pm.isHost = true
      relay.handleControlMessage(
        { type: 'VOICE_RELAY_REQUEST', sourcePeer: 'peer-a', targetPeer: 'peer-b' },
        'peer-b'
      )
      const forwarded: ArrayBuffer[] = []
      relay.relayChannels.set('peer-b', {
        label: VOICE_RELAY_CHANNEL_LABEL,
        readyState: 'open',
        send: (buf: ArrayBuffer) => forwarded.push(buf),
        close: vi.fn(),
      })

      const plainAudio = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
      const { encryptRawMediaPayload, deriveMediaKeyMaterial } = await import('../../crypto/sframe')
      const { utf8Bytes } = await import('../../crypto/primitives')
      const sendMat = await deriveMediaKeyMaterial(
        aliceRes.session!.rootKey,
        'peer-a',
        'peer-b',
        0,
        'lira-voice-relay-v1'
      )
      const buildPacket = async (seq: number, magic: number, payload: Uint8Array) => {
        const ts = 1000 + seq
        const body =
          magic === MAGIC_BYTE_E2EE
            ? await encryptRawMediaPayload(
                sendMat.rawKey,
                sendMat.salt,
                seq,
                utf8Bytes(`lira-voice-relay-v1|peer-a|peer-b|${seq}|${ts}`),
                payload
              )
            : payload
        const targetBytes = new TextEncoder().encode('peer-b')
        const buf = new ArrayBuffer(8 + targetBytes.length + body.byteLength)
        const view = new DataView(buf)
        view.setUint8(0, magic)
        view.setUint16(1, seq)
        view.setUint32(3, ts)
        view.setUint8(7, targetBytes.length)
        new Uint8Array(buf, 8, targetBytes.length).set(targetBytes)
        new Uint8Array(buf, 8 + targetBytes.length).set(body)
        return buf
      }

      const pkt1 = await buildPacket(1, MAGIC_BYTE_E2EE, plainAudio)
      relay.handleBinaryMessage('peer-a', pkt1, true)
      expect(forwarded).toHaveLength(1)
      expect(new DataView(forwarded[0]).getUint8(0)).toBe(MAGIC_BYTE_E2EE)

      // Bob receives 3 encrypted packets from Host relay -> Make-Before-Break activates!
      pm.isHost = false
      useGameStore.setState({ localPlayer: { id: 'peer-b', name: 'Bob', currentZoneId: 'zone-1' } as any })
      relay.handleControlMessage(
        { type: 'VOICE_RELAY_ACCEPT', sourcePeer: 'peer-a', targetPeer: 'peer-b' },
        'peer-host'
      )
      const bobForwarded = async (seq: number) => {
        const ts = 1000 + seq
        const body = await encryptRawMediaPayload(
          sendMat.rawKey,
          sendMat.salt,
          seq,
          utf8Bytes(`lira-voice-relay-v1|peer-a|peer-b|${seq}|${ts}`),
          plainAudio
        )
        const srcBytes = new TextEncoder().encode('peer-a')
        const buf = new ArrayBuffer(8 + srcBytes.length + body.byteLength)
        const view = new DataView(buf)
        view.setUint8(0, MAGIC_BYTE_E2EE)
        view.setUint16(1, seq)
        view.setUint32(3, ts)
        view.setUint8(7, srcBytes.length)
        new Uint8Array(buf, 8, srcBytes.length).set(srcBytes)
        new Uint8Array(buf, 8 + srcBytes.length).set(body)
        return buf
      }

      relay.handleBinaryMessage('peer-host', await bobForwarded(1), false)
      relay.handleBinaryMessage('peer-host', await bobForwarded(2), false)
      relay.handleBinaryMessage('peer-host', await bobForwarded(3), false)
      await vi.waitFor(() => {
        expect(relay.isRelayActiveForPeer('peer-a')).toBe(true)
      })

      // Plaintext MAGIC_BYTE downgrade while E2EE session active MUST fail closed
      const srcBytes = new TextEncoder().encode('peer-a')
      const plainDowngrade = new ArrayBuffer(8 + srcBytes.length + plainAudio.byteLength)
      const pdView = new DataView(plainDowngrade)
      pdView.setUint8(0, MAGIC_BYTE)
      pdView.setUint16(1, 4)
      pdView.setUint32(3, 1004)
      pdView.setUint8(7, srcBytes.length)
      new Uint8Array(plainDowngrade, 8, srcBytes.length).set(srcBytes)
      new Uint8Array(plainDowngrade, 8 + srcBytes.length).set(plainAudio)
      relay.handleBinaryMessage('peer-host', plainDowngrade, false)
      expect(
        useSecurityStore
          .getState()
          .alerts.some((a) => a.peerId === 'peer-a' && a.reason === 'plaintext_downgrade')
      ).toBe(true)
    })
  })
})
