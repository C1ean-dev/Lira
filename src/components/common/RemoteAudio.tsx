import React, { useEffect, useRef } from 'react'
import { applyAudioOutput, attachRemoteAudio } from '../../media/remoteAudio'

interface RemoteAudioProps {
  stream: MediaStream | null | undefined
  /** Tile and peer names for the diagnostic log. */
  tile: string
  peer: string
  muted: boolean
  /** 0..1 */
  volume: number
  /** Output device id, or 'default'. */
  sinkId?: string
}

/**
 * Plays a remote peer's audio. It is separate from the tile's <video> on
 * purpose: a <video> stays silent until its video track delivers a frame
 * (see media/remoteAudio.ts).
 */
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
