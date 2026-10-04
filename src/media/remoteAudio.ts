import { attachStreamToVideo, AttachCtx } from './attachVideoElement'

/**
 * Remote call audio is played by an <audio> element fed with ONLY the audio
 * tracks of the peer's stream, never by the tile's <video>.
 *
 * Why: Chromium does not start a <video> (so no sound either) until its video
 * track delivers a first frame. A peer with the camera off sends the
 * placeholder track, which often never produces a frame; its play() stayed
 * pending and the peer was inaudible until something else made a frame flow
 * (opening the call grid adds a sink and forces one, a live starts, ...).
 */

const audioViews = new WeakMap<MediaStream, MediaStream>()

/**
 * The audio tracks of `stream` as their own stream. The same object is
 * returned while those tracks do not change, so an element keeps its source
 * across re-renders.
 */
export function audioOnlyStream(stream: MediaStream): MediaStream {
  const tracks = stream.getAudioTracks()
  const cached = audioViews.get(stream)
  if (cached) {
    const current = cached.getAudioTracks()
    if (current.length === tracks.length && current.every((t, i) => t === tracks[i])) return cached
  }
  const view = new MediaStream(tracks)
  audioViews.set(stream, view)
  return view
}

/** Play the audio of `stream` on `el`. Returns the cleanup of the attach. */
export function attachRemoteAudio(el: HTMLMediaElement, stream: MediaStream, ctx: AttachCtx): () => void {
  return attachStreamToVideo(el, audioOnlyStream(stream), ctx)
}

export interface AudioOutput {
  muted: boolean
  /** 0..1 */
  volume: number
  /** Output device id, or 'default'. */
  sinkId?: string
}

/** Apply mute, volume and output device to a playback element. Never throws. */
export function applyAudioOutput(el: HTMLMediaElement, out: AudioOutput): void {
  try {
    el.muted = out.muted
    el.volume = out.muted ? 0 : Math.max(0, Math.min(1, out.volume || 0))
  } catch {}
  if (out.sinkId && typeof (el as any).setSinkId === 'function') {
    try {
      Promise.resolve((el as any).setSinkId(out.sinkId === 'default' ? '' : out.sinkId)).catch(() => {})
    } catch {}
  }
}
