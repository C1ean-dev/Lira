import { attachStreamToVideo, AttachCtx } from './attachVideoElement'

const audioViews = new WeakMap<MediaStream, MediaStream>()
const audioGains = new WeakMap<HTMLMediaElement, { context: AudioContext; gain: GainNode }>()

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
  const input = audioOnlyStream(stream)
  let context: AudioContext | undefined
  let source: MediaStreamAudioSourceNode | undefined
  let gain: GainNode | undefined
  let destination: MediaStreamAudioDestinationNode | undefined
  let playback = input
  try {
    if (typeof AudioContext !== 'undefined' && input.getAudioTracks().length > 0) {
      try {
        context = new AudioContext({ sampleRate: 48000 })
      } catch {
        context = new AudioContext()
      }
      source = context.createMediaStreamSource(input)
      gain = context.createGain()
      destination = context.createMediaStreamDestination()
      gain.gain.value = 0
      source.connect(gain)
      gain.connect(destination)
      // Keep playback on the media element so setSinkId still selects the output.
      playback = destination.stream
      audioGains.set(el, { context, gain })
    }
  } catch {
    source?.disconnect()
    gain?.disconnect()
    if (context) void context.close().catch(() => {})
    context = undefined
  }
  const detach = attachStreamToVideo(el, playback, ctx)
  const resume = () => {
    if (context?.state === 'suspended') void context.resume().catch(() => {})
  }
  el.addEventListener('click', resume)
  return () => {
    detach()
    el.removeEventListener('click', resume)
    if (context) {
      if (audioGains.get(el)?.context === context) audioGains.delete(el)
      source?.disconnect()
      gain?.disconnect()
      destination?.disconnect()
      void context.close().catch(() => {})
    }
  }
}

export interface AudioOutput {
  muted: boolean
  volume: number
  sinkId?: string
}

export function applyAudioOutput(el: HTMLMediaElement, out: AudioOutput): void {
  const graph = audioGains.get(el)
  const volume = out.muted ? 0 : Math.max(0, Math.min(2, out.volume || 0))
  try {
    el.muted = out.muted
    if (graph) {
      graph.gain.gain.value = volume
      el.volume = 1
      if (volume > 0 && graph.context.state === 'suspended') void graph.context.resume().catch(() => {})
    } else {
      el.volume = Math.min(1, volume)
    }
  } catch {}
  if (out.sinkId !== undefined && typeof (el as any).setSinkId === 'function') {
    const sink = out.sinkId === 'default' ? '' : out.sinkId
    try {
      Promise.resolve((el as any).setSinkId(sink)).catch(() => {})
    } catch {}
  }
  if (!out.muted && (out.volume || 0) > 0 && el.paused) {
    try {
      el.play().catch(() => {})
    } catch {}
  }
}
