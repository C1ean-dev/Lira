import React, { useMemo } from 'react'
import { useCallTranscription } from '../../hooks/useCallTranscription'
import { useLocalPlayerDetails, useZonePeerDetails } from '../../hooks/usePlayerDetails'
import { SpaceTranscriptionContext } from '../../hooks/useSpaceTranscription'
import { selectTranscriptionSources } from '../../media/callTranscription'
import { useGameStore } from '../../store/useGameStore'
import { useMapStore } from '../../store/useMapStore'
import { useMediaStore } from '../../store/useMediaStore'

export const SpaceTranscriptionProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const roomId = useGameStore(state => state.roomId)
  const localPlayer = useLocalPlayerDetails()
  const peers = useZonePeerDetails()
  const localStream = useMediaStore(state => state.localStream)
  const peerStreams = useMediaStore(state => state.peerStreams)
  const voiceStreams = useMediaStore(state => state.peerVoiceStreams)
  const isMuted = useMediaStore(state => state.isMuted)
  const zoneId = localPlayer.currentZoneId
  const zoneName = useMapStore(state => state.mapData.zones.find(zone => zone.id === zoneId)?.name) || 'Reunião'
  const canStart = Boolean(roomId && zoneId)
  const sources = useMemo(() => !canStart ? [] : selectTranscriptionSources([
    { ...localPlayer, stream: localStream, isLocal: true, isMuted },
    ...peers.map(peer => ({ ...peer, stream: peerStreams[peer.id], isDjBot: Boolean(peer.isDjBot || peer.name.includes('DJ')) })),
  ], voiceStreams), [canStart, localPlayer, localStream, isMuted, peers, peerStreams, voiceStreams])
  const transcription = useCallTranscription(sources, zoneId)

  return <SpaceTranscriptionContext.Provider value={{ ...transcription, canStart, zoneName,
    start: () => { if (canStart) transcription.start() },
  }}>{children}</SpaceTranscriptionContext.Provider>
}
