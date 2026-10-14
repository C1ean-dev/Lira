import React from 'react'
import { useMediaStore } from '../../store/useMediaStore'
import { RemoteAudio } from './RemoteAudio'

export const LiveListeningAudio: React.FC<{ stream: MediaStream; peer: string; name?: string; muted?: boolean }> = ({ stream, peer, name, muted = false }) => {
  const volume = useMediaStore(s => s.liveStreamVolume)
  const output = useMediaStore(s => s.outputVolume)
  const sinkId = useMediaStore(s => s.selectedAudioOutput)
  const deafened = useMediaStore(s => s.isDeafened)
  const silenced = useMediaStore(s => s.isUserSilenced(peer, name))
  return <RemoteAudio stream={stream} peer={peer} tile="live-audio" sinkId={sinkId}
    muted={muted || deafened || silenced || volume === 0} volume={(output / 100) * (volume / 100)} />
}
