import { diagLog, summarizeStream } from '../utils/diagnosticLogger'

export interface AttachCtx {
  tile: string
  peer: string
  isLocal?: boolean
  muted?: boolean
  isLive?: boolean
}

function errShort(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

export function attachStreamToVideo(
  video: HTMLMediaElement,
  stream: MediaStream,
  ctx: AttachCtx
): () => void {
  const changed = video.srcObject !== stream
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
