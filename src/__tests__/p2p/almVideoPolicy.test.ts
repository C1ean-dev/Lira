import { afterEach, expect, it } from 'vitest'
import { __resetVideoSendPolicyForTests, applyScreenCaps, beginScreenShare, setAlmViewer, watchesLive } from '../../p2p/videoSendPolicy'

afterEach(__resetVideoSendPolicyForTests)

it('stops duplicate RTP video after ALM playback and restores it without stopping live audio', () => {
  beginScreenShare({ maxBitrate: 5_000_000, maxFramerate: 30 })
  let parameters = { encodings: [{ active: true }] }
  const sender = {
    getParameters: () => structuredClone(parameters),
    setParameters: (next: typeof parameters) => { parameters = next; return Promise.resolve() },
  } as unknown as RTCRtpSender
  setAlmViewer('viewer', true)
  applyScreenCaps(sender, 'viewer')
  expect(parameters.encodings[0].active).toBe(false)
  expect(watchesLive('viewer')).toBe(true)
  setAlmViewer('viewer', false)
  applyScreenCaps(sender, 'viewer')
  expect(parameters.encodings[0].active).toBe(true)
  expect(watchesLive('viewer')).toBe(true)
})
