import { create } from 'zustand'
import { UpdateInfo, UpdateProgress, UpdateService } from '../services/updateService'

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error'

export interface UpdateStore {
  updateInfo: UpdateInfo | null
  status: UpdateStatus
  progress: UpdateProgress
  error: string | null

  // State setters
  setUpdateInfo: (info: UpdateInfo | null) => void
  setStatus: (status: UpdateStatus) => void
  setProgress: (progress: UpdateProgress) => void
  setError: (error: string | null) => void

  // Flows
  checkForUpdatesAndDownload: (inLobbyGetter?: () => boolean) => Promise<void>
  applyUpdate: () => Promise<boolean>
}

let unsubProgress: (() => void) | null = null
let unsubDownloaded: (() => void) | null = null

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  updateInfo: null,
  status: 'idle',
  progress: { percent: 0, downloaded: 0, total: 0 },
  error: null,

  setUpdateInfo: (info) => set({ updateInfo: info }),
  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),

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

      // Check if update was already downloaded
      const alreadyDownloaded = await UpdateService.isUpdateDownloaded()
      if (alreadyDownloaded) {
        set({
          status: 'ready',
          progress: { percent: 100, downloaded: 1, total: 1 },
        })
        return
      }

      // Automatically download in background when detected (no modal)
      set({
        status: 'downloading',
        progress: { percent: 0, downloaded: 0, total: 0 },
      })

      if (unsubProgress) unsubProgress()
      unsubProgress = UpdateService.onProgress((p) => {
        set({ progress: p })
        if (p.percent >= 100) {
          set({ status: 'ready' })
        }
      })

      if (unsubDownloaded) unsubDownloaded()
      unsubDownloaded = UpdateService.onUpdateDownloaded(() => {
        set({
          status: 'ready',
          progress: { percent: 100, downloaded: 1, total: 1 },
        })
      })

      const success = await UpdateService.downloadUpdate(info.downloadUrl)
      if (success) {
        set({
          status: 'ready',
          progress: { percent: 100, downloaded: 1, total: 1 },
        })
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
    set({ status: 'installing' })
    const info = get().updateInfo
    try {
      const success = await UpdateService.applyUpdate(info?.releaseUrl)
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
}))
