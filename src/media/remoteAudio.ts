import { attachStreamToVideo, AttachCtx } from './attachVideoElement'

const audioViews = new WeakMap<MediaStream, MediaStream>()
type PlaybackGain = { context: AudioContext; source: MediaStreamAudioSourceNode; gain: GainNode; stream: MediaStream; sink: string }
const playbackGains = new WeakMap<HTMLMediaElement, PlaybackGain>()

function releasePlaybackGain(el: HTMLMediaElement) {
  const graph = playbackGains.get(el)
  if (!graph) return
  playbackGains.delete(el)
  graph.source.disconnect()
  graph.gain.disconnect()
  if (graph.context.state !== 'closed') void graph.context.close().catch(() => {})
}

function amplifiedPlayback(el: HTMLMediaElement, out: AudioOutput): PlaybackGain | undefined {
  const existing = playbackGains.get(el)
  if (existing) return existing
  const stream = el.srcObject as MediaStream | null
  const Context = typeof window !== 'undefined' ? window.AudioContext || (window as any).webkitAudioContext : null
  if (!(out.volume > 1) || !Context || !stream?.getAudioTracks?.().length) return undefined
  let context: AudioContext | undefined
  try {
    const sink = !out.sinkId || out.sinkId === 'default' ? '' : out.sinkId
    const options: AudioContextOptions & { sinkId?: string } = { sampleRate: 48000, ...(sink ? { sinkId: sink } : {}) }
    context = new Context(options)
    const source = context!.createMediaStreamSource(stream)
    const gain = context!.createGain()
    gain.gain.setValueAtTime(0, context!.currentTime)
    source.connect(gain)
    gain.connect(context!.destination)
    const graph = { context: context!, source, gain, stream, sink }
    playbackGains.set(el, graph)
    return graph
  } catch {
    void context?.close().catch(() => {})
    return undefined
  }
}

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
  const cleanup = attachStreamToVideo(el, audioOnlyStream(stream), ctx)
  return () => { releasePlaybackGain(el); cleanup() }
}

export interface AudioOutput {
  muted: boolean
  volume: number
  sinkId?: string
}

export function applyAudioOutput(el: HTMLMediaElement, out: AudioOutput): void {
  const graph = amplifiedPlayback(el, out)
  if (graph) {
    // The HTML element remains silent; only this local Web Audio graph plays.
    el.muted = true
    el.volume = 1
    const volume = Number.isFinite(out.volume) ? Math.max(0, Math.min(4, out.volume)) : 0
    graph.gain.gain.setValueAtTime(out.muted ? 0 : volume, graph.context.currentTime)
    if (graph.context.state === 'suspended' || String(graph.context.state) === 'interrupted') void graph.context.resume().catch(() => {})
    const sink = !out.sinkId || out.sinkId === 'default' ? '' : out.sinkId
    if (out.sinkId !== undefined && graph.sink !== sink && typeof (graph.context as any).setSinkId === 'function') {
      graph.sink = sink
      void (graph.context as any).setSinkId(sink).catch(() => {})
    }
    return
  }
  try {
    el.muted = out.muted
    el.volume = out.muted ? 0 : Math.max(0, Math.min(1, out.volume || 0))
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
