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
import { SpotifyJamSideDisplay } from './spotify/SpotifyJamSideDisplay'
import { SpotifyJamModal } from './spotify/SpotifyJamModal'
import { useSpotifyPresence } from '../hooks/useSpotifyPresence'
import { useAvatarInactivity } from '../hooks/useAvatarInactivity'

interface Props {
  onOpenAvatarModal: () => void
  onApplyUpdate: () => void
  hasUpdate: boolean
  isUpdateReady: boolean
  isUpdating: boolean
  onDisconnect: () => void
}

export const SpaceShell: React.FC<Props> = ({
  onOpenAvatarModal,
  onApplyUpdate,
  hasUpdate,
  isUpdateReady,
  isUpdating,
  onDisconnect,
}) => {
  useSpotifyPresence()
  useAvatarInactivity()

  return (
  <>
    <TopNavBar
      onOpenAvatarModal={onOpenAvatarModal}
      onApplyUpdate={onApplyUpdate}
      hasUpdate={hasUpdate}
      isUpdateReady={isUpdateReady}
      isUpdating={isUpdating}
      onDisconnect={onDisconnect}
    />

    <main className="relative flex-1 w-full overflow-hidden flex">
      <MapViewport />
      <AssetPalette />
      <ChatDrawer />
      <MiniCallOverlay />
    </main>

    <FullScreenGrid />

    <DoorKnockNotification />
    <DoorKnockPrompt />

    <CustomElementModal />

    <OnlineUsersMenu />

    <SpotifyJamSideDisplay />
    <SpotifyJamModal />
  </>
  )
}
