import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useUpdateStore } from '../../store/useUpdateStore'
import { UpdateService } from '../../services/updateService'

describe('useUpdateStore - Silent Background Download & Direct Button Update Flow', () => {
  it('shows the download reason when an interactive retry fails instead of leaving an unhandled rejection', async () => {
    useUpdateStore.setState({ updateInfo: { hasUpdate: true, currentVersion: '1.0', latestVersion: '1.1', releaseName: '', releaseNotes: '', downloadUrl: 'https://example.com/setup.exe', releaseUrl: '' } })
    vi.spyOn(UpdateService, 'isUpdateDownloaded').mockResolvedValue(false)
    vi.spyOn(UpdateService, 'downloadUpdate').mockRejectedValue(new Error('Sem espaço para salvar a atualização.'))
    expect(await useUpdateStore.getState().applyUpdate()).toBe(false)
    expect(useUpdateStore.getState().status).toBe('error')
    expect(useUpdateStore.getState().error).toBe('Sem espaço para salvar a atualização.')
  })
  it('does not install on 100% byte progress before the installer has finished saving', async () => {
    let progress!: (value: { percent: number; downloaded: number; total: number }) => void
    let finish!: (value: boolean) => void
    vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue({ hasUpdate: true, currentVersion: '1.0.0', latestVersion: '1.0.5', releaseName: '', releaseNotes: '', downloadUrl: 'https://example.com/setup.exe', releaseUrl: 'https://example.com/release' })
    vi.spyOn(UpdateService, 'isUpdateDownloaded').mockResolvedValue(false)
    vi.spyOn(UpdateService, 'onProgress').mockImplementation(callback => { progress = callback; return () => {} })
    vi.spyOn(UpdateService, 'onUpdateDownloaded').mockReturnValue(() => {})
    vi.spyOn(UpdateService, 'downloadUpdate').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const apply = vi.spyOn(UpdateService, 'applyUpdate').mockResolvedValue(true)
    useUpdateStore.setState({ isUpdateScreenOpen: true })
    const pending = useUpdateStore.getState().checkForUpdatesAndDownload()
    await vi.waitFor(() => expect(progress).toBeTypeOf('function'))
    progress({ percent: 100, downloaded: 100, total: 100 })
    const statusAtEndOfBytes = useUpdateStore.getState().status
    const installationsAtEndOfBytes = apply.mock.calls.length
    useUpdateStore.setState({ isUpdateScreenOpen: false })
    finish(true)
    await pending
    expect(statusAtEndOfBytes).toBe('downloading')
    expect(installationsAtEndOfBytes).toBe(0)
  })
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

    await new Promise((r) => setTimeout(r, 10))
    expect(useUpdateStore.getState().status).toBe('downloading')

    resolveDownload(true)
    await checkPromise

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

  it('delegates openManualDownload to UpdateService with store updateInfo', async () => {
    const mockUpdateInfo = {
      hasUpdate: true,
      currentVersion: '1.0.0',
      latestVersion: '1.1.109',
      releaseName: 'Release v1.1.109',
      releaseNotes: '',
      downloadUrl: 'https://github.com/C1ean-dev/Lira/releases/download/v1.1.109/Lira.Setup.1.1.109.exe',
      releaseUrl: 'https://github.com/C1ean-dev/Lira/releases/tag/v1.1.109',
    }
    useUpdateStore.setState({ updateInfo: mockUpdateInfo })

    const openSpy = vi.spyOn(UpdateService, 'openManualDownload').mockResolvedValue(undefined)
    await useUpdateStore.getState().openManualDownload()

    expect(openSpy).toHaveBeenCalledWith(mockUpdateInfo)
  })
})

