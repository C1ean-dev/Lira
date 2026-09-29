import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUpdateStore } from '../store/useUpdateStore'
import { UpdateService } from '../services/updateService'

describe('useUpdateStore - Silent Background Download & Direct Button Update Flow', () => {
  beforeEach(() => {
    useUpdateStore.setState({
      updateInfo: null,
      status: 'idle',
      progress: { percent: 0, downloaded: 0, total: 0 },
      error: null,
    })
    vi.restoreAllMocks()
  })

  it('automatically downloads in background when update is detected', async () => {
    const mockUpdateInfo = {
      hasUpdate: true,
      currentVersion: '1.0.0',
      latestVersion: '1.0.5',
      releaseName: 'Release v1.0.5',
      releaseNotes: 'Performance improvements',
      downloadUrl: 'https://example.com/setup.exe',
      releaseUrl: 'https://github.com/example/release',
    }

    vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(mockUpdateInfo)
    vi.spyOn(UpdateService, 'isUpdateDownloaded').mockResolvedValue(false)

    let resolveDownload: (value: boolean) => void = () => {}
    const downloadPromise = new Promise<boolean>((resolve) => {
      resolveDownload = resolve
    })
    vi.spyOn(UpdateService, 'downloadUpdate').mockReturnValue(downloadPromise)

    const checkPromise = useUpdateStore.getState().checkForUpdatesAndDownload()

    // While download is ongoing, status is downloading
    await new Promise((r) => setTimeout(r, 10))
    expect(useUpdateStore.getState().status).toBe('downloading')

    // Complete the background download
    resolveDownload(true)
    await checkPromise

    // Status becomes ready, enabling the Atualizar Agora button on UI
    expect(useUpdateStore.getState().status).toBe('ready')
  })

  it('immediately marks status as ready if update installer was already downloaded', async () => {
    const mockUpdateInfo = {
      hasUpdate: true,
      currentVersion: '1.0.0',
      latestVersion: '1.0.5',
      releaseName: 'Release v1.0.5',
      releaseNotes: 'Performance improvements',
      downloadUrl: 'https://example.com/setup.exe',
      releaseUrl: 'https://github.com/example/release',
    }

    vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(mockUpdateInfo)
    vi.spyOn(UpdateService, 'isUpdateDownloaded').mockResolvedValue(true)

    await useUpdateStore.getState().checkForUpdatesAndDownload()

    expect(useUpdateStore.getState().status).toBe('ready')
  })

  it('handles clicking the button to apply the update directly', async () => {
    useUpdateStore.setState({
      status: 'ready',
      updateInfo: {
        hasUpdate: true,
        currentVersion: '1.0.0',
        latestVersion: '1.0.5',
        releaseName: 'Release v1.0.5',
        releaseNotes: 'Performance improvements',
        downloadUrl: 'https://example.com/setup.exe',
        releaseUrl: 'https://github.com/example/release',
      },
    })

    const applySpy = vi.spyOn(UpdateService, 'applyUpdate').mockResolvedValue(true)

    const success = await useUpdateStore.getState().applyUpdate()
    expect(success).toBe(true)
    expect(applySpy).toHaveBeenCalledWith('https://github.com/example/release', '1.0.5')
    expect(useUpdateStore.getState().status).toBe('installing')
    expect(useUpdateStore.getState().isUpdateScreenOpen).toBe(true)
  })

  it('opens interactive update screen with progress when startInteractiveUpdate is called', async () => {
    useUpdateStore.setState({
      status: 'downloading',
      isUpdateScreenOpen: false,
      progress: { percent: 45, downloaded: 45000000, total: 100000000 },
    })

    await useUpdateStore.getState().startInteractiveUpdate()
    expect(useUpdateStore.getState().isUpdateScreenOpen).toBe(true)
  })

  it('automatically triggers download if applyUpdate is called when not downloaded yet', async () => {
    useUpdateStore.setState({
      status: 'idle',
      updateInfo: {
        hasUpdate: true,
        currentVersion: '1.0.0',
        latestVersion: '1.0.5',
        releaseName: 'Release v1.0.5',
        releaseNotes: 'Performance improvements',
        downloadUrl: 'https://example.com/setup.exe',
        releaseUrl: 'https://github.com/example/release',
      },
    })

    vi.spyOn(UpdateService, 'isUpdateDownloaded').mockResolvedValue(false)
    const downloadSpy = vi.spyOn(UpdateService, 'downloadUpdate').mockResolvedValue(true)
    const applySpy = vi.spyOn(UpdateService, 'applyUpdate').mockResolvedValue(true)

    const success = await useUpdateStore.getState().applyUpdate()
    expect(success).toBe(true)
    expect(downloadSpy).toHaveBeenCalledWith('https://example.com/setup.exe', '1.0.5')
    expect(applySpy).toHaveBeenCalledWith('https://github.com/example/release', '1.0.5')
    expect(useUpdateStore.getState().status).toBe('installing')
  })
})
