import { afterEach, expect, it, vi } from 'vitest'
import { GStreamerReceiver } from '../../media/gstreamerReceiver'

const session = 'a87cdfd3-1d62-447c-a155-50348760fe30'
const offer = 'm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 H264/90000\r\na=fmtp:96 profile-level-id=42042a\r\n'

function setup(answer = offer) {
  vi.useFakeTimers()
  let frames = 0
  const peer = {
    remoteDescription: null as RTCSessionDescriptionInit | null,
    localDescription: null as RTCSessionDescriptionInit | null,
    setRemoteDescription: vi.fn(async (description: RTCSessionDescriptionInit) => { peer.remoteDescription = description }),
    setLocalDescription: vi.fn(async (description: RTCSessionDescriptionInit) => { peer.localDescription = description }),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: answer })),
    addIceCandidate: vi.fn(async () => {}),
    getStats: vi.fn(async () => new Map([['inbound', { type: 'inbound-rtp', kind: 'video', framesDecoded: frames }]])),
    close: vi.fn(), ontrack: null as null | ((event: { track: MediaStreamTrack }) => void),
  }
  vi.stubGlobal('RTCPeerConnection', function () { return peer })
  vi.stubGlobal('MediaStream', class {
    constructor(private tracks: MediaStreamTrack[]) {}
    getVideoTracks() { return this.tracks }
  })
  const track = Object.assign(new EventTarget(), { kind: 'video', stop: vi.fn() }) as unknown as MediaStreamTrack
  const send = vi.fn()
  const ready = vi.fn()
  const failed = vi.fn()
  const receiver = new GStreamerReceiver(session, {}, send, ready, failed)
  return { receiver, peer, track, send, ready, failed, decoded: (count: number) => { frames = count } }
}

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('answers after normalizing the AMF offer, buffers early ICE, and activates reception only once after decoding', async () => {
  const { receiver, peer, track, send, ready, failed, decoded } = setup()
  const candidate = { candidate: 'candidate:1', sdpMLineIndex: 0 }
  receiver.receive({ kind: 'ice', session, candidate })
  receiver.receive({ kind: 'sdp', session, description: { type: 'offer', sdp: offer } })
  await vi.advanceTimersByTimeAsync(0)
  expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: offer.replace('42042a', '42002a') })
  expect(peer.addIceCandidate).toHaveBeenCalledWith(candidate)
  expect(send).toHaveBeenCalledWith({ kind: 'sdp', session, description: { type: 'answer', sdp: offer } })
  peer.ontrack?.({ track })
  await vi.advanceTimersByTimeAsync(500)
  expect(ready).not.toHaveBeenCalled()
  decoded(60)
  await vi.advanceTimersByTimeAsync(500)
  decoded(0)
  await vi.advanceTimersByTimeAsync(500)
  decoded(30)
  await vi.advanceTimersByTimeAsync(500)
  expect(ready).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(8000)
  expect(failed).toHaveBeenCalledOnce()
  expect(peer.close).toHaveBeenCalledOnce()
})

it('fails instead of sending a rejected H.264 answer', async () => {
  const { receiver, send, ready, failed } = setup(offer.replace('m=video 9', 'm=video 0'))
  receiver.receive({ kind: 'sdp', session, description: { type: 'offer', sdp: offer } })
  await vi.advanceTimersByTimeAsync(0)
  expect(send).not.toHaveBeenCalled()
  expect(ready).not.toHaveBeenCalled()
  expect(failed).toHaveBeenCalledOnce()
})
