import { afterEach, describe, expect, it, vi } from 'vitest'
import { MediaManager } from '../../media/MediaManager'
import { useMediaStore } from '../../store/useMediaStore'
import { NoiseSuppressor } from '../../media/NoiseSuppressor'
import { DeepFilterProcessor } from '../../media/DeepFilterProcessor'
import { RnnoiseProcessor } from '../../media/RnnoiseProcessor'

const original = useMediaStore.getState()
afterEach(() => { useMediaStore.setState(original); vi.restoreAllMocks() })

describe('microphone while collapsing the call panel', () => {
  it('resumes the existing engine without muting, replacing or stopping its outgoing track', async () => {
    const track = { enabled: true, stop: vi.fn() }
    const stream = { getAudioTracks: () => [track] } as any
    useMediaStore.setState({ isMuted: false, localStream: stream })
    const manager = Object.create(MediaManager.prototype) as any
    manager.activeEngine = { resumeContext: vi.fn(async () => {}), dispose: vi.fn() }
    await manager.resumeMicrophone()
    expect(manager.activeEngine.resumeContext).toHaveBeenCalledOnce()
    expect(manager.activeEngine.dispose).not.toHaveBeenCalled()
    expect(useMediaStore.getState().localStream).toBe(stream)
    expect(useMediaStore.getState().isMuted).toBe(false)
    expect(track.enabled).toBe(true)
    expect(track.stop).not.toHaveBeenCalled()
    useMediaStore.setState({ isMuted: true })
    track.enabled = false
    await manager.resumeMicrophone()
    expect(manager.activeEngine.resumeContext).toHaveBeenCalledOnce()
    expect(track.enabled).toBe(false)
  })
  it.each([['classic', NoiseSuppressor], ['deepfilter', DeepFilterProcessor], ['rnnoise', RnnoiseProcessor]] as const)('recovers an interrupted audio context in %s', async (_name, Engine) => {
    const instance = new Engine() as any
    const engine = instance.engine ?? instance
    engine.audioCtx = { state: 'interrupted', resume: vi.fn(async () => {}) }
    await engine.resumeContext()
    expect(engine.audioCtx.resume).toHaveBeenCalledOnce()
    engine.audioCtx.state = 'closed'
    await engine.resumeContext()
    expect(engine.audioCtx.resume).toHaveBeenCalledOnce()
  })
})

