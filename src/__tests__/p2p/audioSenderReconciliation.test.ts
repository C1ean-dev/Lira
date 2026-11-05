import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaCallHandler } from '../../p2p/mediaCalls'
import { useMediaStore } from '../../store/useMediaStore'

const track = (id: string, enabled = true) => ({ id, kind: 'audio', enabled, readyState: 'live' }) as MediaStreamTrack
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function connection(initial: MediaStreamTrack | null) {
  const sender = { track: initial, replaceTrack: vi.fn(async (next: MediaStreamTrack | null) => { sender.track = next }) }
  const pc = { getSenders: () => [sender], getTransceivers: () => [{ sender, receiver: { track: { kind: 'audio' } } }] }
  const call = { peerConnection: pc } as any
  const calls = new Map([['peer-a', call]])
  return { sender, pc, call, calls }
}
afterEach(() => { useMediaStore.setState({ isScreenSharing: false, localScreenStream: null }); vi.restoreAllMocks() })

describe('microphone sender reconciliation', () => {
  it('reconciles only the participant that just connected', async () => {
    const mic = track('mic')
    const first = connection(track('first'))
    const second = connection(track('second'))
    first.calls.set('peer-b', second.call)
    MediaCallHandler.replaceAudioTrack(first.calls, mic, 'connected-reconcile', 'peer-b')
    await tick()
    expect(first.sender.replaceTrack).not.toHaveBeenCalled()
    expect(second.sender.replaceTrack).toHaveBeenCalledExactlyOnceWith(mic)
  })
  it('leaves the same microphone attached across repeated connections and mute changes', async () => {
    const mic = track('mic')
    const { calls, sender } = connection(mic)
    for (const enabled of [true, false, true]) {
      mic.enabled = enabled
      MediaCallHandler.replaceAudioTrack(calls, mic, 'connected-reconcile')
    }
    await tick()
    expect(sender.replaceTrack).not.toHaveBeenCalled()
    expect(sender.track).toBe(mic)
    expect(mic.enabled).toBe(true)
  })

  it('attaches an intentionally muted live microphone without unmuting it', async () => {
    const muted = track('muted', false)
    const { calls, sender } = connection(null)
    MediaCallHandler.replaceAudioTrack(calls, muted, 'connected-reconcile')
    await tick()
    expect(sender.replaceTrack).toHaveBeenCalledExactlyOnceWith(muted)
    expect(muted.enabled).toBe(false)
  })

  it('coalesces duplicate replacements while the first request is still pending', async () => {
    const mic = track('new-mic')
    const { calls, sender } = connection(track('old-mic'))
    let finish!: () => void
    sender.replaceTrack.mockImplementationOnce(() => new Promise<void>(resolve => { finish = () => { sender.track = mic; resolve() } }))
    MediaCallHandler.replaceAudioTrack(calls, mic, 'connected-reconcile')
    MediaCallHandler.replaceAudioTrack(calls, mic, 'connected-reconcile')
    expect(sender.replaceTrack).toHaveBeenCalledTimes(1)
    finish()
    await tick()
    expect(sender.track).toBe(mic)
  })

  it('serializes different requests, including restoring the track attached before an in-flight change', async () => {
    const original = track('original')
    const replacement = track('replacement')
    const { calls, sender } = connection(original)
    let finish!: () => void
    sender.replaceTrack.mockImplementationOnce(() => new Promise<void>(resolve => { finish = () => { sender.track = replacement; resolve() } }))
    MediaCallHandler.replaceAudioTrack(calls, replacement)
    MediaCallHandler.replaceAudioTrack(calls, original)
    expect(sender.replaceTrack).toHaveBeenCalledTimes(1)
    finish()
    await tick()
    expect(sender.replaceTrack.mock.calls.map(([value]) => value)).toEqual([replacement, original])
    expect(sender.track).toBe(original)
  })

  it('allows a retry after replacement failure', async () => {
    const mic = track('new-mic')
    const { calls, sender } = connection(track('old-mic'))
    sender.replaceTrack.mockRejectedValueOnce(new Error('temporary failure'))
    MediaCallHandler.replaceAudioTrack(calls, mic)
    await tick()
    MediaCallHandler.replaceAudioTrack(calls, mic)
    await tick()
    expect(sender.replaceTrack).toHaveBeenCalledTimes(2)
    expect(sender.track).toBe(mic)
  })

  it('drops a queued change if its call has been replaced before it can execute', async () => {
    const first = track('first')
    const { calls, sender } = connection(track('old'))
    let finish!: () => void
    sender.replaceTrack.mockImplementationOnce(() => new Promise<void>(resolve => { finish = () => { sender.track = first; resolve() } }))
    MediaCallHandler.replaceAudioTrack(calls, first)
    MediaCallHandler.replaceAudioTrack(calls, track('queued'))
    calls.set('peer-a', connection(track('other-call')).call)
    finish()
    await tick()
    expect(sender.replaceTrack).toHaveBeenCalledTimes(1)
    expect(sender.track).toBe(first)
  })

  it('does not attach an ended microphone or repeatedly detach an empty sender', async () => {
    const { calls, sender } = connection(null)
    MediaCallHandler.replaceAudioTrack(calls, null)
    MediaCallHandler.replaceAudioTrack(calls, { ...track('ended'), readyState: 'ended' } as MediaStreamTrack)
    await tick()
    expect(sender.replaceTrack).not.toHaveBeenCalled()
  })
})
