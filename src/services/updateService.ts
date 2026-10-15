import { registerPlugin } from '@capacitor/core'
import { isAndroid } from '../utils/platform'

export interface UpdateInfo {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseName: string
  releaseNotes: string
  downloadUrl: string | null
  releaseUrl: string
  checkFailed?: boolean
}

export interface UpdateProgress {
  percent: number
  downloaded: number
  total: number
}

export interface AppUpdatePluginInterface {
  getAppVersion(): Promise<{ versionName?: string; versionCode?: number }>
  canRequestPackageInstalls(): Promise<{ canInstall: boolean }>
  openInstallPermissionSettings(): Promise<{ success: boolean }>
  downloadAndInstallApk(options: { downloadUrl: string; targetVersion?: string }): Promise<{ success: boolean; path?: string }>
  installApk(): Promise<{ success: boolean }>
  addListener(
    eventName: 'onUpdateProgress',
    listenerFunc: (progress: { percent: number; downloaded: number; total: number }) => void
  ): Promise<any>
}

export const AppUpdate = registerPlugin<AppUpdatePluginInterface>('AppUpdatePlugin')

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
  static async getCurrentVersion(pluginOverride?: AppUpdatePluginInterface): Promise<string> {
    if (isAndroid()) {
      try {
        const plugin = pluginOverride || AppUpdate
        const res = await plugin.getAppVersion()
        if (res && res.versionName && res.versionName.trim()) {
          return res.versionName.trim()
        }
      } catch {}
    }
    return CURRENT_APP_VERSION
  }

  static async checkForUpdates(): Promise<UpdateInfo> {
    if (
      typeof window !== 'undefined' &&
      window.electronAPI &&
      typeof window.electronAPI.checkForUpdates === 'function'
    ) {
      return await window.electronAPI.checkForUpdates()
    }

    const currentVersion = await UpdateService.getCurrentVersion()

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
          currentVersion,
          latestVersion: currentVersion,
          releaseName: '',
          releaseNotes: '',
          downloadUrl: null,
          releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
          checkFailed: true,
        }
      }

      const data = await res.json()
      const latestTag = data.tag_name || ''
      const hasUpdate = isNewerVersion(latestTag, currentVersion)

      let downloadUrl: string | null = null
      if (Array.isArray(data.assets)) {
        if (isAndroid()) {
          const apkAsset = data.assets.find(
            (a: any) => a.name && a.name.endsWith('.apk')
          )
          if (apkAsset && apkAsset.browser_download_url) {
            downloadUrl = apkAsset.browser_download_url
          }
        } else {
          const exeAsset = data.assets.find(
            (a: any) => a.name && a.name.endsWith('.exe') && !a.name.includes('blockmap')
          )
          if (exeAsset && exeAsset.browser_download_url) {
            downloadUrl = exeAsset.browser_download_url
          }
        }
      }

      return {
        hasUpdate,
        currentVersion,
        latestVersion: latestTag,
        releaseName: data.name || latestTag,
        releaseNotes: data.body || '',
        downloadUrl,
        releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases`,
      }
    } catch (e) {
      return {
        hasUpdate: false,
        currentVersion,
        latestVersion: currentVersion,
        releaseName: '',
        releaseNotes: '',
        downloadUrl: null,
        releaseUrl: `https://github.com/${GITHUB_REPO}/releases`,
        checkFailed: true,
      }
    }
  }

  static async downloadUpdate(downloadUrl: string | null, targetVersion?: string): Promise<boolean> {
    if (
      typeof window !== 'undefined' &&
      window.electronAPI &&
      downloadUrl &&
      typeof window.electronAPI.downloadUpdate === 'function'
    ) {
      try {
        return targetVersion !== undefined
          ? await window.electronAPI.downloadUpdate(downloadUrl, targetVersion)
          : await window.electronAPI.downloadUpdate(downloadUrl)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Falha ao baixar a atualização.'
        throw new Error(message.replace(/^Error invoking remote method 'download-update':\s*(?:Error:\s*)?/, ''))
      }
    }

    if (isAndroid() && downloadUrl) {
      return true
    }

    return true
  }

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

    if (isAndroid()) {
      try {
        const res = await AppUpdate.installApk()
        return !!res.success
      } catch {}
    }

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

  static async installUpdate(downloadUrl: string | null, releaseUrl: string, targetVersion?: string): Promise<boolean> {
    if (
      typeof window !== 'undefined' &&
      window.electronAPI &&
      downloadUrl &&
      typeof window.electronAPI.downloadAndInstallUpdate === 'function'
    ) {
      return await window.electronAPI.downloadAndInstallUpdate(downloadUrl, targetVersion)
    }

    if (isAndroid() && downloadUrl) {
      try {
        const res = await AppUpdate.downloadAndInstallApk({ downloadUrl, targetVersion })
        return !!res.success
      } catch (e: any) {
        console.error('[UpdateService] Error executing Android in-app update:', e)
        if (typeof window !== 'undefined') {
          window.open(downloadUrl, '_blank')
        }
        return false
      }
    }

    if (
      typeof window !== 'undefined' &&
      window.electronAPI &&
      typeof window.electronAPI.openExternal === 'function'
    ) {
      await window.electronAPI.openExternal(releaseUrl)
    } else if (typeof window !== 'undefined') {
      const targetUrl = isAndroid() && downloadUrl ? downloadUrl : releaseUrl
      window.open(targetUrl, '_blank')
    }
    return true
  }

  static async openExternalUrl(url: string): Promise<void> {
    if (
      typeof window !== 'undefined' &&
      window.electronAPI &&
      typeof window.electronAPI.openExternal === 'function'
    ) {
      await window.electronAPI.openExternal(url)
    } else if (typeof window !== 'undefined') {
      window.open(url, '_blank')
    }
  }

  static getManualDownloadUrl(updateInfo?: UpdateInfo | null): string {
    if (updateInfo?.downloadUrl) {
      return updateInfo.downloadUrl
    }
    if (updateInfo?.latestVersion) {
      const cleanVer = updateInfo.latestVersion.replace(/^v/i, '').trim()
      const tag = `v${cleanVer}`
      if (isAndroid()) {
        return `https://github.com/${GITHUB_REPO}/releases/download/${tag}/Lira-v${cleanVer}.apk`
      }
      return `https://github.com/${GITHUB_REPO}/releases/download/${tag}/Lira.Setup.${cleanVer}.exe`
    }
    return updateInfo?.releaseUrl || `https://github.com/${GITHUB_REPO}/releases/latest`
  }

  static async openManualDownload(updateInfo?: UpdateInfo | null): Promise<void> {
    const url = this.getManualDownloadUrl(updateInfo)
    await this.openExternalUrl(url)
  }

  static onProgress(callback: (progress: UpdateProgress) => void): () => void {
    if (
      typeof window !== 'undefined' &&
      window.electronAPI &&
      typeof window.electronAPI.onUpdateProgress === 'function'
    ) {
      return window.electronAPI.onUpdateProgress(callback)
    }

    if (isAndroid()) {
      let handle: any = null
      AppUpdate.addListener('onUpdateProgress', (progress) => {
        callback(progress)
      }).then((h) => {
        handle = h
      }).catch(() => {})

      return () => {
        if (handle && typeof handle.remove === 'function') {
          handle.remove()
        }
      }
    }

    return () => {}
  }
}
