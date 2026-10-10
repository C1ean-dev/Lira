let track: MediaStreamTrack | null = null
let context: AudioContext | null = null

export function silentAudioTrack(): MediaStreamTrack | null {
  if (track && track.readyState !== 'ended') return track
  try {
    const scope = typeof window !== 'undefined' && window ? (window as any) : null
    const AudioContextClass = scope?.AudioContext || scope?.webkitAudioContext
    if (!AudioContextClass) return null

    const audioContext: AudioContext = new AudioContextClass()
    const made = audioContext.createMediaStreamDestination().stream.getAudioTracks()[0]
    if (!made) {
      audioContext.close?.().catch(() => {})
      return null
    }
    if (audioContext.state === 'suspended') {
      audioContext.resume?.().catch(() => {})
    }
    context?.close?.().catch(() => {})
    context = audioContext
    track = made
    return made
  } catch {
    return null
  }
}

export function __resetSilentAudioForTests(): void {
  track = null
  context = null
}
