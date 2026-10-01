import { describe, it, expect, vi, afterEach } from 'vitest'
import { prioritizeH264HardwareCodec } from '../media/hardwareCodec'

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

    // Mock global RTCRtpReceiver.getCapabilities
    ;(globalThis as any).RTCRtpReceiver = {
      getCapabilities: vi.fn().mockReturnValue({
        codecs: mockCodecs,
      }),
    }

    prioritizeH264HardwareCodec(mockPc)

    expect(setCodecPreferencesMock).toHaveBeenCalledTimes(1)
    const passedCodecs = setCodecPreferencesMock.mock.calls[0][0]

    // Verify H264 is at index 0 (first in preference list)
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

  it('prioritizeH264InSdp reorders m=video payload list to place H.264 at the front', async () => {
    const { prioritizeH264InSdp } = await import('../media/hardwareCodec')
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

  it('allows toggling hardware acceleration on and off dynamically', async () => {
    const {
      isHardwareAccelerationEnabled,
      setHardwareAccelerationEnabled,
      prioritizeCodecInSdp,
    } = await import('../media/hardwareCodec')

    const sampleSdp = [
      'v=0',
      'm=video 9 UDP/TLS/RTP/SAVPF 96 102',
      'a=rtpmap:96 VP8/90000',
      'a=rtpmap:102 H264/90000',
      'a=fmtp:102 profile-level-id=42e01f;packetization-mode=1',
    ].join('\r\n')

    // Disable HW acceleration
    setHardwareAccelerationEnabled(false)
    expect(isHardwareAccelerationEnabled()).toBe(false)

    // With HW disabled, SDP should prioritize VP8 (software)
    const disabledSdp = prioritizeCodecInSdp(sampleSdp)
    expect(disabledSdp).toContain('m=video 9 UDP/TLS/RTP/SAVPF 96 102')

    // Re-enable HW acceleration
    setHardwareAccelerationEnabled(true)
    expect(isHardwareAccelerationEnabled()).toBe(true)

    // With HW enabled, SDP should prioritize H.264
    const enabledSdp = prioritizeCodecInSdp(sampleSdp)
    expect(enabledSdp).toContain('m=video 9 UDP/TLS/RTP/SAVPF 102 96')
  })

  it('sorts VP8 first when hardware acceleration is disabled', async () => {
    const { setHardwareAccelerationEnabled, prioritizeH264HardwareCodec } = await import(
      '../media/hardwareCodec'
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

    // Reset back to default true
    setHardwareAccelerationEnabled(true)
  })
})

