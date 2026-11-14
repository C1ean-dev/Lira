import { describe, expect, it } from 'vitest'
import { opusVoiceSdp } from '../../p2p/opusVoiceSdp'

describe('opusVoiceSdp', () => {
  it('returns unchanged sdp if no audio section exists', () => {
    const sdp = 'v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n'
    expect(opusVoiceSdp(sdp)).toBe(sdp)
  })

  it('injects fmtp parameters for opus and ptime media attributes when none existed', () => {
    const sdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
      'm=video 9 UDP/TLS/RTP/SAVPF 96',
    ].join('\r\n')

    const transformed = opusVoiceSdp(sdp)
    expect(transformed).toContain('a=fmtp:111 ')
    expect(transformed).toContain('useinbandfec=1')
    expect(transformed).toContain('packetlossperc=10')
    expect(transformed).toContain('usedtx=1')
    expect(transformed).toContain('maxaveragebitrate=48000')
    expect(transformed).toContain('minptime=10')
    expect(transformed).toContain('a=ptime:20')
    expect(transformed).toContain('a=maxptime:60')
    // Must not contain DJ stereo override
    expect(transformed).not.toContain('stereo=1')
  })

  it('updates existing fmtp parameters and media attributes preserving others', () => {
    const sdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=rtpmap:111 opus/48000/2',
      'a=fmtp:111 minptime=20;cbr=1',
      'a=ptime:10',
      'a=maxptime:40',
    ].join('\n')

    const transformed = opusVoiceSdp(sdp)
    expect(transformed).toContain('a=fmtp:111 ')
    expect(transformed).toContain('cbr=1')
    expect(transformed).toContain('minptime=10')
    expect(transformed).toContain('useinbandfec=1')
    expect(transformed).toContain('packetlossperc=10')
    expect(transformed).toContain('usedtx=1')
    expect(transformed).toContain('a=ptime:20')
    expect(transformed).toContain('a=maxptime:60')
    expect(transformed).not.toContain('a=ptime:10')
    expect(transformed).not.toContain('a=maxptime:40')
  })
})
