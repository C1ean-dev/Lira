import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isNewerVersion, UpdateService, CURRENT_APP_VERSION } from '../services/updateService'

describe('Update Service & Version Checker', () => {
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
      html_url: 'https://github.com/C1ean-dev/gather-clone/releases/tag/v2.0.0',
      assets: [
        {
          name: 'Gather-Clone-Setup-2.0.0.exe',
          browser_download_url: 'https://github.com/C1ean-dev/gather-clone/releases/download/v2.0.0/Gather-Clone-Setup.exe',
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
      'https://github.com/C1ean-dev/gather-clone/releases/download/v2.0.0/Gather-Clone-Setup.exe'
    )
    expect(updateInfo.releaseNotes).toBe('Bug fixes and performance improvements')
  })

  it('should report no update when current version is already up to date', async () => {
    const mockRelease = {
      tag_name: `v${CURRENT_APP_VERSION}`,
      name: `Release v${CURRENT_APP_VERSION}`,
      body: 'Initial release',
      html_url: `https://github.com/C1ean-dev/gather-clone/releases/tag/v${CURRENT_APP_VERSION}`,
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

    // Test passing releaseUrl first, then version
    await UpdateService.applyUpdate('https://github.com/release', 'v1.0.79')
    expect(applyMock).toHaveBeenCalledWith('v1.0.79')

    // Test passing version first, then releaseUrl
    await UpdateService.applyUpdate('v1.0.79', 'https://github.com/release')
    expect(applyMock).toHaveBeenCalledWith('v1.0.79')

    // Test passing only version
    await UpdateService.applyUpdate('v1.0.79')
    expect(applyMock).toHaveBeenCalledWith('v1.0.79')

    delete (globalThis as any).window
  })
})
