import { diagLog, summarizeStream } from '../utils/diagnosticLogger'

export interface AttachCtx {
  tile: string
  peer: string
  isLocal?: boolean
  /** Override playback muting when more than one view is mounted. */
  muted?: boolean
  isLive?: boolean
}

function errShort(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

/**
 * Attach a MediaStream to a <video> element with play-failure recovery.
 *
 * Why this exists: in the zone-call mesh both peers dial each other, so two
 * remote streams per peer arrive ~150ms apart. The second srcObject
 * assignment aborts the first pending play() (AbortError) and the replacement
 * play() can sit PENDING forever while the sender's tracks carry no data yet
 * (muted/camera-off join). The old code only retried on *video* `unmute` —
 * when only the *audio* track unmuted, the element stayed paused: black tile
 * AND silence despite flowing RTP. This helper retries play on audio unmute
 * too, on track add/remove, and on click (a user gesture always unlocks play).
 */
export function attachStreamToVideo(
  video: HTMLVideoElement,
  stream: MediaStream,
  ctx: AttachCtx
): () => void {
  const changed = video.srcObject !== stream
  // Keep the playback element's audio policy synchronized with the stream.
  // React's `muted` attribute can lag a stream replacement; explicitly
  // unmuting remote streams prevents an intermittent silent call tile.
  try {
    video.muted = ctx.muted !== undefined ? ctx.muted : !!ctx.isLocal
  } catch {}
  if (changed) {
    video.srcObject = stream
    diagLog('tile', 'attach', {
      tile: ctx.tile,
      peer: ctx.peer,
      isLocal: !!ctx.isLocal,
      ...(ctx.isLive !== undefined ? { isLive: ctx.isLive } : {}),
      tracks: summarizeStream(stream),
    })
  }

  const tryPlay = (via: string) => {
    let p: unknown
    try {
      p = video.play()
    } catch {
      return
    }
    if (p && typeof (p as Promise<void>).then === 'function') {
      ;(p as Promise<void>).then(
        () => {
          if (video.srcObject === stream) {
            diagLog('tile', 'play-ok', {
              tile: ctx.tile,
              peer: ctx.peer,
              via,
              paused: video.paused,
              muted: video.muted,
              volume: video.volume,
            })
          }
        },
        (err) => {
          // Superseded by a newer stream winning the element: the winner's
          // own play() reports. Only the current stream's failure matters.
          if (video.srcObject !== stream) return
          diagLog('tile', 'play-failed', {
            tile: ctx.tile,
            peer: ctx.peer,
            via,
            error: errShort(err),
          })
        }
      )
    }
  }

  tryPlay(changed ? 'attach' : 'reattach')

  const onTrackEvent = () => {
    if (video.srcObject !== stream) return
    tryPlay('track-event')
  }
  const onClick = () => {
    if (video.srcObject !== stream) return
    tryPlay('click')
  }

  try {
    stream.addEventListener('addtrack', onTrackEvent)
  } catch {}
  try {
    stream.addEventListener('removetrack', onTrackEvent)
  } catch {}
  let tracks: MediaStreamTrack[] = []
  try {
    // NOTE: audio tracks included on purpose — audio-only unmute must also
    // resume a paused element, otherwise the tile stays silent with RTP
    // flowing (the exact "mic sem som" report).
    tracks = [...stream.getAudioTracks(), ...stream.getVideoTracks()]
  } catch {}
  tracks.forEach((t) => {
    try {
      t.addEventListener('unmute', onTrackEvent)
    } catch {}
  })
  try {
    video.addEventListener('click', onClick)
  } catch {}

  return () => {
    try {
      stream.removeEventListener('addtrack', onTrackEvent)
    } catch {}
    try {
      stream.removeEventListener('removetrack', onTrackEvent)
    } catch {}
    tracks.forEach((t) => {
      try {
        t.removeEventListener('unmute', onTrackEvent)
      } catch {}
    })
    try {
      video.removeEventListener('click', onClick)
    } catch {}
  }
}
