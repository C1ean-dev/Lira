import { attachStreamToVideo, AttachCtx } from './attachVideoElement'

const audioViews = new WeakMap<MediaStream, MediaStream>()

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

export function attachRemoteAudio(el: HTMLMediaElement, stream: MediaStream, ctx: AttachCtx): () => void {
  return attachStreamToVideo(el, audioOnlyStream(stream), ctx)
}

export interface AudioOutput {
  muted: boolean
  volume: number
  sinkId?: string
}

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
