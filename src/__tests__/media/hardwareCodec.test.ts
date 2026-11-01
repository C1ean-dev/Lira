import { describe, it, expect, vi, afterEach } from 'vitest'
import { prioritizeH264HardwareCodec } from '../../media/hardwareCodec'

describe('WebRTC Hardware Codec Acceleration (H.264 Priority)', () => {
  afterEach(() => {
    delete (globalThis as any).RTCRtpSender
    delete (globalThis as any).RTCRtpReceiver
  })

  it('should safely do nothing if peerConnection is null or missing transceivers', () => {
    expect(() => prioritizeH264HardwareCodec(null)).not.toThrow()
    expect(() => prioritizeH264HardwareCodec({} as any)).not.toThrow()
  })

  it('should sort H264 codecs to the front and call setCodecPreferences on video transceivers', () => {
    const mockCodecs = [
      { mimeType: 'video/VP8', clockRate: 90000 },
      { mimeType: 'video/VP9', clockRate: 90000 },
      { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'profile-level-id=42e01f' },
      { mimeType: 'video/AV1', clockRate: 90000 },
    ]

    const setCodecPreferencesMock = vi.fn()

    const mockTransceiver = {
      sender: { track: { kind: 'video' } },
      receiver: { track: { kind: 'video' } },
      setCodecPreferences: setCodecPreferencesMock,
    }

    const mockPc = {
      getTransceivers: vi.fn().mockReturnValue([mockTransceiver]),
    } as unknown as RTCPeerConnection

    ;(globalThis as any).RTCRtpReceiver = {
      getCapabilities: vi.fn().mockReturnValue({
        codecs: mockCodecs,
      }),
    }

    prioritizeH264HardwareCodec(mockPc)

    expect(setCodecPreferencesMock).toHaveBeenCalledTimes(1)
    const passedCodecs = setCodecPreferencesMock.mock.calls[0][0]

    expect(passedCodecs[0].mimeType).toBe('video/H264')
    expect(passedCodecs.length).toBe(4)
  })

  it('should strictly only apply setCodecPreferences to video transceivers and ignore audio transceivers', () => {
    const mockCodecs = [
      { mimeType: 'video/VP8', clockRate: 90000 },
      { mimeType: 'video/H264', clockRate: 90000 },
    ]

    const audioMock = vi.fn()
    const videoMock = vi.fn()

    const audioTransceiver = {
      receiver: { track: { kind: 'audio' } },
      setCodecPreferences: audioMock,
    }
    const videoTransceiver = {
      receiver: { track: { kind: 'video' } },
      setCodecPreferences: videoMock,
    }

    const mockPc = {
      getTransceivers: vi.fn().mockReturnValue([audioTransceiver, videoTransceiver]),
    } as unknown as RTCPeerConnection

    ;(globalThis as any).RTCRtpReceiver = {
      getCapabilities: vi.fn().mockReturnValue({ codecs: mockCodecs }),
    }

    prioritizeH264HardwareCodec(mockPc)

    expect(audioMock).not.toHaveBeenCalled()
    expect(videoMock).toHaveBeenCalledTimes(1)
  })

  it('should prioritize packetization-mode=1 H264 codecs over other H264 profiles', () => {
    const mockCodecs = [
      { mimeType: 'video/VP8', clockRate: 90000 },
      { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'profile-level-id=42001f;packetization-mode=0' },
      { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=1' },
    ]

    const setCodecPreferencesMock = vi.fn()
    const videoTransceiver = {
      receiver: { track: { kind: 'video' } },
      setCodecPreferences: setCodecPreferencesMock,
    }
    const mockPc = {
      getTransceivers: vi.fn().mockReturnValue([videoTransceiver]),
    } as unknown as RTCPeerConnection

    ;(globalThis as any).RTCRtpReceiver = {
      getCapabilities: vi.fn().mockReturnValue({ codecs: mockCodecs }),
    }

    prioritizeH264HardwareCodec(mockPc)

    const passedCodecs = setCodecPreferencesMock.mock.calls[0][0]
    expect(passedCodecs[0].sdpFmtpLine).toContain('packetization-mode=1')
    expect(passedCodecs[1].sdpFmtpLine).toContain('packetization-mode=0')
    expect(passedCodecs[2].mimeType).toBe('video/VP8')
  })

  it('prioritizes High Profile (6400xx) H264 mode 1 codecs above Baseline (42e0xx) mode 1 codecs for hardware acceleration', () => {
    const mockCodecs = [
      { mimeType: 'video/VP8', clockRate: 90000 },
      { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=1' },
      { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'profile-level-id=640032;packetization-mode=1' },
      { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'profile-level-id=42001f;packetization-mode=0' },
    ]

    const setCodecPreferencesMock = vi.fn()
    const videoTransceiver = {
      receiver: { track: { kind: 'video' } },
      setCodecPreferences: setCodecPreferencesMock,
    }
    const mockPc = {
      getTransceivers: vi.fn().mockReturnValue([videoTransceiver]),
    } as unknown as RTCPeerConnection

    ;(globalThis as any).RTCRtpReceiver = {
      getCapabilities: vi.fn().mockReturnValue({ codecs: mockCodecs }),
    }

    prioritizeH264HardwareCodec(mockPc)

    const passedCodecs = setCodecPreferencesMock.mock.calls[0][0]
    expect(passedCodecs[0].sdpFmtpLine).toContain('profile-level-id=640032')
    expect(passedCodecs[1].sdpFmtpLine).toContain('profile-level-id=42e01f')
    expect(passedCodecs[2].sdpFmtpLine).toContain('profile-level-id=42001f')
  })

  it('prioritizeH264InSdp reorders m=video payload list to place H.264 at the front', async () => {
    const { prioritizeH264InSdp } = await import('../../media/hardwareCodec')
    const sampleSdp = [
      'v=0',
      'o=- 12345 2 IN IP4 127.0.0.1',
      's=-',
      'm=video 9 UDP/TLS/RTP/SAVPF 96 97 102 104',
      'a=rtpmap:96 VP8/90000',
      'a=rtpmap:97 VP9/90000',
      'a=rtpmap:102 H264/90000',
      'a=fmtp:102 profile-level-id=42e01f;packetization-mode=1',
      'a=rtpmap:104 H264/90000',
      'a=fmtp:104 profile-level-id=42001f;packetization-mode=0',
    ].join('\r\n')

    const munged = prioritizeH264InSdp(sampleSdp)
    expect(munged).toContain('m=video 9 UDP/TLS/RTP/SAVPF 102 104 96 97\r\na=rtpmap:96')
    expect(munged).not.toContain('97a=rtpmap')
  })

  it('prioritizeH264InSdp reorders m=video payload list to place High Profile H.264 at the front', async () => {
    const { prioritizeH264InSdp } = await import('../../media/hardwareCodec')
    const sampleSdp = [
      'v=0',
      'o=- 12345 2 IN IP4 127.0.0.1',
      's=-',
      'm=video 9 UDP/TLS/RTP/SAVPF 96 97 102 103 104',
      'a=rtpmap:96 VP8/90000',
      'a=rtpmap:97 VP9/90000',
      'a=rtpmap:102 H264/90000',
      'a=fmtp:102 profile-level-id=42e01f;packetization-mode=1',
      'a=rtpmap:103 H264/90000',
      'a=fmtp:103 profile-level-id=640032;packetization-mode=1',
      'a=rtpmap:104 H264/90000',
      'a=fmtp:104 profile-level-id=42001f;packetization-mode=0',
    ].join('\r\n')

    const munged = prioritizeH264InSdp(sampleSdp)
    expect(munged).toContain('m=video 9 UDP/TLS/RTP/SAVPF 103 102 104 96 97\r\na=rtpmap:96')
  })

  it('allows toggling hardware acceleration on and off dynamically', async () => {
    const {
      isHardwareAccelerationEnabled,
      setHardwareAccelerationEnabled,
      prioritizeCodecInSdp,
    } = await import('../../media/hardwareCodec')

    const sampleSdp = [
      'v=0',
      'm=video 9 UDP/TLS/RTP/SAVPF 96 102',
      'a=rtpmap:96 VP8/90000',
      'a=rtpmap:102 H264/90000',
      'a=fmtp:102 profile-level-id=42e01f;packetization-mode=1',
    ].join('\r\n')

    setHardwareAccelerationEnabled(false)
    expect(isHardwareAccelerationEnabled()).toBe(false)

    const disabledSdp = prioritizeCodecInSdp(sampleSdp)
    expect(disabledSdp).toContain('m=video 9 UDP/TLS/RTP/SAVPF 96 102')

    setHardwareAccelerationEnabled(true)
    expect(isHardwareAccelerationEnabled()).toBe(true)

    const enabledSdp = prioritizeCodecInSdp(sampleSdp)
    expect(enabledSdp).toContain('m=video 9 UDP/TLS/RTP/SAVPF 102 96')
  })

  it('sorts VP8 first when hardware acceleration is disabled', async () => {
    const { setHardwareAccelerationEnabled, prioritizeH264HardwareCodec } = await import('../../media/hardwareCodec'
    )

    setHardwareAccelerationEnabled(false)

    const mockCodecs = [
      { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'profile-level-id=42e01f;packetization-mode=1' },
      { mimeType: 'video/VP8', clockRate: 90000 },
      { mimeType: 'video/VP9', clockRate: 90000 },
    ]

    const setCodecPreferencesMock = vi.fn()
    const videoTransceiver = {
      receiver: { track: { kind: 'video' } },
      setCodecPreferences: setCodecPreferencesMock,
    }
    const mockPc = {
      getTransceivers: vi.fn().mockReturnValue([videoTransceiver]),
    } as unknown as RTCPeerConnection

    ;(globalThis as any).RTCRtpReceiver = {
      getCapabilities: vi.fn().mockReturnValue({ codecs: mockCodecs }),
    }

    prioritizeH264HardwareCodec(mockPc)

    const passedCodecs = setCodecPreferencesMock.mock.calls[0][0]
    expect(passedCodecs[0].mimeType).toBe('video/VP8')
    expect(passedCodecs[1].mimeType).toBe('video/VP9')
    expect(passedCodecs[2].mimeType).toBe('video/H264')

    setHardwareAccelerationEnabled(true)
  })

  it('detects whether an active RTCPeerConnection is sending H.264 or VP8', async () => {
    const { isConnectionSendingH264 } = await import('../../media/hardwareCodec')

    const pcH264 = {
      currentLocalDescription: {
        sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 102 96\r\na=rtpmap:102 H264/90000\r\na=rtpmap:96 VP8/90000\r\n',
      },
    } as unknown as RTCPeerConnection

    const pcVP8 = {
      currentLocalDescription: {
        sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96 102\r\na=rtpmap:96 VP8/90000\r\na=rtpmap:102 H264/90000\r\n',
      },
    } as unknown as RTCPeerConnection

    const pcNoVideo = {
      currentLocalDescription: {
        sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n',
      },
    } as unknown as RTCPeerConnection

    expect(isConnectionSendingH264(pcH264)).toBe(true)
    expect(isConnectionSendingH264(pcVP8)).toBe(false)
    expect(isConnectionSendingH264(pcNoVideo)).toBeNull()
    expect(isConnectionSendingH264(null as any)).toBeNull()
  })

  it('provides sdpTransform prioritizing H.264 when dialing and answering calls', async () => {
    const { MediaCallHandler } = await import('../../p2p/mediaCalls')
    const { useMediaStore } = await import('../../store/useMediaStore')
    const { useGameStore } = await import('../../store/useGameStore')
    const { setHardwareAccelerationEnabled } = await import('../../media/hardwareCodec')

    setHardwareAccelerationEnabled(true)

    const mockAudioTrack = { kind: 'audio', readyState: 'live', enabled: true }
    const mockStream = {
      getAudioTracks: () => [mockAudioTrack],
      getVideoTracks: () => [],
    } as unknown as MediaStream
    useMediaStore.setState({ localStream: mockStream, isScreenSharing: false, localScreenStream: null })

    const localPlayer = { id: 'local-p', currentZoneId: 'zone-1' } as any
    const remotePlayer = { id: 'remote-p', currentZoneId: 'zone-1', name: 'Remote' } as any
    useGameStore.setState({
      localPlayer,
      remotePlayers: { 'remote-p': remotePlayer },
      callStates: {},
    })

    const sampleSdp = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96 102\r\na=rtpmap:96 VP8/90000\r\na=rtpmap:102 H264/90000\r\na=fmtp:102 profile-level-id=42e01f;packetization-mode=1\r\n'

    // 1. Dialing (checkZoneCallEligibility)
    const mockCall = { peer: 'remote-p', on: vi.fn(), close: vi.fn() }
    const mockPeer = {
      call: vi.fn().mockReturnValue(mockCall),
    } as any

    const mediaCalls = new Map<string, any>()
    MediaCallHandler.checkZoneCallEligibility(remotePlayer, mockPeer, mediaCalls, vi.fn())

    expect(mockPeer.call).toHaveBeenCalledTimes(1)
    const dialOptions = mockPeer.call.mock.calls[0][2]
    expect(dialOptions).toBeDefined()
    expect(typeof dialOptions.sdpTransform).toBe('function')
    const transformedDialSdp = dialOptions.sdpTransform(sampleSdp)
    expect(transformedDialSdp).toContain('m=video 9 UDP/TLS/RTP/SAVPF 102 96')

    // 2. Answering (handleIncomingCall)
    const incomingCall = {
      peer: 'remote-p',
      answer: vi.fn(),
      on: vi.fn(),
      close: vi.fn(),
    } as any

    MediaCallHandler.handleIncomingCall({
      call: incomingCall,
      myId: 'local-p',
      mediaCalls: new Map(),
      endMediaCallWithPeer: vi.fn(),
    })

    expect(incomingCall.answer).toHaveBeenCalledTimes(1)
    const answerOptions = incomingCall.answer.mock.calls[0][1]
    expect(answerOptions).toBeDefined()
    expect(typeof answerOptions.sdpTransform).toBe('function')
    const transformedAnswerSdp = answerOptions.sdpTransform(sampleSdp)
    expect(transformedAnswerSdp).toContain('m=video 9 UDP/TLS/RTP/SAVPF 102 96')
  })

  it('triggers onRedialNeeded when starting screen share if the connection is stuck on VP8', async () => {
    const { MediaCallHandler } = await import('../../p2p/mediaCalls')
    const { setHardwareAccelerationEnabled } = await import('../../media/hardwareCodec')

    setHardwareAccelerationEnabled(true)

    const mockSender = {
      track: { kind: 'video' },
      replaceTrack: vi.fn().mockResolvedValue(undefined),
      getParameters: vi.fn().mockReturnValue({ encodings: [{}] }),
      setParameters: vi.fn().mockResolvedValue(undefined),
    }

    const mockPcVP8 = {
      getSenders: vi.fn().mockReturnValue([mockSender]),
      getTransceivers: vi.fn().mockReturnValue([]),
      currentLocalDescription: {
        sdp: 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96 102\r\na=rtpmap:96 VP8/90000\r\na=rtpmap:102 H264/90000\r\n',
      },
    }

    const mockCall = {
      peer: 'peer-1',
      peerConnection: mockPcVP8,
      on: vi.fn(),
      close: vi.fn(),
    }

    const mediaCalls = new Map<string, any>([['peer-1', mockCall]])
    const fakeScreenTrack = {
      kind: 'video',
      id: 'screen-track-1',
      enabled: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaStreamTrack

    const redialNeededMock = vi.fn()

    MediaCallHandler.replaceVideoTrack(
      mediaCalls,
      fakeScreenTrack,
      true, // isScreenShare
      10_000_000,
      60,
      'maintain-framerate',
      redialNeededMock
    )

    expect(redialNeededMock).toHaveBeenCalledWith('peer-1')
  })

  it('redials zone calls when hardware acceleration is toggled in useMediaStore', async () => {
    const { useMediaStore } = await import('../../store/useMediaStore')
    const { PeerManager } = await import('../../p2p/PeerManager')

    const redialSpy = vi.spyOn(PeerManager.getInstance(), 'redialZoneCalls').mockImplementation(() => {})

    useMediaStore.getState().setHardwareAccelerationEnabled(false)
    expect(redialSpy).toHaveBeenCalled()

    redialSpy.mockClear()
    useMediaStore.getState().toggleHardwareAcceleration()
    expect(redialSpy).toHaveBeenCalled()
  })
})

