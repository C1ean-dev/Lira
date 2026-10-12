import { describe, expect, it } from 'vitest'
import { djMusicSdp } from '../../p2p/djMusicSdp'

const offer = ['v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111 0', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1;stereo=0;maxaveragebitrate=32000', 'a=rtpmap:0 PCMU/8000', 'm=video 9 UDP/TLS/RTP/SAVPF 96', 'a=rtpmap:96 VP8/90000', 'a=fmtp:96 max-fr=30', ''].join('\r\n')
describe('DJ music negotiation', () => {
  it('negotiates full-band stereo Opus on offers and answers, preserving other codecs and video', () => {
    const transformed = djMusicSdp(offer)
    expect(transformed).toContain('stereo=1')
    expect(transformed).toContain('sprop-stereo=1')
    expect(transformed).toContain('maxaveragebitrate=256000')
    expect(transformed).toContain('maxplaybackrate=48000')
    expect(transformed).toContain('usedtx=0')
    expect(transformed).toContain('minptime=10')
    expect(transformed).not.toContain('stereo=0')
    expect(transformed.split('m=video')[1]).toBe(offer.split('m=video')[1])
    expect(transformed).toContain('a=rtpmap:0 PCMU/8000')
    expect(djMusicSdp(transformed)).toBe(transformed)
  })
  it('finds the negotiated payload instead of assuming payload 111 and adds a missing fmtp', () => {
    const sdp = 'm=audio 9 UDP/TLS/RTP/SAVPF 109\na=rtpmap:109 opus/48000/2\na=sendonly\n'
    expect(djMusicSdp(sdp)).toContain('a=fmtp:109 stereo=1;')
    expect(djMusicSdp(sdp)).toContain('a=sendonly')
  })
  it('leaves calls without Opus unchanged', () => {
    const sdp = 'm=audio 9 RTP/AVP 0\na=rtpmap:0 PCMU/8000\n'
    expect(djMusicSdp(sdp)).toBe(sdp)
  })
})
