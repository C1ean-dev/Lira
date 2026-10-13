import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isNewerVersion, UpdateService, CURRENT_APP_VERSION } from '../../services/updateService'
import * as platform from '../../utils/platform'

describe('Update Service & Version Checker', () => {
  it('preserves the download reason without showing Electron transport details', async () => {
    const previous = (globalThis as any).window
    ;(globalThis as any).window = { electronAPI: { downloadUpdate: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'download-update': Error: Sem espaço no disco para salvar a atualização.")) } }
    try {
      await expect(UpdateService.downloadUpdate('https://example.com/setup.exe')).rejects.toThrow(/^Sem espaço no disco para salvar a atualização\.$/)
    } finally { (globalThis as any).window = previous }
  })
  it('should accurately compare semver versions', () => {
    expect(isNewerVersion('v1.0.1', '1.0.0')).toBe(true)
    expect(isNewerVersion('v1.1.0', '1.0.9')).toBe(true)
    expect(isNewerVersion('v2.0.0', '1.9.9')).toBe(true)
    expect(isNewerVersion('v1.0.0', '1.0.0')).toBe(false)
    expect(isNewerVersion('v0.9.9', '1.0.0')).toBe(false)
  })

  it('should detect update when GitHub release tag is higher than current app version', async () => {
    const mockRelease = {
      tag_name: 'v2.0.0',
      name: 'Release v2.0.0',
      body: 'Bug fixes and performance improvements',
      html_url: 'https://github.com/C1ean-dev/Lira/releases/tag/v2.0.0',
      assets: [
        {
          name: 'Lira-Setup-2.0.0.exe',
          browser_download_url: 'https://github.com/C1ean-dev/Lira/releases/download/v2.0.0/Lira-Setup.exe',
        },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockRelease,
    } as any)

    const updateInfo = await UpdateService.checkForUpdates()

    expect(updateInfo.hasUpdate).toBe(true)
    expect(updateInfo.latestVersion).toBe('v2.0.0')
    expect(updateInfo.downloadUrl).toBe(
      'https://github.com/C1ean-dev/Lira/releases/download/v2.0.0/Lira-Setup.exe'
    )
    expect(updateInfo.releaseNotes).toBe('Bug fixes and performance improvements')
  })

  it('should report no update when current version is already up to date', async () => {
    const mockRelease = {
      tag_name: `v${CURRENT_APP_VERSION}`,
      name: `Release v${CURRENT_APP_VERSION}`,
      body: 'Initial release',
      html_url: `https://github.com/C1ean-dev/Lira/releases/tag/v${CURRENT_APP_VERSION}`,
      assets: [],
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockRelease,
    } as any)

    const updateInfo = await UpdateService.checkForUpdates()

    expect(updateInfo.hasUpdate).toBe(false)
  })

  it('delegates downloadUpdate to window.electronAPI when running in Electron', async () => {
    const downloadMock = vi.fn().mockResolvedValue(true)
    ;(globalThis as any).window = {
      electronAPI: {
        isElectron: true,
        downloadUpdate: downloadMock,
      },
    }

    const res = await UpdateService.downloadUpdate('https://example.com/update.exe')
    expect(res).toBe(true)
    expect(downloadMock).toHaveBeenCalledWith('https://example.com/update.exe')

    delete (globalThis as any).window
  })

  it('delegates applyUpdate to window.electronAPI when running in Electron', async () => {
    const applyMock = vi.fn().mockResolvedValue(true)
    ;(globalThis as any).window = {
      electronAPI: {
        isElectron: true,
        applyUpdate: applyMock,
      },
    }

    const res = await UpdateService.applyUpdate('https://github.com/release')
    expect(res).toBe(true)
    expect(applyMock).toHaveBeenCalledWith(undefined)

    await UpdateService.applyUpdate('https://github.com/release', 'v1.0.79')
    expect(applyMock).toHaveBeenCalledWith('v1.0.79')

    await UpdateService.applyUpdate('v1.0.79', 'https://github.com/release')
    expect(applyMock).toHaveBeenCalledWith('v1.0.79')

    await UpdateService.applyUpdate('v1.0.79')
    expect(applyMock).toHaveBeenCalledWith('v1.0.79')

    delete (globalThis as any).window
  })

  it('detects .apk asset when running on Android', async () => {
    const isAndroidSpy = vi.spyOn(platform, 'isAndroid').mockReturnValue(true)

    const mockRelease = {
      tag_name: 'v2.0.0',
      name: 'Release v2.0.0',
      body: 'Android APK update',
      html_url: 'https://github.com/C1ean-dev/Lira/releases/tag/v2.0.0',
      assets: [
        {
          name: 'Lira-Setup-2.0.0.exe',
          browser_download_url: 'https://github.com/C1ean-dev/Lira/releases/download/v2.0.0/Lira-Setup.exe',
        },
        {
          name: 'Lira-v2.0.0.apk',
          browser_download_url: 'https://github.com/C1ean-dev/Lira/releases/download/v2.0.0/Lira-v2.0.0.apk',
        },
      ],
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockRelease,
    } as any)

    const updateInfo = await UpdateService.checkForUpdates()

    expect(updateInfo.hasUpdate).toBe(true)
    expect(updateInfo.downloadUrl).toBe(
      'https://github.com/C1ean-dev/Lira/releases/download/v2.0.0/Lira-v2.0.0.apk'
    )

    isAndroidSpy.mockRestore()
  })

  it('retrieves native version from AppUpdatePlugin on Android when available', async () => {
    const isAndroidSpy = vi.spyOn(platform, 'isAndroid').mockReturnValue(true)
    const mockPlugin: any = {
      getAppVersion: vi.fn().mockResolvedValue({
        versionName: '1.1.99',
        versionCode: 101099,
      }),
    }

    const version = await UpdateService.getCurrentVersion(mockPlugin)
    expect(version).toBe('1.1.99')
    expect(mockPlugin.getAppVersion).toHaveBeenCalled()

    isAndroidSpy.mockRestore()
  })

  it('resolves direct manual download url from updateInfo or version tag', () => {
    // 1. When downloadUrl is explicitly present
    const withDirectUrl = {
      hasUpdate: true,
      currentVersion: '1.0.0',
      latestVersion: '1.1.109',
      releaseName: 'v1.1.109',
      releaseNotes: '',
      downloadUrl: 'https://github.com/C1ean-dev/Lira/releases/download/v1.1.109/Lira.Setup.1.1.109.exe',
      releaseUrl: 'https://github.com/C1ean-dev/Lira/releases/tag/v1.1.109',
    }
    expect(UpdateService.getManualDownloadUrl(withDirectUrl)).toBe(
      'https://github.com/C1ean-dev/Lira/releases/download/v1.1.109/Lira.Setup.1.1.109.exe'
    )

    // 2. When downloadUrl is missing, construct direct download exe URL from latestVersion
    const withoutDirectUrl = {
      hasUpdate: true,
      currentVersion: '1.0.0',
      latestVersion: 'v1.1.109',
      releaseName: 'v1.1.109',
      releaseNotes: '',
      downloadUrl: null,
      releaseUrl: 'https://github.com/C1ean-dev/Lira/releases/tag/v1.1.109',
    }
    expect(UpdateService.getManualDownloadUrl(withoutDirectUrl)).toBe(
      'https://github.com/C1ean-dev/Lira/releases/download/v1.1.109/Lira.Setup.1.1.109.exe'
    )

    // 3. Fallback when updateInfo is null
    expect(UpdateService.getManualDownloadUrl(null)).toBe(
      'https://github.com/C1ean-dev/Lira/releases/latest'
    )
  })

  it('opens manual download url via electronAPI.openExternal or window.open', async () => {
    const openExternalMock = vi.fn().mockResolvedValue(undefined)
    ;(globalThis as any).window = {
      electronAPI: {
        openExternal: openExternalMock,
      },
    }

    await UpdateService.openManualDownload({
      hasUpdate: true,
      currentVersion: '1.0.0',
      latestVersion: '1.1.109',
      releaseName: '',
      releaseNotes: '',
      downloadUrl: 'https://github.com/C1ean-dev/Lira/releases/download/v1.1.109/Lira.Setup.1.1.109.exe',
      releaseUrl: '',
    })

    expect(openExternalMock).toHaveBeenCalledWith(
      'https://github.com/C1ean-dev/Lira/releases/download/v1.1.109/Lira.Setup.1.1.109.exe'
    )

    // Fallback to window.open when electronAPI is not present
    const openSpy = vi.fn()
    ;(globalThis as any).window = { open: openSpy }

    await UpdateService.openManualDownload(null)
    expect(openSpy).toHaveBeenCalledWith('https://github.com/C1ean-dev/Lira/releases/latest', '_blank')

    delete (globalThis as any).window
  })
})

