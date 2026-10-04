import React from 'react'
import { TopNavBar } from './TopNavBar'
import { MapViewport } from './MapViewport'
import { AssetPalette } from '../editor/AssetPalette'
import { MiniCallOverlay } from './MiniCallOverlay'
import { FullScreenGrid } from './FullScreenGrid'
import { ChatDrawer } from './ChatDrawer'
import { CustomElementModal } from '../editor/CustomElementModal'
import { OnlineUsersMenu } from './OnlineUsersMenu'
import { DoorKnockNotification } from './DoorKnockNotification'
import { DoorKnockPrompt } from './DoorKnockPrompt'

interface Props {
  onOpenAvatarModal: () => void
  onApplyUpdate: () => void
  hasUpdate: boolean
  isUpdateReady: boolean
  isUpdating: boolean
  onDisconnect: () => void
}

// Everything that belongs to being inside a space. App loads it (React.lazy) when the user
// enters one, so the menu does not pay for the world canvas and its render loop, the editor,
// the chat and the calls.
export const SpaceShell: React.FC<Props> = ({
  onOpenAvatarModal,
  onApplyUpdate,
  hasUpdate,
  isUpdateReady,
  isUpdating,
  onDisconnect,
}) => (
  <>
    {/* Top Bar */}
    <TopNavBar
      onOpenAvatarModal={onOpenAvatarModal}
      onApplyUpdate={onApplyUpdate}
      hasUpdate={hasUpdate}
      isUpdateReady={isUpdateReady}
      isUpdating={isUpdating}
      onDisconnect={onDisconnect}
    />

    {/* Main 2D Virtual Space */}
    <main className="relative flex-1 w-full overflow-hidden flex">
      <MapViewport />
      <AssetPalette />
      <ChatDrawer />
      <MiniCallOverlay />
    </main>

    {/* Full-Screen Conference Grid (Lira Grid View) */}
    <FullScreenGrid />

    {/* Door Knock System */}
    <DoorKnockNotification />
    <DoorKnockPrompt />

    {/* Custom Element Studio & Hand-Drawing Modal */}
    <CustomElementModal />

    {/* Online Users & Permissions Drawer */}
    <OnlineUsersMenu />
  </>
)
