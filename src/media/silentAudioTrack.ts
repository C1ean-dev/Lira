/**
 * An audio track that carries silence.
 *
 * Somebody without a microphone can only be in a call while live: the sound of
 * the live is the only audio that call has. A viewer that has not asked to
 * watch must not get that sound, and a call with no audio at all never
 * connects, so that viewer gets this track instead.
 */

let track: MediaStreamTrack | null = null
let context: AudioContext | null = null

/** The one silent track of the app, made on first use. Null where it cannot be made. */
export function silentAudioTrack(): MediaStreamTrack | null {
  if (track && track.readyState !== 'ended') return track
  try {
    const scope = typeof window !== 'undefined' && window ? (window as any) : null
    const AudioContextClass = scope?.AudioContext || scope?.webkitAudioContext
    if (!AudioContextClass) return null

    const audioContext: AudioContext = new AudioContextClass()
    // Nothing is connected to the destination: its track is silence.
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

/** Test-only reset. */
export function __resetSilentAudioForTests(): void {
  track = null
  context = null
}
