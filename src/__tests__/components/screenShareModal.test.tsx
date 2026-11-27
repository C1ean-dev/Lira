// @vitest-environment jsdom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScreenShareModal } from '../../components/ScreenShareModal'
import { MediaManager } from '../../media/MediaManager'
import { useMediaStore } from '../../store/useMediaStore'

vi.mock('../../data/nativeAssets.json', () => ({ default: { categories: [], assets: [] } }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

describe('ScreenShareModal', () => {
  const originalElectronApi = (window as any).electronAPI
  const originalMediaState = useMediaStore.getState()

  beforeEach(() => {
    useMediaStore.setState({
      isScreenSharing: false,
      screenShareAudioVolume: 100,
      duckingEnabled: true,
      isHardwareAccelerationEnabled: true,
      screenShareOptimizationMode: 'quality',
      screenShareResolution: 'auto',
      screenShareFps: 'auto',
    })
    ;(window as any).electronAPI = {
      getSources: vi.fn(async () => [
        { id: 'screen:0:0', name: 'Tela 1', thumbnail: '' },
      ]),
      getProcessAudioCaptureInfo: vi.fn(async () => ({ supported: true })),
    }
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    useMediaStore.setState(originalMediaState)
    ;(window as any).electronAPI = originalElectronApi
  })

  it('locks the confirm button while starting and ignores double clicks', async () => {
    const pending = deferred<MediaStream | null>()
    const startSpy = vi.spyOn(MediaManager.getInstance(), 'startScreenShare').mockReturnValue(pending.promise)
    const onClose = vi.fn()

    render(<ScreenShareModal isOpen={true} onClose={onClose} />)

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Iniciar Apresentação/i })
      expect((btn as HTMLButtonElement).disabled).toBe(false)
    })

    const confirmBtn = screen.getByRole('button', { name: /Iniciar Apresentação/i })
    fireEvent.click(confirmBtn)
    fireEvent.click(confirmBtn)

    expect(startSpy).toHaveBeenCalledTimes(1)
    const loadingBtn = screen.getByRole('button', { name: /Iniciando\.\.\./i }) as HTMLButtonElement
    expect(loadingBtn.disabled).toBe(true)
    expect(loadingBtn.getAttribute('aria-busy')).toBe('true')
    expect(onClose).not.toHaveBeenCalled()

    pending.resolve(null)
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('cancels pending startScreenShare when user clicks Cancelar while starting', async () => {
    const pending = deferred<MediaStream | null>()
    vi.spyOn(MediaManager.getInstance(), 'startScreenShare').mockReturnValue(pending.promise)
    const cancelSpy = vi.spyOn(MediaManager.getInstance(), 'cancelPendingScreenShare').mockImplementation(() => {})
    const onClose = vi.fn()

    render(<ScreenShareModal isOpen={true} onClose={onClose} />)

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Iniciar Apresentação/i })
      expect((btn as HTMLButtonElement).disabled).toBe(false)
    })

    fireEvent.click(screen.getByRole('button', { name: /Iniciar Apresentação/i }))
    expect(screen.getByRole('button', { name: /Iniciando\.\.\./i })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Cancelar$/i }))
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)

    pending.resolve(null)
    await Promise.resolve()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
