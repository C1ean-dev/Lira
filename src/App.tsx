import React, { useState, useEffect } from 'react'
import { TopNavBar } from './components/TopNavBar'
import { MapViewport } from './components/MapViewport'
import { AssetPalette } from './editor/AssetPalette'
import { MiniCallOverlay } from './components/MiniCallOverlay'
import { FullScreenGrid } from './components/FullScreenGrid'
import { ChatDrawer } from './components/ChatDrawer'
import { AvatarCustomizerModal } from './components/AvatarCustomizerModal'
import { CustomElementModal } from './editor/CustomElementModal'
import { LobbyModal } from './components/LobbyModal'
import { AudioSettingsModal } from './components/AudioSettingsModal'
import { OnlineUsersMenu } from './components/OnlineUsersMenu'
import { ConfirmModal } from './components/ConfirmModal'
import { DoorKnockNotification } from './components/DoorKnockNotification'
import { DoorKnockPrompt } from './components/DoorKnockPrompt'
import { useGameStore } from './store/useGameStore'
import { useMediaStore } from './store/useMediaStore'
import { useChatStore } from './store/useChatStore'
import { useMapStore } from './store/useMapStore'
import { useUpdateStore } from './store/useUpdateStore'
import { idleManager } from './services/idleManager'
import { PeerManager } from './p2p/PeerManager'
import { MediaManager } from './media/MediaManager'

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
  const checkForUpdatesAndDownload = useUpdateStore((s) => s.checkForUpdatesAndDownload)
  const applyUpdate = useUpdateStore((s) => s.applyUpdate)

  // Check for updates on startup: downloads silently in background
  useEffect(() => {
    const timer = setTimeout(() => {
      checkForUpdatesAndDownload()
    }, 1500)

    return () => clearTimeout(timer)
  }, [checkForUpdatesAndDownload])

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

  const handleConfirmDisconnect = () => {
    setIsDisconnectModalOpen(false)
    PeerManager.getInstance().disconnect()
    MediaManager.getInstance().stopAllMedia()
    useMediaStore.getState().stopAllMedia()
    useGameStore.getState().setOnlineUsersOpen(false)
    useMapStore.getState().setEditorOpen(false)
    setInLobby(true)
  }

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0c0e14] text-slate-100 overflow-hidden font-sans select-none">
      {/* Top Bar */}
      <TopNavBar
        onOpenAvatarModal={() => setIsAvatarModalOpen(true)}
        onApplyUpdate={applyUpdate}
        hasUpdate={!!updateInfo?.hasUpdate}
        isUpdateReady={updateStatus === 'ready'}
        isUpdating={updateStatus === 'installing'}
        onDisconnect={() => setIsDisconnectModalOpen(true)}
      />

      {/* Main 2D Virtual Space */}
      <main className="relative flex-1 w-full overflow-hidden flex">
        <MapViewport />
        <AssetPalette />
        <ChatDrawer />
        <MiniCallOverlay />
      </main>

      {/* Full-Screen Conference Grid (Gather V2 Grid View) */}
      <FullScreenGrid />

      {/* Door Knock System */}
      <DoorKnockNotification />
      <DoorKnockPrompt />

      {/* Audio & Video Settings Modal */}
      <AudioSettingsModal />

      {/* Avatar Customizer Modal */}
      <AvatarCustomizerModal
        isOpen={isAvatarModalOpen}
        onClose={() => setIsAvatarModalOpen(false)}
      />

      {/* Custom Element Studio & Hand-Drawing Modal */}
      <CustomElementModal />

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

      {/* Online Users & Permissions Drawer */}
      <OnlineUsersMenu />

      {/* Start Lobby Screen */}
      {inLobby && (
        <LobbyModal
          onJoined={() => setInLobby(false)}
          onOpenAvatarCustomizer={() => setIsAvatarModalOpen(true)}
          onApplyUpdate={applyUpdate}
          isUpdateReady={updateStatus === 'ready'}
          isUpdating={updateStatus === 'installing'}
        />
      )}
    </div>
  )
}
export default App
