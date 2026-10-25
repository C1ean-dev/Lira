import { contextBridge, ipcRenderer } from 'electron'
import type { SpotifyPlaybackCommand, SpotifyPlaybackResult } from '../src/types/spotifyPlayback'

export interface UpdateInfo {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  releaseName: string
  releaseNotes: string
  downloadUrl: string | null
  releaseUrl: string
}

export interface UpdateProgress {
  percent: number
  downloaded: number
  total: number
}

export interface ProcessAudioCaptureResult {
  ok: boolean
  error?: string
}

export interface ProcessAudioCaptureInfo {
  supported: boolean
  osRelease: string
  helperPath: string
  helperExists: boolean
  error?: string
}

export interface AppSettings {
  openAtLogin: boolean
  closeToTray: boolean
  minimizeToTray: boolean
}

export interface SpotifyTrackInfo {
  isRunning: boolean
  isPlaying: boolean
  track?: string
  artist?: string
  rawTitle?: string
}

export interface SpotifySourceResult {
  sourceId: string
  name: string
  isPlaying?: boolean
  track?: string
  artist?: string
  isScreenFallback?: boolean
  isBrowserPlayer?: boolean
}

export interface IElectronAPI {
  getSources: () => Promise<Array<{ id: string; name: string; thumbnail: string; appIcon: string | null }>>
  setScreenSource: (sourceId: string | null, withAudio?: boolean, captureMethod?: string, sourceName?: string | null) => Promise<boolean>
  stopScreenCapture: () => Promise<boolean>
  startProcessAudioCapture: (sourceId: string) => Promise<ProcessAudioCaptureResult>
  getProcessAudioCaptureInfo: () => Promise<ProcessAudioCaptureInfo>
  stopProcessAudioCapture: () => Promise<boolean>
  onProcessAudioData: (callback: (data: Uint8Array) => void) => () => void
  onProcessAudioStatus: (callback: (event: { status: 'started' | 'stopped' | 'error'; detail?: string }) => void) => () => void
  onWindowVisibility: (callback: (visible: boolean) => void) => () => void
  isElectron: boolean
  checkForUpdates: () => Promise<UpdateInfo>
  downloadUpdate: (downloadUrl: string, targetVersion?: string) => Promise<boolean>
  applyUpdate: (targetVersion?: string) => Promise<boolean>
  isUpdateDownloaded: (targetVersion?: string) => Promise<boolean>
  onUpdateDownloaded: (callback: (payload?: { installerPath?: string; version?: string }) => void) => () => void
  downloadAndInstallUpdate: (downloadUrl: string, targetVersion?: string) => Promise<boolean>
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => () => void
  openExternal: (url: string) => Promise<void>
  openSpotifyPlayer: (url?: string) => Promise<{ ok: boolean; error?: string }>
  closeSpotifyPlayer: () => Promise<{ ok: boolean; error?: string }>
  openSpotifyLogin: () => Promise<{ ok: boolean; error?: string }>
  completeSpotifyLogin: () => Promise<{ ok: boolean; error?: string }>
  getSpotifyLoginState: () => Promise<import('../src/types/spotifyLogin').SpotifyLoginState>
  getSpotifyPlaybackFrame: () => Promise<SpotifyPlaybackResult>
  searchSpotifyMusic: (query: string) => Promise<SpotifyPlaybackResult>
  queueSpotifyTrack: (track: import('../src/types/spotifySearch').SpotifySearchTrack, operationId: string) => Promise<import('../src/types/spotifyDjRequests').SpotifyDjRequestResult>
  getSpotifySearchSuggestions: (query: string, requesterId?: string) => Promise<import('../src/types/spotifySearch').SpotifySearchResult>
  startSpotifyTabAudioCapture: () => Promise<{ ok: boolean; error?: string }>
  stopSpotifyTabAudioCapture: () => Promise<boolean>
  onSpotifyTabAudioData: (callback: (data: Uint8Array) => void) => () => void
  onSpotifyTabAudioStatus: (callback: (event: { status: 'started' | 'stopped' | 'error'; detail?: string }) => void) => () => void
  spotifyPlaybackCommand: (command: SpotifyPlaybackCommand) => Promise<SpotifyPlaybackResult>
  getSpotifyCurrentTrack: () => Promise<SpotifyTrackInfo>
  findSpotifySource: () => Promise<SpotifySourceResult | null>
  onSpotifyTrackChanged: (callback: (info: SpotifyTrackInfo) => void) => () => void
  onSpotifyPlayerClosed: (callback: () => void) => () => void
  completeAssetAtlasMigration: () => Promise<boolean>
  loadAssetAtlas: () => Promise<{ xml: string; png: string } | null>
  loadIndividualLibrary: () => Promise<import('../src/assets/individualLibrary').LibraryLocation | null>
  saveIndividualLibrary: (packet: import('../src/assets/individualLibrary').LibraryPacket) => Promise<import('../src/assets/individualLibrary').LibraryLocation>
  saveAssetAtlas: (pair: { xml: string; png: string }) => Promise<boolean>
  loadNativeAssets: () => Promise<{ categories: string[]; assets: any[] } | null>
  saveNativeSpaces: (spaces: any[]) => Promise<boolean>
  loadNativeSpaces: () => Promise<any[] | null>
  checkFirewallStatus: () => Promise<{ isAllowed: boolean }>
  requestFirewallAccess: () => Promise<{ success: boolean; error?: string }>
  setFullScreen: (flag: boolean) => Promise<boolean>
  isFullScreen: () => Promise<boolean>
  diagnosticLogBatch: (entries: unknown[]) => Promise<{ ok: boolean; path: string | null }>
  openLogsFolder: () => Promise<string | null>
  exportLogBundle: () => Promise<{ ok: boolean; path: string | null }>
  logBatch: (records: unknown[]) => Promise<{ ok: boolean }>
  broadcastPresence?: (presence: any) => Promise<any[]>
  removePresence?: (userId: string) => Promise<void>
  sendCrossProcessMessage?: (message: any) => Promise<boolean>
  fetchCrossProcessMessages?: (payload: { forUserId: string; forUserName?: string }) => Promise<any[]>
  getAppSettings: () => Promise<AppSettings>
  setAppSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
  minimizeToTray: () => Promise<boolean>
  quitApp: () => Promise<boolean>
  showNativeNotification: (options: {
    title: string
    body: string
    sound?: boolean
    tag?: string
    actions?: Array<{ type: 'button'; text: string }>
  }) => Promise<{ ok: boolean }>
  onNotificationAction: (
    callback: (event: { tag?: string; action: 'click' | 'button'; buttonIndex?: number }) => void
  ) => () => void
  getSystemIdleTime: () => Promise<number>
  getSignalingConfig?: () => Promise<{ port: number }>
  localSignalingPort?: number
}

contextBridge.exposeInMainWorld('electronAPI', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  setScreenSource: (sourceId: string | null, withAudio: boolean = true, captureMethod = 'auto', sourceName?: string | null) =>
    ipcRenderer.invoke('set-screen-source', { sourceId, withAudio, captureMethod, sourceName }),
  stopScreenCapture: () => ipcRenderer.invoke('stop-screen-capture'),
  startProcessAudioCapture: (sourceId: string) => ipcRenderer.invoke('start-process-audio-capture', sourceId),
  getProcessAudioCaptureInfo: () => ipcRenderer.invoke('get-process-audio-capture-info'),
  stopProcessAudioCapture: () => ipcRenderer.invoke('stop-process-audio-capture'),
  onProcessAudioData: (callback: (data: Uint8Array) => void) => {
    const handler = (_event: unknown, data: Uint8Array | { data?: number[] } | number[]) => {
      if (data instanceof Uint8Array) {
        callback(new Uint8Array(data))
      } else if (Array.isArray(data)) {
        callback(Uint8Array.from(data))
      } else if (data && Array.isArray(data.data)) {
        callback(Uint8Array.from(data.data))
      }
    }
    ipcRenderer.on('process-audio-data', handler)
    return () => ipcRenderer.removeListener('process-audio-data', handler)
  },
  onProcessAudioStatus: (callback: (event: { status: 'started' | 'stopped' | 'error'; detail?: string }) => void) => {
    const handler = (_event: unknown, event: { status: 'started' | 'stopped' | 'error'; detail?: string }) => callback(event)
    ipcRenderer.on('process-audio-status', handler)
    return () => ipcRenderer.removeListener('process-audio-status', handler)
  },
  onWindowVisibility: (callback: (visible: boolean) => void) => {
    const handler = (_event: unknown, payload: { visible?: boolean } | undefined) => callback(payload?.visible !== false)
    ipcRenderer.on('window-visibility', handler)
    return () => ipcRenderer.removeListener('window-visibility', handler)
  },
  isElectron: true,
  checkForUpdates: () => ipcRenderer.invoke('check-update'),
  downloadUpdate: (downloadUrl: string, targetVersion?: string) => ipcRenderer.invoke('download-update', downloadUrl, targetVersion),
  applyUpdate: (targetVersion?: string) => ipcRenderer.invoke('apply-update', targetVersion),
  isUpdateDownloaded: (targetVersion?: string) => ipcRenderer.invoke('is-update-downloaded', targetVersion),
  onUpdateDownloaded: (callback: (payload?: { installerPath?: string; version?: string }) => void) => {
    const handler = (_event: any, payload: any) => callback(payload)
    ipcRenderer.on('update-download-complete', handler)
    return () => {
      ipcRenderer.removeListener('update-download-complete', handler)
    }
  },
  downloadAndInstallUpdate: (downloadUrl: string, targetVersion?: string) => ipcRenderer.invoke('download-and-install-update', downloadUrl, targetVersion),
  onUpdateProgress: (callback: (progress: UpdateProgress) => void) => {
    const handler = (_event: any, data: UpdateProgress) => callback(data)
    ipcRenderer.on('update-download-progress', handler)
    return () => {
      ipcRenderer.removeListener('update-download-progress', handler)
    }
  },
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  openSpotifyPlayer: (url?: string) => ipcRenderer.invoke('open-spotify-player', url),
  closeSpotifyPlayer: () => ipcRenderer.invoke('close-spotify-player'),
  openSpotifyLogin: () => ipcRenderer.invoke('open-spotify-login'),
  completeSpotifyLogin: () => ipcRenderer.invoke('complete-spotify-login'),
  getSpotifyLoginState: () => ipcRenderer.invoke('get-spotify-login-state'),
  getSpotifyPlaybackFrame: () => ipcRenderer.invoke('get-spotify-playback-frame'),
  searchSpotifyMusic: (query: string) => ipcRenderer.invoke('search-spotify-music', query),
  queueSpotifyTrack: (track: import('../src/types/spotifySearch').SpotifySearchTrack, operationId: string) => ipcRenderer.invoke('queue-spotify-track', track, operationId),
  getSpotifySearchSuggestions: (query: string, requesterId?: string) => ipcRenderer.invoke('get-spotify-search-suggestions', query, requesterId),
    startSpotifyTabAudioCapture: () => ipcRenderer.invoke('start-spotify-tab-audio'),
    stopSpotifyTabAudioCapture: () => ipcRenderer.invoke('stop-spotify-tab-audio'),
    onSpotifyTabAudioData: (callback: (data: Uint8Array) => void) => {
      const handler = (_event: unknown, data: Uint8Array) => callback(new Uint8Array(data))
      ipcRenderer.on('spotify-tab-audio-data', handler)
      return () => ipcRenderer.removeListener('spotify-tab-audio-data', handler)
    },
    onSpotifyTabAudioStatus: (callback: (event: { status: 'started' | 'stopped' | 'error'; detail?: string }) => void) => {
      const handler = (_event: unknown, event: { status: 'started' | 'stopped' | 'error'; detail?: string }) => callback(event)
      ipcRenderer.on('spotify-tab-audio-status', handler)
      return () => ipcRenderer.removeListener('spotify-tab-audio-status', handler)
    },
  spotifyPlaybackCommand: (command: SpotifyPlaybackCommand) => ipcRenderer.invoke('spotify-playback-command', command),
  getSpotifyCurrentTrack: () => ipcRenderer.invoke('get-spotify-current-track'),
  findSpotifySource: () => ipcRenderer.invoke('find-spotify-source'),
  onSpotifyPlayerClosed: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('spotify:player-closed', handler)
    return () => ipcRenderer.removeListener('spotify:player-closed', handler)
  },
  onSpotifyTrackChanged: (callback: (info: SpotifyTrackInfo) => void) => {
    const handler = (_event: any, data: SpotifyTrackInfo) => callback(data)
    ipcRenderer.on('spotify:track-changed', handler)
    return () => {
      ipcRenderer.removeListener('spotify:track-changed', handler)
    }
  },
  loadAssetAtlas: () => ipcRenderer.invoke('load-asset-atlas'),
  loadIndividualLibrary: () => ipcRenderer.invoke('load-individual-library'),
  saveIndividualLibrary: (packet) => ipcRenderer.invoke('save-individual-library', packet),
  saveAssetAtlas: (pair: { xml: string; png: string }) => ipcRenderer.invoke('save-asset-atlas', pair),
  completeAssetAtlasMigration: () => ipcRenderer.invoke('complete-asset-atlas-migration'),
  loadNativeAssets: () => ipcRenderer.invoke('load-native-assets'),
  saveNativeSpaces: (spaces: any[]) => ipcRenderer.invoke('save-native-spaces', spaces),
  loadNativeSpaces: () => ipcRenderer.invoke('load-native-spaces'),
  checkFirewallStatus: () => ipcRenderer.invoke('check-firewall-status'),
  requestFirewallAccess: () => ipcRenderer.invoke('request-firewall-access'),
  setFullScreen: (flag: boolean) => ipcRenderer.invoke('set-fullscreen', flag),
  isFullScreen: () => ipcRenderer.invoke('is-fullscreen'),
  diagnosticLogBatch: (entries: unknown[]) => ipcRenderer.invoke('diagnostic-log-batch', entries),
  openLogsFolder: () => ipcRenderer.invoke('open-logs-folder'),
  exportLogBundle: () => ipcRenderer.invoke('export-log-bundle'),
  logBatch: (records: unknown[]) => ipcRenderer.invoke('renderer-log-batch', records),
  broadcastPresence: (presence: any) => ipcRenderer.invoke('broadcast-presence', presence),
  removePresence: (userId: string) => ipcRenderer.invoke('remove-presence', userId),
  sendCrossProcessMessage: (message: any) => ipcRenderer.invoke('send-cross-message', message),
  fetchCrossProcessMessages: (payload: { forUserId: string; forUserName?: string }) =>
    ipcRenderer.invoke('fetch-cross-messages', payload),
  getAppSettings: () => ipcRenderer.invoke('get-app-settings'),
  setAppSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('set-app-settings', settings),
  minimizeToTray: () => ipcRenderer.invoke('minimize-to-tray'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  showNativeNotification: (options: {
    title: string
    body: string
    sound?: boolean
    tag?: string
    actions?: Array<{ type: 'button'; text: string }>
  }) => ipcRenderer.invoke('show-native-notification', options),
  onNotificationAction: (
    callback: (event: { tag?: string; action: 'click' | 'button'; buttonIndex?: number }) => void
  ) => {
    const handler = (
      _event: unknown,
      data: { tag?: string; action: 'click' | 'button'; buttonIndex?: number }
    ) => callback(data)
    ipcRenderer.on('notification-action', handler)
    return () => ipcRenderer.removeListener('notification-action', handler)
  },
  getSystemIdleTime: () => ipcRenderer.invoke('get-system-idle-time'),
  getSignalingConfig: () => ipcRenderer.invoke('get-signaling-config'),
  localSignalingPort: (() => {
    try {
      return ipcRenderer.sendSync('get-signaling-port-sync') || 9000
    } catch {
      return 9000
    }
  })(),
} satisfies IElectronAPI)

try {
  const p = ipcRenderer.sendSync('get-signaling-port-sync')
  if (typeof window !== 'undefined' && p) {
    ;(window as any).__LIRA_LOCAL_SIGNALING_PORT__ = p
  }
} catch {}
