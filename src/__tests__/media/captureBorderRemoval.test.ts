import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMediaStore } from '../../store/useMediaStore'
import fs from 'fs'
import path from 'path'

describe('Capture Border Removal System', () => {
  beforeEach(() => {
    useMediaStore.setState({ removeCaptureBorder: true })
  })

  it('defaults removeCaptureBorder to true', () => {
    const state = useMediaStore.getState()
    expect(state.removeCaptureBorder).toBe(true)
  })

  it('allows toggling removeCaptureBorder via toggleRemoveCaptureBorder', () => {
    const { toggleRemoveCaptureBorder } = useMediaStore.getState()

    toggleRemoveCaptureBorder()
    expect(useMediaStore.getState().removeCaptureBorder).toBe(false)

    toggleRemoveCaptureBorder()
    expect(useMediaStore.getState().removeCaptureBorder).toBe(true)
  })

  it('allows explicitly setting removeCaptureBorder via setRemoveCaptureBorder', () => {
    const { setRemoveCaptureBorder } = useMediaStore.getState()

    setRemoveCaptureBorder(false)
    expect(useMediaStore.getState().removeCaptureBorder).toBe(false)

    setRemoveCaptureBorder(true)
    expect(useMediaStore.getState().removeCaptureBorder).toBe(true)
  })

  it('persists removeCaptureBorder in localStorage under lira_audio_settings', () => {
    let savedKey = ''
    let savedValue = ''
    const fakeStorage = {
      getItem: () => null,
      setItem: (key: string, val: string) => {
        savedKey = key
        savedValue = val
      },
      removeItem: () => {},
    }
    vi.stubGlobal('localStorage', fakeStorage)
    vi.stubGlobal('window', { localStorage: fakeStorage })

    const { setRemoveCaptureBorder } = useMediaStore.getState()
    setRemoveCaptureBorder(false)

    expect(savedKey).toBe('lira_audio_settings')
    expect(savedValue).toContain('"removeCaptureBorder":false')

    vi.unstubAllGlobals()
  })

  it('verifies electron/main.ts contains all WGC disabling switches to avoid yellow border', () => {
    const mainTsPath = path.resolve(__dirname, '../../../electron/main.ts')
    const content = fs.readFileSync(mainTsPath, 'utf-8')

    expect(content).toContain('WebRtcAllowWgcScreenCapturer')
    expect(content).toContain('WebRtcAllowWgcWindowCapturer')
    expect(content).toContain('WebRtcAllowWgcDesktopCapturer')
    expect(content).toContain('WebRtcWgcRequireBorder')
  })

  it('verifies electron/preload.ts and main.ts register stop-screen-capture IPC', () => {
    const preloadPath = path.resolve(__dirname, '../../../electron/preload.ts')
    const preloadContent = fs.readFileSync(preloadPath, 'utf-8')
    expect(preloadContent).toContain('stopScreenCapture')

    const mainTsPath = path.resolve(__dirname, '../../../electron/main.ts')
    const mainContent = fs.readFileSync(mainTsPath, 'utf-8')
    expect(mainContent).toContain("'stop-screen-capture'")
    expect(mainContent).toContain('thumbnailSize: { width: 0, height: 0 }')
  })

  it('detaches video.srcObject and pauses video on cleanup in attachStreamToVideo', async () => {
    const { attachStreamToVideo } = await import('../../media/attachVideoElement')
    const fakeVideo = {
      srcObject: null as any,
      muted: false,
      paused: false,
      volume: 1,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as any

    const fakeStream = {
      getAudioTracks: () => [],
      getVideoTracks: () => [],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as any

    const cleanup = attachStreamToVideo(fakeVideo, fakeStream, { tile: 'test' })
    expect(fakeVideo.srcObject).toBe(fakeStream)

    cleanup()
    expect(fakeVideo.srcObject).toBeNull()
    expect(fakeVideo.pause).toHaveBeenCalled()
  })
})
