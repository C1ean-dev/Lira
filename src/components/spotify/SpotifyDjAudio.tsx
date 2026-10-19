import React from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'
import { useSpotifyJamStore } from '../../store/useSpotifyJamStore'
import { RemoteAudio } from '../common/RemoteAudio'

// Music survives changes between call layouts and the minimized DJ panel.
export const SpotifyDjAudio: React.FC = () => {
  const ids = useGameStore(useShallow(s => Object.values(s.remotePlayers).filter(p =>
    (p.isDjBot || p.id.startsWith('dj-')) && !!s.localPlayer.currentZoneId && p.currentZoneId === s.localPlayer.currentZoneId
  ).map(p => p.id)))
  const streams = useMediaStore(s => s.peerStreams)
  const deafened = useMediaStore(s => s.isDeafened)
  const output = useMediaStore(s => s.outputVolume)
  const sinkId = useMediaStore(s => s.selectedAudioOutput)
  const volume = useSpotifyJamStore(s => s.volume)
  const muted = useSpotifyJamStore(s => s.isMuted)
  return <>{ids.filter(id => streams[id]).map(id => <RemoteAudio key={id} stream={streams[id]} tile="dj-audio" peer={id}
    muted={muted || deafened} volume={(output / 100) * (volume / 100)} sinkId={sinkId} />)}</>
}
