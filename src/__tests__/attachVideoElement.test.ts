import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { attachStreamToVideo } from '../media/attachVideoElement'
import { diagStats, __resetDiagForTests } from '../utils/diagnosticLogger'

const tick = () => new Promise<void>((r) => setTimeout(r, 0))

function fakeTrack(kind: 'audio' | 'video') {
  return {
    kind,
    enabled: true,
    muted: false,
    readyState: 'live',
    label: `fake-${kind}`,
    id: `fake-${kind}-track-id-123456789`,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
}

function fakeStream() {
  const audio = fakeTrack('audio')
  const video = fakeTrack('video')
  return {
    audio,
    video,
    getAudioTracks: () => [audio],
    getVideoTracks: () => [video],
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
}

function fakeVideo(playImpl: () => Promise<void> = () => Promise.resolve()) {
  return {
    srcObject: null as unknown,
    muted: false,
    play: vi.fn(playImpl),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
}

describe('attachStreamToVideo', () => {
  beforeEach(() => __resetDiagForTests())
  afterEach(() => __resetDiagForTests())

  it('sets srcObject, logs attach, and logs play-ok on resolve', async () => {
    const video = fakeVideo()
    const stream = fakeStream()
    const before = diagStats().buffered

    attachStreamToVideo(video as unknown as HTMLVideoElement, stream as unknown as MediaStream, {
      tile: 'mini',
      peer: 'Bob',
    })
    expect(video.srcObject).toBe(stream)
    expect(video.play).toHaveBeenCalledTimes(1)
    expect(diagStats().buffered - before).toBe(1) // attach only (play-ok is async)

    await tick()
    expect(diagStats().buffered - before).toBe(2) // attach + play-ok
  })

  it('re-attaching the same stream does not reset srcObject or re-log attach', async () => {
    const video = fakeVideo()
    const stream = fakeStream()
    attachStreamToVideo(video as unknown as HTMLVideoElement, stream as unknown as MediaStream, {
      tile: 'mini',
      peer: 'Bob',
    })
    await tick()
    const before = diagStats().buffered

    attachStreamToVideo(video as unknown as HTMLVideoElement, stream as unknown as MediaStream, {
      tile: 'mini',
      peer: 'Bob',
    })
    expect(video.srcObject).toBe(stream)
    expect(video.play).toHaveBeenCalledTimes(2) // silent play retry, no new attach
    await tick()
    // Only the reattach play-ok, no second attach event.
    expect(diagStats().buffered - before).toBe(1)
  })

  it('logs play-failed and retries play when the AUDIO track unmutes', async () => {
    const abort = Object.assign(new Error('interrupted'), { name: 'AbortError' })
    const video = fakeVideo(() => Promise.reject(abort))
    const stream = fakeStream()

    attachStreamToVideo(video as unknown as HTMLVideoElement, stream as unknown as MediaStream, {
      tile: 'mini',
      peer: 'Bob',
    })
    await tick()
    // attach + play-failed
    expect(diagStats().buffered).toBe(2)
    expect(video.play).toHaveBeenCalledTimes(1)

    // The old code only listened to VIDEO unmute: audio unmute did nothing.
    // Find the unmute listener registered on the AUDIO track and fire it.
    const unmuteCall = stream.audio.addEventListener.mock.calls.find((c) => c[0] === 'unmute')
    expect(unmuteCall).toBeDefined()
    video.play.mockImplementation(() => Promise.resolve())
    ;(unmuteCall as unknown as [string, () => void])[1]()
    expect(video.play).toHaveBeenCalledTimes(2)
    await tick()
    expect(diagStats().buffered).toBe(3) // + play-ok via track-event
  })

  it('retries play on click (user gesture unlock)', async () => {
    const video = fakeVideo(() => Promise.resolve())
    const stream = fakeStream()
    attachStreamToVideo(video as unknown as HTMLVideoElement, stream as unknown as MediaStream, {
      tile: 'grid',
      peer: 'Ana',
    })
    await tick()
    const clickCall = video.addEventListener.mock.calls.find((c) => c[0] === 'click')
    expect(clickCall).toBeDefined()
    ;(clickCall as unknown as [string, () => void])[1]()
    expect(video.play).toHaveBeenCalledTimes(2)
  })

  it('cleanup removes all listeners', () => {
    const video = fakeVideo()
    const stream = fakeStream()
    const cleanup = attachStreamToVideo(
      video as unknown as HTMLVideoElement,
      stream as unknown as MediaStream,
      { tile: 'mini', peer: 'Bob' }
    )
    cleanup()
    expect(stream.removeEventListener).toHaveBeenCalled()
    expect(stream.audio.removeEventListener).toHaveBeenCalledWith('unmute', expect.any(Function))
    expect(stream.video.removeEventListener).toHaveBeenCalledWith('unmute', expect.any(Function))
    expect(video.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function))
  })
})
