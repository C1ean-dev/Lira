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
})
