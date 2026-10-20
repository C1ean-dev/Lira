import '../helpers/mockAssetPersistence'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TopNavBar } from '../../components/TopNavBar'
import { LobbyModal } from '../../components/LobbyModal'
import { useUpdateStore } from '../../store/useUpdateStore'
import { UpdateService } from '../../services/updateService'

vi.mock('../../hooks/useRoomPublication', () => ({ useRoomPublication: () => [] }))
const initial = useUpdateStore.getState()
const info = { hasUpdate: true, currentVersion: '1.0.0', latestVersion: '1.1.0', releaseName: 'Nova versão', releaseNotes: '', downloadUrl: 'https://example.com/setup.exe', releaseUrl: 'https://example.com/release' }

beforeEach(() => {
  useUpdateStore.setState({ ...initial, status: 'idle', updateInfo: null, isUpdateScreenOpen: false })
  vi.spyOn(React, 'useSyncExternalStore').mockImplementation((_subscribe, getSnapshot) => getSnapshot())
})
afterEach(() => { vi.restoreAllMocks(); useUpdateStore.setState(initial) })

describe('install action after silent background download', () => {
  it.each(['lobby', 'space'] as const)('%s waits for the saved installer before offering installation', async surface => {
    vi.spyOn(UpdateService, 'checkForUpdates').mockResolvedValue(info)
    vi.spyOn(UpdateService, 'isUpdateDownloaded').mockResolvedValue(false)
    let progress!: (p: { percent: number; downloaded: number; total: number }) => void
    vi.spyOn(UpdateService, 'onProgress').mockImplementation(fn => { progress = fn; return () => {} })
    vi.spyOn(UpdateService, 'onUpdateDownloaded').mockReturnValue(() => {})
    let finish!: (success: boolean) => void
    const download = vi.spyOn(UpdateService, 'downloadUpdate').mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const install = vi.spyOn(UpdateService, 'applyUpdate').mockResolvedValue(true)
    const render = () => {
      const state = useUpdateStore.getState()
      const props = { hasUpdate: !!state.updateInfo?.hasUpdate, isUpdateReady: state.status === 'ready', onApplyUpdate: state.startInteractiveUpdate }
      return renderToStaticMarkup(surface === 'lobby'
        ? <LobbyModal {...props} onJoined={() => {}} onOpenAvatarCustomizer={() => {}} />
        : <TopNavBar {...props} onOpenAvatarModal={() => {}} />)
    }
    const checking = useUpdateStore.getState().checkForUpdatesAndDownload()
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce())
    expect(useUpdateStore.getState().status).toBe('downloading')
    expect(render()).not.toContain('aria-label="Instalar atualização"')
    progress({ percent: 100, downloaded: 100, total: 100 })
    expect(render()).not.toContain('aria-label="Instalar atualização"')
    expect(useUpdateStore.getState().isUpdateScreenOpen).toBe(false)
    expect(install).not.toHaveBeenCalled()
    finish(true)
    await checking
    expect(render()).toContain('aria-label="Instalar atualização"')
    expect(install).not.toHaveBeenCalled()
    vi.mocked(UpdateService.isUpdateDownloaded).mockResolvedValue(true)
    await useUpdateStore.getState().startInteractiveUpdate()
    expect(install).toHaveBeenCalledExactlyOnceWith(info.releaseUrl, info.latestVersion)
    expect(download).toHaveBeenCalledOnce()
  })
})
