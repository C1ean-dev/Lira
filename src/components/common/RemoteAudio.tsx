import React, { useEffect, useRef } from 'react'
import { applyAudioOutput, attachRemoteAudio } from '../../media/remoteAudio'

interface RemoteAudioProps {
  stream: MediaStream | null | undefined
  tile: string
  peer: string
  muted: boolean
  volume: number
  sinkId?: string
}

export const RemoteAudio: React.FC<RemoteAudioProps> = ({ stream, tile, peer, muted, volume, sinkId }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !stream) return
    return attachRemoteAudio(audio, stream, { tile, peer, muted })
  }, [stream, tile, peer, muted])

  useEffect(() => {
    if (audioRef.current) applyAudioOutput(audioRef.current, { muted, volume, sinkId })
  }, [muted, volume, sinkId])

  return <audio ref={audioRef} autoPlay muted={muted} className="hidden" />
}
