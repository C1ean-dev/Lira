import React, { Suspense, lazy, useState, useEffect, useLayoutEffect } from 'react'
import { LobbyModal } from './components/LobbyModal'
import { ConfirmModal } from './components/ConfirmModal'
import { useGameStore } from './store/useGameStore'
import { useMediaStore } from './store/useMediaStore'
import { useChatStore } from './store/useChatStore'
import { useMapStore } from './store/useMapStore'
import { useUpdateStore, UPDATE_STALE_AFTER_MS } from './store/useUpdateStore'
import { useRoomJoinStore } from './store/useRoomJoinStore'
import { useSpotifyJamStore } from './store/useSpotifyJamStore'
import { startAutoUpdateChecks } from './services/updateScheduler'
import { AppUpdateScreen } from './components/AppUpdateScreen'
import { idleManager } from './services/idleManager'
import { FriendsPresenceService } from './services/friendsPresenceService'
import { PeerManager } from './p2p/PeerManager'
import { MediaManager } from './media/MediaManager'
import { useMountOnFirstOpen } from './hooks/useMountOnFirstOpen'
import { markStartup, reportStartupAfterPaint } from './utils/startupTrace'
import { callNotificationService } from './services/callNotificationService'

const loadSpaceShell = () => import('./components/SpaceShell').then((m) => ({ default: m.SpaceShell }))
const loadAvatarCustomizerModal = () =>
  import('./components/AvatarCustomizerModal').then((m) => ({ default: m.AvatarCustomizerModal }))
const loadAudioSettingsModal = () =>
  import('./components/AudioSettingsModal').then((m) => ({ default: m.AudioSettingsModal }))
const SpaceShell = lazy(loadSpaceShell)
const AvatarCustomizerModal = lazy(loadAvatarCustomizerModal)
const AudioSettingsModal = lazy(loadAudioSettingsModal)

export const App: React.FC = () => {
  const [inLobby, setInLobby] = useState(true)
  const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false)
  const [isDisconnectModalOpen, setIsDisconnectModalOpen] = useState(false)

  const isConnected = useGameStore((s) => s.isConnected)
  const roomEntryError = useGameStore((s) => s.roomEntryError)
  const toggleMute = useMediaStore((s) => s.toggleMute)
  const toggleCamera = useMediaStore((s) => s.toggleCamera)
  const { toggleChat } = useChatStore()
  const toggleEditor = useMapStore((s) => s.toggleEditor)

  useEffect(() => {
    if (roomEntryError && !inLobby) {
      callNotificationService.clearNotification()
      MediaManager.getInstance().stopAllMedia()
      useMediaStore.getState().stopAllMedia()
      setInLobby(true)
    }
  }, [roomEntryError, inLobby])

  const updateInfo = useUpdateStore((s) => s.updateInfo)
  const updateStatus = useUpdateStore((s) => s.status)
  const isUpdateScreenOpen = useUpdateStore((s) => s.isUpdateScreenOpen)
  const startInteractiveUpdate = useUpdateStore((s) => s.startInteractiveUpdate)

  useLayoutEffect(() => {
    markStartup('commit')
    reportStartupAfterPaint()
  }, [])

  const isSettingsModalOpen = useMediaStore((s) => s.isSettingsModalOpen)
  const mountAudioSettings = useMountOnFirstOpen(isSettingsModalOpen)
  const mountAvatarModal = useMountOnFirstOpen(isAvatarModalOpen)

  useEffect(() => {
    const preload = () => {
      for (const load of [loadSpaceShell, loadAvatarCustomizerModal, loadAudioSettingsModal]) {
        load().catch(() => {})
      }
    }
    const win = window as any
    if (typeof win.requestIdleCallback === 'function') {
      const id = win.requestIdleCallback(preload, { timeout: 4000 })
      return () => win.cancelIdleCallback?.(id)
    }
    const timer = setTimeout(preload, 1500)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => startAutoUpdateChecks(), [])

  useEffect(() => {
    const updates = useUpdateStore.getState()
    if (inLobby && updates.lastCheckAt !== null) updates.checkIfDue(UPDATE_STALE_AFTER_MS)
  }, [inLobby])

  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return
      }

      if (e.key.toLowerCase() === 'm') {
        toggleMute()
      } else if (e.key.toLowerCase() === 'v') {
        toggleCamera()
      } else if (e.key.toLowerCase() === 'c') {
        toggleChat()
      } else if (e.key.toLowerCase() === 'e') {
        toggleEditor()
      }
    }

    window.addEventListener('keydown', handleGlobalShortcuts)
    return () => window.removeEventListener('keydown', handleGlobalShortcuts)
  }, [toggleMute, toggleCamera, toggleChat, toggleEditor])

  useEffect(() => {
    const handleUnload = () => {
      PeerManager.getInstance().disconnect()
    }

    window.addEventListener('beforeunload', handleUnload)
    window.addEventListener('pagehide', handleUnload)

    return () => {
      window.removeEventListener('beforeunload', handleUnload)
      window.removeEventListener('pagehide', handleUnload)
    }
  }, [])

  useEffect(() => {
    idleManager.start()
    return () => idleManager.stop()
  }, [])

  useEffect(() => {
    FriendsPresenceService.getInstance().connectFriendsNetwork()
  }, [])

  useEffect(() => {
    callNotificationService.init()
  }, [])

  const leaveSpace = () => {
    callNotificationService.clearNotification()
    PeerManager.getInstance().disconnect()
    MediaManager.getInstance().stopAllMedia()
    useMediaStore.getState().stopAllMedia()
    useGameStore.getState().setOnlineUsersOpen(false)
    useMapStore.getState().setEditorOpen(false)
    useSpotifyJamStore.getState().clearAllJams()
    setInLobby(true)
  }

  const handleConfirmDisconnect = () => {
    setIsDisconnectModalOpen(false)
    leaveSpace()
  }

  const pendingRoomCode = useRoomJoinStore((s) => s.pendingRoomCode)
  useEffect(() => {
    if (pendingRoomCode && !inLobby) leaveSpace()
  }, [pendingRoomCode, inLobby])

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0c0e14] text-slate-100 overflow-hidden font-sans select-none">
      {!inLobby && (
        <Suspense fallback={null}>
          <SpaceShell
            onOpenAvatarModal={() => setIsAvatarModalOpen(true)}
            onApplyUpdate={startInteractiveUpdate}
            hasUpdate={!!updateInfo?.hasUpdate}
            isUpdateReady={updateStatus === 'ready'}
            isUpdating={updateStatus === 'installing'}
            onDisconnect={() => setIsDisconnectModalOpen(true)}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>{mountAudioSettings && <AudioSettingsModal />}</Suspense>

      <Suspense fallback={null}>
        {mountAvatarModal && (
          <AvatarCustomizerModal
            isOpen={isAvatarModalOpen}
            onClose={() => setIsAvatarModalOpen(false)}
          />
        )}
      </Suspense>

      <ConfirmModal
        isOpen={isDisconnectModalOpen}
        title="Sair do Espaço?"
        message="Você será desconectado da sessão atual, suas transmissões de áudio e vídeo serão encerradas e você retornará ao menu inicial."
        confirmText="Sim, Desconectar"
        cancelText="Permanecer no Espaço"
        variant="danger"
        icon="logout"
        onConfirm={handleConfirmDisconnect}
        onCancel={() => setIsDisconnectModalOpen(false)}
      />

      {inLobby && (
        <LobbyModal
          onJoined={() => setInLobby(false)}
          onOpenAvatarCustomizer={() => setIsAvatarModalOpen(true)}
          onApplyUpdate={startInteractiveUpdate}
          hasUpdate={!!updateInfo?.hasUpdate}
          isUpdateReady={updateStatus === 'ready'}
          isUpdating={updateStatus === 'installing'}
        />
      )}

      {(isUpdateScreenOpen || updateStatus === 'installing') && (
        <AppUpdateScreen />
      )}
    </div>
  )
}
export default App
