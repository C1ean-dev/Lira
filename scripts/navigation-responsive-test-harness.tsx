import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { TopNavBar } from '../src/components/TopNavBar'
import { OnlineUsersMenu } from '../src/components/OnlineUsersMenu'
import { ChatDrawer } from '../src/components/ChatDrawer'
import { SpotifyJamSideDisplay } from '../src/components/spotify/SpotifyJamSideDisplay'
import { useGameStore } from '../src/store/useGameStore'
import { useMapStore } from '../src/store/useMapStore'
import { useSpotifyJamStore } from '../src/store/useSpotifyJamStore'
import { useMediaStore } from '../src/store/useMediaStore'
import { useUpdateStore } from '../src/store/useUpdateStore'
import { useChatStore } from '../src/store/useChatStore'
import '../src/index.css'

const root = createRoot(document.getElementById('root')!)
const initialGame = useGameStore.getState()
const initialMap = useMapStore.getState().mapData
let generation = 0
const events = { avatar: 0, disconnect: 0, update: 0 }
const zoneName = 'Nova Sala Privada para conversas e apresentações com um nome bastante comprido'

function configure({ publicRoom = false, connectionStatus = 'connected', update = false } = {}) {
  useGameStore.setState({ roomId: '651CAA21-6733-4B2C-8208-3C2617900000', isHost: true, isRoomPublic: publicRoom, isOnlineUsersOpen: false,
    connectionStatus: connectionStatus as any, remotePlayers: {}, localPlayer: { ...initialGame.localPlayer,
      id: 'local', name: 'ParticipanteComUmNomeMuitoCompridoParaOHeader', statusText: 'Disponível para conversar na sala', currentZoneId: 'room' } })
  useMapStore.setState({ isEditorOpen: false, mapData: { ...initialMap, zones: [{ ...initialMap.zones[0], id: 'room', name: zoneName, color: '#3b82f6' } as any] } })
  useSpotifyJamStore.setState({ isDjModeActive: false, isSideDisplayMinimized: false, djStateByZone: {
    room: { zoneId: 'room', djPeerId: 'remote', djName: 'Aravon', startedAt: 123, isDjActive: true, requests: [], requestsRevision: 0 },
  } })
  useUpdateStore.setState({ status: update ? 'ready' : 'idle', manualCheck: 'idle', updateInfo: null })
  useMediaStore.setState({ isSettingsModalOpen: false })
  useChatStore.setState({ isChatOpen: false })
  flushSync(() => root.render(<React.Fragment key={++generation}>
    <TopNavBar onOpenAvatarModal={() => { events.avatar++ }} onDisconnect={() => { events.disconnect++ }}
      hasUpdate={update} isUpdateReady={update} onApplyUpdate={() => { events.update++ }} />
    <main className="flex-1" aria-label="Mapa de teste" style={{ background: 'repeating-conic-gradient(#dccbb4 0% 25%, #799eac 0% 50%) 0 / 40px 40px' }} />
    <SpotifyJamSideDisplay />
    <OnlineUsersMenu />
    <ChatDrawer />
  </React.Fragment>))
}

Object.assign(window, { navigationTesting: { configure, events, zoneName, settingsOpen: () => useMediaStore.getState().isSettingsModalOpen } })
configure()
