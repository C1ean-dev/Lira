import { describe, expect, it } from 'vitest'
import { updateSpotifyPlaybackView } from '../../services/spotifyPlaybackView'
import type { SpotifyPlaybackFrameData } from '../../types/spotifyPlayback'

const frame = { playing: true, buttons: [{ id: 'next', label: 'Próxima', disabled: false, active: false }], seek: { value: 20, position: 48, duration: 240 } } as SpotifyPlaybackFrameData

describe('stable Spotify playback view', () => {
  it('keeps the last working controls through temporary failures and thrown errors', () => {
    let view = updateSpotifyPlaybackView({ frame: null, error: null }, { ok: true, frame })
    for (const error of ['Timeout', 'Reconectando', 'Controles indisponíveis']) {
      view = updateSpotifyPlaybackView(view, { ok: false, error })
      expect(view.frame).toBe(frame)
      expect(view.error).toBe(error)
    }
  })

  it('replaces state and clears the error when the page recovers', () => {
    const changed = { ...frame, playing: false }
    expect(updateSpotifyPlaybackView({ frame, error: 'Timeout' }, { ok: true, frame: changed })).toEqual({ frame: changed, error: null })
  })

  it('shows an explanation when no usable state has arrived yet', () => {
    const view = updateSpotifyPlaybackView({ frame: null, error: null }, { ok: false, error: 'Escolha uma música' })
    expect(view).toEqual({ frame: null, error: 'Escolha uma música' })
  })
})
