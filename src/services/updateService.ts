export interface UpdateInfo {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseName: string
  releaseNotes: string
  downloadUrl: string | null
  releaseUrl: string
  /**
   * True when GitHub could not be asked (offline, timeout, rate limit). The
   * other fields then say nothing about whether an update exists.
   */
  checkFailed?: boolean
}

export interface UpdateProgress {
  percent: number
  downloaded: number
  total: number
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean
      checkForUpdates: () => Promise<UpdateInfo>
      downloadUpdate?: (downloadUrl: string, targetVersion?: string) => Promise<boolean>
      applyUpdate?: (targetVersion?: string) => Promise<boolean>
      isUpdateDownloaded?: (targetVersion?: string) => Promise<boolean>
      onUpdateDownloaded?: (callback: (payload?: { installerPath?: string; version?: string }) => void) => () => void
      downloadAndInstallUpdate: (downloadUrl: string, targetVersion?: string) => Promise<boolean>
      onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void
      openExternal: (url: string) => Promise<void>
      getSources: () => Promise<any[]>
      setFullScreen?: (flag: boolean) => Promise<boolean>
      isFullScreen?: () => Promise<boolean>
    }
  }
}

declare const __APP_VERSION__: string | undefined

export const GITHUB_REPO = 'C1ean-dev/Lira'
export const CURRENT_APP_VERSION =
  typeof __APP_VERSION__ !== 'undefined'
    ? __APP_VERSION__
    : '1.0.0'

export function isNewerVersion(latestTag: string, currentVer: string): boolean {
  const clean = (v: string) => v.replace(/^v/i, '').trim().split('.').map(Number)
  const l = clean(latestTag)
  const c = clean(currentVer)
  for (let i = 0; i < Math.max(l.length, c.length); i++) {
    const lNum = isNaN(l[i]) ? 0 : l[i]
    const cNum = isNaN(c[i]) ? 0 : c[i]
    if (lNum > cNum) return true
    if (lNum < cNum) return false
  }
  return false
}

export class UpdateService {
  /**
   * Check for updates on GitHub Releases
   */
  static async checkForUpdates(): Promise<UpdateInfo> {
    if (
      typeof window !== 'undefined' &&
      window.electronAPI &&
      typeof window.electronAPI.checkForUpdates === 'function'
    ) {
      return await window.electronAPI.checkForUpdates()
    }

    // Web Fallback
    try {
      const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`
      const res = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        },
      })

      if (!res.ok) {
        return {
          hasUpdate: false,
          currentVersion: CURRENT_APP_VERSION,
          latestVersion: CURRENT_APP_VERSION,
          releaseName: '',
          releaseNotes: '',
          downloadUrl: null,
          releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
          checkFailed: true,
        }
      }

      const data = await res.json()
      const latestTag = data.tag_name || ''
      const hasUpdate = isNewerVersion(latestTag, CURRENT_APP_VERSION)

      let downloadUrl: string | null = null
      if (Array.isArray(data.assets)) {
        const exeAsset = data.assets.find(
          (a: any) => a.name && a.name.endsWith('.exe') && !a.name.includes('blockmap')
        )
        if (exeAsset && exeAsset.browser_download_url) {
          downloadUrl = exeAsset.browser_download_url
        }
      }

      return {
        hasUpdate,
        currentVersion: CURRENT_APP_VERSION,
        latestVersion: latestTag,
        releaseName: data.name || latestTag,
        releaseNotes: data.body || '',
        downloadUrl,
        releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases`,
      }
    } catch (e) {
      return {
        hasUpdate: false,
        currentVersion: CURRENT_APP_VERSION,
        latestVersion: CURRENT_APP_VERSION,
        releaseName: '',
        releaseNotes: '',
        downloadUrl: null,
        releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
        checkFailed: true,
      }
    }
  }

  /**
   * Download update in background
   */
  static async downloadUpdate(downloadUrl: string | null, targetVersion?: string): Promise<boolean> {
    if (
      typeof window !== 'undefined' &&
      window.electronAPI &&
      downloadUrl &&
      typeof window.electronAPI.downloadUpdate === 'function'
    ) {
      return targetVersion !== undefined
        ? await window.electronAPI.downloadUpdate(downloadUrl, targetVersion)
        : await window.electronAPI.downloadUpdate(downloadUrl)
    }
    // Web fallback: return true so web can proceed to prompt
    return true
  }

  /**
   * Apply already downloaded update (restarts app) or open browser in web mode
   */
  static async applyUpdate(targetVersionOrReleaseUrl?: string, fallbackUrlOrVersion?: string): Promise<boolean> {
    const isFirstUrl = targetVersionOrReleaseUrl?.startsWith('http')
    const isSecondUrl = fallbackUrlOrVersion?.startsWith('http')

    const targetVersion = isFirstUrl ? (isSecondUrl ? undefined : fallbackUrlOrVersion) : targetVersionOrReleaseUrl
    const releaseUrl = isFirstUrl ? targetVersionOrReleaseUrl : (isSecondUrl ? fallbackUrlOrVersion : undefined)

    if (
      typeof window !== 'undefined' &&
      window.electronAPI &&
      typeof window.electronAPI.applyUpdate === 'function'
    ) {
      return await window.electronAPI.applyUpdate(targetVersion)
    }

    // Web / browser fallback
    if (releaseUrl) {
      if (
        typeof window !== 'undefined' &&
        window.electronAPI &&
        typeof window.electronAPI.openExternal === 'function'
      ) {
        await window.electronAPI.openExternal(releaseUrl)
      } else if (typeof window !== 'undefined') {
        window.open(releaseUrl, '_blank')
      }
    }
    return true
  }

  /**
   * Check if update installer is already downloaded locally
   */
  static async isUpdateDownloaded(targetVersion?: string): Promise<boolean> {
    if (
      typeof window !== 'undefined' &&
      window.electronAPI &&
      typeof window.electronAPI.isUpdateDownloaded === 'function'
    ) {
      return await window.electronAPI.isUpdateDownloaded(targetVersion)
    }
    return false
  }

  /**
   * Listen for update download completion
   */
  static onUpdateDownloaded(callback: (payload?: { installerPath?: string; version?: string }) => void): () => void {
    if (
      typeof window !== 'undefined' &&
      window.electronAPI &&
      typeof window.electronAPI.onUpdateDownloaded === 'function'
    ) {
      return window.electronAPI.onUpdateDownloaded(callback)
    }
    return () => {}
  }

  /**
   * Download and run update installer or open browser
   */
  static async installUpdate(downloadUrl: string | null, releaseUrl: string, targetVersion?: string): Promise<boolean> {
    if (
      typeof window !== 'undefined' &&
      window.electronAPI &&
      downloadUrl &&
      typeof window.electronAPI.downloadAndInstallUpdate === 'function'
    ) {
      return await window.electronAPI.downloadAndInstallUpdate(downloadUrl, targetVersion)
    }

    // Web / external fallback
    if (
      typeof window !== 'undefined' &&
      window.electronAPI &&
      typeof window.electronAPI.openExternal === 'function'
    ) {
      await window.electronAPI.openExternal(releaseUrl)
    } else if (typeof window !== 'undefined') {
      window.open(releaseUrl, '_blank')
    }
    return true
  }

  /**
   * Listen to download progress
   */
  static onProgress(callback: (progress: UpdateProgress) => void): () => void {
    if (
      typeof window !== 'undefined' &&
      window.electronAPI &&
      typeof window.electronAPI.onUpdateProgress === 'function'
    ) {
      return window.electronAPI.onUpdateProgress(callback)
    }
    return () => {}
  }
}
