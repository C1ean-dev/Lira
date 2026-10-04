import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  useUpdateStore,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_STALE_AFTER_MS,
  UPDATE_RETRY_DELAYS_MS,
  MANUAL_CHECK_FEEDBACK_MS,
  versionBadgeLabel,
} from '../store/useUpdateStore'
import { UpdateService, UpdateInfo } from '../services/updateService'
import { startAutoUpdateChecks, UPDATE_FIRST_CHECK_DELAY_MS } from '../services/updateScheduler'

const MINUTE = 60_000

const upToDate: UpdateInfo = {
  hasUpdate: false,
  currentVersion: '1.0.0',
  latestVersion: 'v1.0.0',
  releaseName: 'v1.0.0',
  releaseNotes: '',
  downloadUrl: null,
  releaseUrl: 'https://github.com/example/releases',
}

const newVersion: UpdateInfo = {
  hasUpdate: true,
  currentVersion: '1.0.0',
  latestVersion: 'v1.0.5',
  releaseName: 'v1.0.5',
  releaseNotes: '',
  downloadUrl: 'https://example.com/setup.exe',
  releaseUrl: 'https://github.com/example/releases',
}

/** What the service answers when GitHub could not be reached. */
const failedCheck: UpdateInfo = { ...upToDate, latestVersion: '1.0.0', checkFailed: true }

function resetStore() {
  useUpdateStore.setState({
    updateInfo: null,
    status: 'idle',
    progress: { percent: 0, downloaded: 0, total: 0 },
    error: null,
    isUpdateScreenOpen: false,
    lastCheckAt: null,
    lastCheckFailed: false,
    consecutiveCheckFailures: 0,
    manualCheck: null,
  })
}

describe('update checks while the app stays open', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
    vi.restoreAllMocks()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('a check that could not reach GitHub', () => {
    it('is reported as failed by the web fallback, not as "no update"', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({ ok: false, status: 403 } as any)
      expect((await UpdateService.checkForUpdates()).checkFailed).toBe(true)

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'))
      expect((await UpdateService.checkForUpdates()).checkFailed).toBe(true)

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ tag_name: 'v0.0.1', assets: [] }),
      } as any)
      expect((await UpdateService.checkForUpdates()).checkFailed).toBeFalsy()
    })

    it('keeps the update that was already known (the button must not vanish)', async () => {
      useUpdateStore.setState({
        updateInfo: newVersion,
        status: 'error',
        error: 'Não foi possível baixar a atualização automaticamente.',
      })
      vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(failedCheck)

      await useUpdateStore.getState().checkForUpdatesAndDownload()

      const state = useUpdateStore.getState()
      expect(state.updateInfo).toEqual(newVersion)
      expect(state.status).toBe('error')
      expect(state.error).toBe('Não foi possível baixar a atualização automaticamente.')
      expect(state.lastCheckFailed).toBe(true)
      expect(state.consecutiveCheckFailures).toBe(1)
    })

    it('goes back to idle when nothing was known yet', async () => {
      vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(failedCheck)

      await useUpdateStore.getState().checkForUpdatesAndDownload()

      const state = useUpdateStore.getState()
      expect(state.status).toBe('idle')
      expect(state.updateInfo?.hasUpdate).toBeFalsy()
      expect(state.lastCheckFailed).toBe(true)
    })

    it('is retried after 1, 2 and 5 minutes, then at the normal pace', async () => {
      const check = vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(failedCheck)
      const store = () => useUpdateStore.getState()

      await store().checkIfDue()
      expect(check).toHaveBeenCalledTimes(1)

      for (const [attempt, delay] of UPDATE_RETRY_DELAYS_MS.entries()) {
        vi.advanceTimersByTime(delay - 1000)
        await store().checkIfDue()
        expect(check).toHaveBeenCalledTimes(attempt + 1)

        vi.advanceTimersByTime(1000)
        await store().checkIfDue()
        expect(check).toHaveBeenCalledTimes(attempt + 2)
      }

      // Retries used up: no more quick attempts, even when the window is focused.
      vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS - 1000)
      await store().checkIfDue(UPDATE_STALE_AFTER_MS)
      expect(check).toHaveBeenCalledTimes(4)

      vi.advanceTimersByTime(1000)
      await store().checkIfDue()
      expect(check).toHaveBeenCalledTimes(5)
    })

    it('stops counting as failed once a check gets through', async () => {
      const check = vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValueOnce(failedCheck)
      await useUpdateStore.getState().checkIfDue()

      check.mockResolvedValueOnce(upToDate)
      vi.advanceTimersByTime(UPDATE_RETRY_DELAYS_MS[0])
      await useUpdateStore.getState().checkIfDue()

      const state = useUpdateStore.getState()
      expect(state.lastCheckFailed).toBe(false)
      expect(state.consecutiveCheckFailures).toBe(0)
      expect(state.updateInfo).toEqual(upToDate)
    })
  })

  describe('checkIfDue', () => {
    it('checks right away the first time, then only after the interval', async () => {
      const check = vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(upToDate)
      const store = () => useUpdateStore.getState()

      await store().checkIfDue()
      expect(check).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS - 1000)
      await store().checkIfDue()
      expect(check).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1000)
      await store().checkIfDue()
      expect(check).toHaveBeenCalledTimes(2)
    })

    it('accepts a shorter age for moments the user is looking (focus, back to the lobby)', async () => {
      const check = vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(upToDate)
      const store = () => useUpdateStore.getState()
      await store().checkIfDue()

      vi.advanceTimersByTime(UPDATE_STALE_AFTER_MS - 1000)
      await store().checkIfDue(UPDATE_STALE_AFTER_MS)
      expect(check).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1000)
      await store().checkIfDue(UPDATE_STALE_AFTER_MS)
      expect(check).toHaveBeenCalledTimes(2)
    })

    it('finds a version released while the app was open and downloads it', async () => {
      const check = vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValueOnce(upToDate)
      vi.spyOn(UpdateService, 'isUpdateDownloaded').mockResolvedValue(false)
      const download = vi.spyOn(UpdateService, 'downloadUpdate').mockResolvedValue(true)

      await useUpdateStore.getState().checkIfDue()
      expect(useUpdateStore.getState().updateInfo?.hasUpdate).toBe(false)

      check.mockResolvedValueOnce(newVersion)
      vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS)
      await useUpdateStore.getState().checkIfDue()

      expect(download).toHaveBeenCalledWith('https://example.com/setup.exe', 'v1.0.5')
      expect(useUpdateStore.getState().updateInfo).toEqual(newVersion)
      expect(useUpdateStore.getState().status).toBe('ready')
    })

    it('does not ask GitHub again while an update is downloading or ready', async () => {
      const check = vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(newVersion)

      useUpdateStore.setState({ status: 'ready', updateInfo: newVersion })
      await useUpdateStore.getState().checkIfDue()
      useUpdateStore.setState({ status: 'downloading' })
      await useUpdateStore.getState().checkIfDue()

      expect(check).not.toHaveBeenCalled()
    })

    it('runs one check at a time', async () => {
      let answer: (info: UpdateInfo) => void = () => {}
      const check = vi
        .spyOn(UpdateService, 'checkForUpdates')
        .mockReturnValue(new Promise<UpdateInfo>((resolve) => (answer = resolve)))

      const first = useUpdateStore.getState().checkForUpdatesAndDownload()
      const second = useUpdateStore.getState().checkForUpdatesAndDownload()
      const third = useUpdateStore.getState().checkIfDue()
      answer(upToDate)
      await Promise.all([first, second, third])

      expect(check).toHaveBeenCalledTimes(1)
    })
  })

  describe('checking by hand (clicking the version badge)', () => {
    it('says it is checking, then that the app is up to date, then clears the message', async () => {
      let answer: (info: UpdateInfo) => void = () => {}
      vi.spyOn(UpdateService, 'checkForUpdates').mockReturnValue(
        new Promise<UpdateInfo>((resolve) => (answer = resolve))
      )

      const done = useUpdateStore.getState().checkNow()
      expect(useUpdateStore.getState().manualCheck).toBe('checking')

      answer(upToDate)
      await done
      expect(useUpdateStore.getState().manualCheck).toBe('up-to-date')

      vi.advanceTimersByTime(MANUAL_CHECK_FEEDBACK_MS)
      expect(useUpdateStore.getState().manualCheck).toBeNull()
    })

    it('shows the outcome on the badge in place of the version', () => {
      expect(versionBadgeLabel(null, 'v1.2.3')).toBe('v1.2.3')
      expect(versionBadgeLabel('checking', 'v1.2.3')).toBe('Verificando...')
      expect(versionBadgeLabel('up-to-date', 'v1.2.3')).toBe('Atualizado')
      expect(versionBadgeLabel('failed', 'v1.2.3')).toBe('Falha ao verificar')
    })

    it('says so when GitHub could not be reached', async () => {
      vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(failedCheck)

      await useUpdateStore.getState().checkNow()

      expect(useUpdateStore.getState().manualCheck).toBe('failed')
    })

    it('ignores how recent the last check was', async () => {
      const check = vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(upToDate)
      await useUpdateStore.getState().checkIfDue()

      await useUpdateStore.getState().checkNow()

      expect(check).toHaveBeenCalledTimes(2)
    })

    it('leaves no message when it finds an update: the update button takes over', async () => {
      vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(newVersion)
      vi.spyOn(UpdateService, 'isUpdateDownloaded').mockResolvedValue(true)

      await useUpdateStore.getState().checkNow()

      expect(useUpdateStore.getState().manualCheck).toBeNull()
      expect(useUpdateStore.getState().status).toBe('ready')
    })
  })

  describe('the scheduler', () => {
    type Listener = () => void
    let windowListeners: Record<string, Listener[]>
    let documentListeners: Record<string, Listener[]>

    const fire = (listeners: Record<string, Listener[]>, type: string) =>
      (listeners[type] || []).forEach((listener) => listener())

    const fakeTarget = (listeners: Record<string, Listener[]>) => ({
      addEventListener: (type: string, listener: Listener) => {
        ;(listeners[type] = listeners[type] || []).push(listener)
      },
      removeEventListener: (type: string, listener: Listener) => {
        listeners[type] = (listeners[type] || []).filter((entry) => entry !== listener)
      },
    })

    /** Let the async check triggered by a timer or an event finish. */
    const settle = async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve()
    }

    beforeEach(() => {
      windowListeners = {}
      documentListeners = {}
      ;(globalThis as any).window = fakeTarget(windowListeners)
      ;(globalThis as any).document = { ...fakeTarget(documentListeners), visibilityState: 'visible' }
    })

    afterEach(() => {
      delete (globalThis as any).window
      delete (globalThis as any).document
    })

    it('checks shortly after the app opens and again every interval, without a restart', async () => {
      const check = vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(upToDate)
      const stop = startAutoUpdateChecks()

      expect(check).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS)
      expect(check).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS - 2 * MINUTE)
      expect(check).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(3 * MINUTE)
      expect(check).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS + MINUTE)
      expect(check).toHaveBeenCalledTimes(3)

      stop()
    })

    it('retries soon when the check at startup fails (network not up yet)', async () => {
      const check = vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValueOnce(failedCheck)
      check.mockResolvedValue(newVersion)
      vi.spyOn(UpdateService, 'isUpdateDownloaded').mockResolvedValue(true)
      const stop = startAutoUpdateChecks()

      await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS)
      expect(useUpdateStore.getState().lastCheckFailed).toBe(true)

      await vi.advanceTimersByTimeAsync(UPDATE_RETRY_DELAYS_MS[0] + MINUTE)

      expect(check).toHaveBeenCalledTimes(2)
      expect(useUpdateStore.getState().status).toBe('ready')
      stop()
    })

    it('checks when the window gets focus, if the last check is old enough', async () => {
      const check = vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(upToDate)
      const stop = startAutoUpdateChecks()
      await vi.advanceTimersByTimeAsync(UPDATE_FIRST_CHECK_DELAY_MS)
      expect(check).toHaveBeenCalledTimes(1)

      fire(windowListeners, 'focus')
      await settle()
      expect(check).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(UPDATE_STALE_AFTER_MS)
      fire(windowListeners, 'focus')
      await settle()
      expect(check).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(UPDATE_STALE_AFTER_MS)
      fire(documentListeners, 'visibilitychange')
      await settle()
      expect(check).toHaveBeenCalledTimes(3)

      stop()
    })

    it('does nothing more once stopped', async () => {
      const check = vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(upToDate)
      const stop = startAutoUpdateChecks()
      stop()

      await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 3)
      fire(windowListeners, 'focus')
      await settle()

      expect(check).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
      expect(windowListeners.focus || []).toHaveLength(0)
    })
  })
})
