import { create } from 'zustand'
import { UpdateInfo, UpdateProgress, UpdateService } from '../services/updateService'
import { isAndroid } from '../utils/platform'

export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error'

export type ManualCheckState = 'checking' | 'up-to-date' | 'failed' | null

export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000
export const UPDATE_STALE_AFTER_MS = 10 * 60 * 1000
export const UPDATE_RETRY_DELAYS_MS = [60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000]
export const MANUAL_CHECK_FEEDBACK_MS = 4000

export function versionBadgeLabel(manualCheck: ManualCheckState, version: string): string {
  if (manualCheck === 'checking') return 'Verificando...'
  if (manualCheck === 'up-to-date') return 'Atualizado'
  if (manualCheck === 'failed') return 'Falha ao verificar'
  return version
}

export interface UpdateStore {
  updateInfo: UpdateInfo | null
  status: UpdateStatus
  progress: UpdateProgress
  error: string | null
  isUpdateScreenOpen: boolean
  lastCheckAt: number | null
  lastCheckFailed: boolean
  consecutiveCheckFailures: number
  manualCheck: ManualCheckState

  setUpdateInfo: (info: UpdateInfo | null) => void
  setStatus: (status: UpdateStatus) => void
  setProgress: (progress: UpdateProgress) => void
  setError: (error: string | null) => void
  setIsUpdateScreenOpen: (open: boolean) => void

  checkForUpdatesAndDownload: (inLobbyGetter?: () => boolean) => Promise<void>
  checkIfDue: (maxAgeMs?: number) => Promise<void>
  checkNow: () => Promise<void>
  applyUpdate: () => Promise<boolean>
  startInteractiveUpdate: () => Promise<void>
  openManualDownload: () => Promise<void>
}

let unsubProgress: (() => void) | null = null
let unsubDownloaded: (() => void) | null = null
let checkInFlight: Promise<void> | null = null
let manualFeedbackTimer: ReturnType<typeof setTimeout> | null = null

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  updateInfo: null,
  status: 'idle',
  progress: { percent: 0, downloaded: 0, total: 0 },
  error: null,
  isUpdateScreenOpen: false,
  lastCheckAt: null,
  lastCheckFailed: false,
  consecutiveCheckFailures: 0,
  manualCheck: null,

  setUpdateInfo: (info) => set({ updateInfo: info }),
  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
  setIsUpdateScreenOpen: (open) => set({ isUpdateScreenOpen: open }),

  checkForUpdatesAndDownload: () => {
    const currentStatus = get().status
    if (currentStatus === 'downloading' || currentStatus === 'ready' || currentStatus === 'installing') {
      return Promise.resolve()
    }
    if (checkInFlight) return checkInFlight

    const known = { status: currentStatus, error: get().error }
    set({ status: 'checking', error: null })

    checkInFlight = (async () => {
      try {
        const info = await UpdateService.checkForUpdates()
        if (!info || info.checkFailed) {
          set({
            status: known.status === 'checking' ? 'idle' : known.status,
            error: known.error,
            updateInfo: get().updateInfo ?? info,
            lastCheckAt: Date.now(),
            lastCheckFailed: true,
            consecutiveCheckFailures: get().consecutiveCheckFailures + 1,
          })
          return
        }

        set({ lastCheckAt: Date.now(), lastCheckFailed: false, consecutiveCheckFailures: 0 })
        if (!info.hasUpdate) {
          set({ status: 'idle', updateInfo: info })
          return
        }

        set({ updateInfo: info })

        if (isAndroid()) {
          set({ status: 'idle' })
          return
        }

        const alreadyDownloaded = await UpdateService.isUpdateDownloaded(info.latestVersion)
        if (alreadyDownloaded) {
          set({
            status: 'ready',
            progress: { percent: 100, downloaded: 1, total: 1 },
          })
          return
        }

        set({
          status: 'downloading',
          progress: { percent: 0, downloaded: 0, total: 0 },
        })

        if (unsubProgress) unsubProgress()
        unsubProgress = UpdateService.onProgress((p) => {
          set({ progress: p })
        })

        if (unsubDownloaded) unsubDownloaded()
        unsubDownloaded = UpdateService.onUpdateDownloaded(() => {
          if (get().status === 'installing') return
          set({
            status: 'ready',
            progress: { percent: 100, downloaded: 1, total: 1 },
          })
        })

        const success = await UpdateService.downloadUpdate(info.downloadUrl, info.latestVersion)
        if (success) {
          if (get().status === 'installing') return
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
      } finally {
        checkInFlight = null
      }
    })()
    return checkInFlight
  },

  checkIfDue: async (maxAgeMs = UPDATE_CHECK_INTERVAL_MS) => {
    if (checkInFlight) return checkInFlight
    const { lastCheckAt, lastCheckFailed, consecutiveCheckFailures } = get()
    if (lastCheckAt !== null) {
      const wait = lastCheckFailed
        ? UPDATE_RETRY_DELAYS_MS[consecutiveCheckFailures - 1] ?? UPDATE_CHECK_INTERVAL_MS
        : maxAgeMs
      if (Date.now() - lastCheckAt < wait) return
    }
    await get().checkForUpdatesAndDownload()
  },

  checkNow: async () => {
    if (get().manualCheck === 'checking') return
    if (manualFeedbackTimer) clearTimeout(manualFeedbackTimer)
    manualFeedbackTimer = null
    set({ manualCheck: 'checking' })

    await get().checkForUpdatesAndDownload()

    const { lastCheckFailed, updateInfo } = get()
    const outcome: ManualCheckState = lastCheckFailed
      ? 'failed'
      : updateInfo?.hasUpdate
        ? null
        : 'up-to-date'
    set({ manualCheck: outcome })
    if (outcome) {
      manualFeedbackTimer = setTimeout(() => {
        manualFeedbackTimer = null
        set({ manualCheck: null })
      }, MANUAL_CHECK_FEEDBACK_MS)
    }
  },

  applyUpdate: async () => {
    if (get().status === 'installing') {
      return false
    }

    const info = get().updateInfo
    const targetVer = info?.latestVersion

    if (isAndroid()) {
      if (!info?.downloadUrl) {
        if (info?.releaseUrl && typeof window !== 'undefined') {
          window.open(info.releaseUrl, '_blank')
        }
        return false
      }

      set({
        status: 'downloading',
        isUpdateScreenOpen: true,
        error: null,
        progress: { percent: 0, downloaded: 0, total: 0 },
      })

      if (unsubProgress) unsubProgress()
      unsubProgress = UpdateService.onProgress((p) => {
        set({ progress: p })
        if (p.percent >= 100) {
          set({ status: 'installing' })
        }
      })

      try {
        const success = await UpdateService.installUpdate(info.downloadUrl, info.releaseUrl, targetVer)
        if (success) {
          set({ status: 'ready' })
          return true
        } else {
          set({ status: 'error', error: 'Falha ao iniciar o instalador do APK.' })
          return false
        }
      } catch (err: any) {
        set({ status: 'error', error: err?.message || 'Erro ao processar atualização no Android.' })
        return false
      }
    }

    try {
      const isDownloaded = await UpdateService.isUpdateDownloaded(targetVer)
      if (!isDownloaded) {
        set({ status: 'downloading', isUpdateScreenOpen: true, error: null })
        const downloaded = await UpdateService.downloadUpdate(info?.downloadUrl || null, targetVer)
        if (!downloaded) {
          set({ status: 'error', error: 'Falha ao baixar o instalador da atualização.' })
          return false
        }
      }
    } catch (err: any) {
      set({ status: 'error', error: err?.message || 'Falha ao baixar o instalador da atualização.' })
      return false
    }

    set({ status: 'installing', isUpdateScreenOpen: true, error: null })
    try {
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
    const currentStatus = get().status

    if (currentStatus === 'installing') {
      return
    }

    if (isAndroid()) {
      set({ isUpdateScreenOpen: true, error: null })
      await get().applyUpdate()
      return
    }

    if (currentStatus === 'ready') {
      set({ isUpdateScreenOpen: true, error: null })
      await get().applyUpdate()
    } else {
      await get().checkForUpdatesAndDownload()
    }
  },

  openManualDownload: async () => {
    await UpdateService.openManualDownload(get().updateInfo)
  },
}))
