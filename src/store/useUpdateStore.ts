import { create } from 'zustand'
import { UpdateInfo, UpdateProgress, UpdateService } from '../services/updateService'

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error'

export interface UpdateStore {
  updateInfo: UpdateInfo | null
  status: UpdateStatus
  progress: UpdateProgress
  error: string | null
  isUpdateScreenOpen: boolean

  // State setters
  setUpdateInfo: (info: UpdateInfo | null) => void
  setStatus: (status: UpdateStatus) => void
  setProgress: (progress: UpdateProgress) => void
  setError: (error: string | null) => void
  setIsUpdateScreenOpen: (open: boolean) => void

  // Flows
  checkForUpdatesAndDownload: (inLobbyGetter?: () => boolean) => Promise<void>
  applyUpdate: () => Promise<boolean>
  startInteractiveUpdate: () => Promise<void>
}

let unsubProgress: (() => void) | null = null
let unsubDownloaded: (() => void) | null = null

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  updateInfo: null,
  status: 'idle',
  progress: { percent: 0, downloaded: 0, total: 0 },
  error: null,
  isUpdateScreenOpen: false,

  setUpdateInfo: (info) => set({ updateInfo: info }),
  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
  setIsUpdateScreenOpen: (open) => set({ isUpdateScreenOpen: open }),

  checkForUpdatesAndDownload: async () => {
    const currentStatus = get().status
    if (currentStatus === 'downloading' || currentStatus === 'ready' || currentStatus === 'installing') {
      return
    }

    set({ status: 'checking', error: null })

    try {
      const info = await UpdateService.checkForUpdates()
      if (!info || !info.hasUpdate) {
        set({ status: 'idle', updateInfo: info })
        return
      }

      set({ updateInfo: info })

      // Check if update was already downloaded for this specific version
      const alreadyDownloaded = await UpdateService.isUpdateDownloaded(info.latestVersion)
      if (alreadyDownloaded) {
        set({
          status: 'ready',
          progress: { percent: 100, downloaded: 1, total: 1 },
        })
        return
      }

      // Automatically download in background when detected (silent)
      set({
        status: 'downloading',
        progress: { percent: 0, downloaded: 0, total: 0 },
      })

      if (unsubProgress) unsubProgress()
      unsubProgress = UpdateService.onProgress((p) => {
        set({ progress: p })
        if (p.percent >= 100) {
          set({ status: 'ready' })
          if (get().isUpdateScreenOpen && get().status !== 'installing') {
            get().applyUpdate()
          }
        }
      })

      if (unsubDownloaded) unsubDownloaded()
      unsubDownloaded = UpdateService.onUpdateDownloaded(() => {
        set({
          status: 'ready',
          progress: { percent: 100, downloaded: 1, total: 1 },
        })
        if (get().isUpdateScreenOpen && get().status !== 'installing') {
          get().applyUpdate()
        }
      })

      const success = await UpdateService.downloadUpdate(info.downloadUrl, info.latestVersion)
      if (success) {
        set({
          status: 'ready',
          progress: { percent: 100, downloaded: 1, total: 1 },
        })
        if (get().isUpdateScreenOpen && get().status !== 'installing') {
          get().applyUpdate()
        }
      } else {
        set({
          status: 'error',
          error: 'Não foi possível baixar a atualização automaticamente.',
        })
      }
    } catch (err: any) {
      console.error('[Updater] Error during check and download:', err)
      set({
        status: 'error',
        error: err?.message || 'Erro ao processar atualização.',
      })
    }
  },

  applyUpdate: async () => {
    if (get().status === 'installing') {
      return false
    }

    const info = get().updateInfo
    const targetVer = info?.latestVersion

    // If update installer is not yet downloaded locally, download it first
    const isDownloaded = await UpdateService.isUpdateDownloaded(targetVer)
    if (!isDownloaded) {
      set({ status: 'downloading', isUpdateScreenOpen: true, error: null })
      const downloaded = await UpdateService.downloadUpdate(info?.downloadUrl || null, targetVer)
      if (!downloaded) {
        set({
          status: 'error',
          error: 'Falha ao baixar o instalador da atualização.',
        })
        return false
      }
    }

    set({ status: 'installing', isUpdateScreenOpen: true, error: null })
    try {
      // Keep UI visible for a brief moment so user sees the progress screen before app closes
      await new Promise((r) => setTimeout(r, 1200))
      const success = await UpdateService.applyUpdate(info?.releaseUrl, targetVer)
      if (!success) {
        set({
          status: 'error',
          error: 'Falha ao iniciar o instalador da nova versão.',
        })
        return false
      }
      return true
    } catch (err: any) {
      set({
        status: 'error',
        error: err?.message || 'Falha ao aplicar atualização.',
      })
      return false
    }
  },

  startInteractiveUpdate: async () => {
    set({ isUpdateScreenOpen: true, error: null })
    const currentStatus = get().status
    const info = get().updateInfo

    if (currentStatus === 'installing') {
      return
    }

    if (currentStatus === 'ready') {
      await get().applyUpdate()
    } else if (currentStatus === 'downloading') {
      // Screen is already opened with progress bar; will auto-apply when finished
    } else if (info?.hasUpdate) {
      await get().checkForUpdatesAndDownload()
      if (get().status === 'ready' && get().status !== 'installing') {
        await get().applyUpdate()
      }
    } else {
      await get().checkForUpdatesAndDownload()
    }
  },
}))
