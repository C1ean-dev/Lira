import React, { Suspense, lazy, useState, useEffect } from 'react'
import { LobbyModal } from './components/LobbyModal'
import { ConfirmModal } from './components/ConfirmModal'
import { useGameStore } from './store/useGameStore'
import { useMediaStore } from './store/useMediaStore'
import { useChatStore } from './store/useChatStore'
import { useMapStore } from './store/useMapStore'
import { useUpdateStore, UPDATE_STALE_AFTER_MS } from './store/useUpdateStore'
import { useRoomJoinStore } from './store/useRoomJoinStore'
import { startAutoUpdateChecks } from './services/updateScheduler'
import { AppUpdateScreen } from './components/AppUpdateScreen'
import { idleManager } from './services/idleManager'
import { FriendsPresenceService } from './services/friendsPresenceService'
import { PeerManager } from './p2p/PeerManager'
import { MediaManager } from './media/MediaManager'
import { useMountOnFirstOpen } from './hooks/useMountOnFirstOpen'

// The menu is the first screen. Being inside a space (world, editor, chat, calls) and the heavy
// modals load on demand, and are fetched in idle time once the menu is up, so entering a space or
// opening a modal does not wait for them.
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

  // Selectors (not whole-store) so 60Hz position updates don't re-render App.
  const isConnected = useGameStore((s) => s.isConnected)
  // Stable action refs only — whole-store here would re-render the entire
  // tree on every VU-meter tick (~10Hz) during calls.
  const toggleMute = useMediaStore((s) => s.toggleMute)
  const toggleCamera = useMediaStore((s) => s.toggleCamera)
  const { toggleChat } = useChatStore()
  const toggleEditor = useMapStore((s) => s.toggleEditor)

  const updateInfo = useUpdateStore((s) => s.updateInfo)
  const updateStatus = useUpdateStore((s) => s.status)
  const isUpdateScreenOpen = useUpdateStore((s) => s.isUpdateScreenOpen)
  const startInteractiveUpdate = useUpdateStore((s) => s.startInteractiveUpdate)

  // Both modals open from the menu as well as from inside a space; each one is loaded the first
  // time it opens and stays mounted after that.
  const isSettingsModalOpen = useMediaStore((s) => s.isSettingsModalOpen)
  const mountAudioSettings = useMountOnFirstOpen(isSettingsModalOpen)
  const mountAvatarModal = useMountOnFirstOpen(isAvatarModalOpen)

  // Once the menu is on screen, fetch the rest in idle time.
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

  // Check for updates on startup and keep checking while the app is open
  // (periodically and when the window gets focus): downloads silently in
  // the background.
  useEffect(() => startAutoUpdateChecks(), [])

  // Coming back to the lobby is a good moment to notice a new version.
  useEffect(() => {
    // (The very first check belongs to the scheduler above.)
    const updates = useUpdateStore.getState()
    if (inLobby && updates.lastCheckAt !== null) updates.checkIfDue(UPDATE_STALE_AFTER_MS)
  }, [inLobby])

  // 2. Global Keyboard Shortcuts (M for Mic, V for Video, C for Chat)
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

  // 3. Graceful disconnect on window close / page unload
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

  // 4. Inactivity & AFK detection (5 min idle)
  useEffect(() => {
    idleManager.start()
    return () => idleManager.stop()
  }, [])

  // 5. Friends presence & direct messages outside rooms (home screen, other spaces)
  useEffect(() => {
    FriendsPresenceService.getInstance().connectFriendsNetwork()
  }, [])

  const leaveSpace = () => {
    PeerManager.getInstance().disconnect()
    MediaManager.getInstance().stopAllMedia()
    useMediaStore.getState().stopAllMedia()
    useGameStore.getState().setOnlineUsersOpen(false)
    useMapStore.getState().setEditorOpen(false)
    setInLobby(true)
  }

  const handleConfirmDisconnect = () => {
    setIsDisconnectModalOpen(false)
    leaveSpace()
  }

  // 6. Entering another space from inside one (an invite, a friend's space):
  // leave this one; the home screen picks the pending code up and joins.
  const pendingRoomCode = useRoomJoinStore((s) => s.pendingRoomCode)
  useEffect(() => {
    if (pendingRoomCode && !inLobby) leaveSpace()
  }, [pendingRoomCode, inLobby])

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0c0e14] text-slate-100 overflow-hidden font-sans select-none">
      {/* The space (world, editor, chat, calls): only once inside one */}
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

      {/* Audio & Video Settings Modal */}
      <Suspense fallback={null}>{mountAudioSettings && <AudioSettingsModal />}</Suspense>

      {/* Avatar Customizer Modal */}
      <Suspense fallback={null}>
        {mountAvatarModal && (
          <AvatarCustomizerModal
            isOpen={isAvatarModalOpen}
            onClose={() => setIsAvatarModalOpen(false)}
          />
        )}
      </Suspense>

      {/* Disconnect Confirmation Modal */}
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

      {/* Start Lobby Screen */}
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

      {/* Fullscreen Dedicated App Update Screen with centered icon and progress bar */}
      {(isUpdateScreenOpen || updateStatus === 'installing') && (
        <AppUpdateScreen />
      )}
    </div>
  )
}
export default App
