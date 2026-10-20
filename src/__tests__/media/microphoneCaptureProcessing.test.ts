import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaManager } from '../../media/MediaManager'
import { useMediaStore } from '../../store/useMediaStore'

describe('microphone capture processing during a call', () => {
  let manager: MediaManager
  let microphone: any
  const getUserMedia = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('window', { addEventListener: vi.fn() })
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, addEventListener: vi.fn() } })
    manager = new (MediaManager as any)()
    microphone = { kind: 'audio', enabled: false, readyState: 'live', applyConstraints: vi.fn().mockResolvedValue(undefined), stop: vi.fn() }
    ;(manager as any).rawUserStream = { getAudioTracks: () => [microphone] }
    useMediaStore.setState({ selectedAudioInput: 'usb-mic', echoCancellation: false, autoGainControl: false })
    getUserMedia.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('applies echo and gain changes to the active microphone without stopping the call', async () => {
    const raw = (manager as any).rawUserStream

    await manager.updateCaptureProcessing()

    expect(microphone.applyConstraints).toHaveBeenCalledExactlyOnceWith({ echoCancellation: false, autoGainControl: false, noiseSuppression: false })
    expect((manager as any).rawUserStream).toBe(raw)
    expect(microphone.enabled).toBe(false)
    expect(microphone.stop).not.toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('does not open the microphone when settings change outside a call', async () => {
    ;(manager as any).rawUserStream = null

    await manager.updateCaptureProcessing()

    expect(getUserMedia).not.toHaveBeenCalled()
    expect(microphone.applyConstraints).not.toHaveBeenCalled()
  })

  it('does not update or reopen an input that has already ended', async () => {
    microphone.readyState = 'ended'

    await manager.updateCaptureProcessing()

    expect(getUserMedia).not.toHaveBeenCalled()
    expect(microphone.applyConstraints).not.toHaveBeenCalled()
  })

  it('reacquires the selected input if the driver cannot update processing in place', async () => {
    microphone.applyConstraints.mockRejectedValue(new Error('driver does not support live changes'))
    const changeInput = vi.spyOn(manager, 'changeAudioInput').mockResolvedValue(true)

    await manager.updateCaptureProcessing()

    expect(changeInput).toHaveBeenCalledExactlyOnceWith('usb-mic')
  })

  it('serializes changes so an older update cannot overwrite the latest choice', async () => {
    let finish!: () => void
    microphone.applyConstraints.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const first = manager.updateCaptureProcessing()
    await vi.waitFor(() => expect(microphone.applyConstraints).toHaveBeenCalledTimes(1))
    useMediaStore.setState({ autoGainControl: true })
    const second = manager.updateCaptureProcessing()
    expect(microphone.applyConstraints).toHaveBeenCalledTimes(1)
    finish()
    await Promise.all([first, second])

    expect(microphone.applyConstraints).toHaveBeenLastCalledWith({ echoCancellation: false, autoGainControl: true, noiseSuppression: false })
  })

  it('does not reopen the microphone if the call ends while the driver is updating', async () => {
    let reject!: (error: Error) => void
    microphone.applyConstraints.mockImplementationOnce(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    const changeInput = vi.spyOn(manager, 'changeAudioInput').mockResolvedValue(true)
    const updating = manager.updateCaptureProcessing()
    await vi.waitFor(() => expect(microphone.applyConstraints).toHaveBeenCalledTimes(1))
    ;(manager as any).mediaGeneration++
    ;(manager as any).rawUserStream = null
    reject(new Error('microphone stopped'))
    await updating

    expect(changeInput).not.toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()
  })
})
