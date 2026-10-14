// Calls reserve two audio m-lines from their first offer: microphone, then live.
// This lets a live start/stop without replacing voice or renegotiating the call.
export const CALL_AUDIO_CHANNELS = 2

export function reserveLiveAudio(silence: MediaStreamTrack | null): MediaStreamTrack | null {
  if (!silence) return null
  const track = typeof silence.clone === 'function' ? silence.clone() : silence
  ;(track as any).__screenShareLiveAudio = true
  track.enabled = true
  return track
}

export function findLiveAudioSender(pc: RTCPeerConnection): RTCRtpSender | undefined {
  const transceivers = pc.getTransceivers?.().filter(t => t.receiver?.track?.kind === 'audio' || t.sender?.track?.kind === 'audio')
  return transceivers?.[1]?.sender || pc.getSenders().filter(s => s.track?.kind === 'audio')[1]
}

export async function replaceLiveAudio(pc: RTCPeerConnection, track: MediaStreamTrack | null): Promise<boolean> {
  const sender = findLiveAudioSender(pc)
  if (!sender) return false
  if (sender.track !== track) await sender.replaceTrack(track)
  return true
}

export function splitCallAudio(stream: MediaStream, pc: RTCPeerConnection | undefined, separated: boolean) {
  if (!separated) return { voice: stream, live: null }
  const audio = stream.getAudioTracks()
  const receivers = pc?.getTransceivers?.().filter(t => t.receiver?.track?.kind === 'audio').map(t => t.receiver.track)
  const ordered = receivers?.length ? receivers : audio
  const present = (track: MediaStreamTrack | undefined) => track && audio.some(t => t.id === track.id) ? [track] : []
  const video = stream.getVideoTracks()
  return {
    voice: new MediaStream([...present(ordered[0]), ...video]),
    live: new MediaStream([...present(ordered[1]), ...video]),
  }
}
