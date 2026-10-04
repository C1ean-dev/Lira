import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RemoteAudio } from '../components/common/RemoteAudio'
import { GridParticipantTile, ParticipantData } from '../components/grid/GridParticipantTile'
import { VideoTile } from '../components/MiniCallOverlay'

// A peer with the camera off: a mic plus the placeholder video track.
const peerStream = () =>
  ({
    getAudioTracks: () => [{ kind: 'audio', id: 'mic', enabled: true, readyState: 'live' }],
    getVideoTracks: () => [{ kind: 'video', id: 'placeholder', enabled: true, readyState: 'live' }],
  }) as unknown as MediaStream

const videoTags = (html: string) => html.match(/<video[^>]*>/g) || []
const audioTags = (html: string) => html.match(/<audio[^>]*>/g) || []

const remoteUser = (extra: Partial<ParticipantData> = {}): ParticipantData => ({
  id: 'peer-1',
  name: 'Ana',
  stream: peerStream(),
  isLocal: false,
  isCameraOff: true,
  isMuted: false,
  ...extra,
})

// Server rendering reads the stores' initial state, so only what comes from
// props can be checked here (deafen and per-person volume come from the store).
describe('who plays the sound of a call tile', () => {
  describe('RemoteAudio', () => {
    it('is an autoplaying audio element, not a video', () => {
      const html = renderToStaticMarkup(
        <RemoteAudio stream={peerStream()} tile="mini-audio" peer="Ana" muted={false} volume={1} />
      )
      expect(audioTags(html)).toHaveLength(1)
      expect(audioTags(html)[0]).toContain('autoplay')
      expect(html).not.toContain('<video')
      expect(audioTags(html)[0]).not.toContain('muted')
    })

    it('starts muted when it must be silent', () => {
      const html = renderToStaticMarkup(
        <RemoteAudio stream={peerStream()} tile="mini-audio" peer="Ana" muted={true} volume={1} />
      )
      expect(audioTags(html)[0]).toContain('muted')
    })
  })

  describe('grid tile', () => {
    for (const isSidebar of [false, true]) {
      const where = isSidebar ? 'sidebar' : 'main'

      it(`${where}: a remote participant is heard through the audio element, the video is silent`, () => {
        const html = renderToStaticMarkup(<GridParticipantTile user={remoteUser()} isSidebar={isSidebar} />)
        expect(audioTags(html)).toHaveLength(1)
        expect(audioTags(html)[0]).not.toContain('muted')
        expect(videoTags(html).length).toBeGreaterThan(0)
        expect(videoTags(html).every((tag) => tag.includes('muted'))).toBe(true)
      })

      it(`${where}: a remote live is heard the same way`, () => {
        const html = renderToStaticMarkup(
          <GridParticipantTile user={remoteUser({ isScreenSharing: true, screenStream: peerStream() })} isSidebar={isSidebar} />
        )
        expect(audioTags(html)).toHaveLength(1)
        expect(videoTags(html).every((tag) => tag.includes('muted'))).toBe(true)
      })

      it(`${where}: the local participant has no playback of their own audio`, () => {
        const html = renderToStaticMarkup(
          <GridParticipantTile user={remoteUser({ isLocal: true })} isSidebar={isSidebar} />
        )
        expect(audioTags(html)).toHaveLength(0)
        expect(videoTags(html).every((tag) => tag.includes('muted'))).toBe(true)
      })
    }

    it('has nothing to play before the call delivers a stream', () => {
      const html = renderToStaticMarkup(<GridParticipantTile user={remoteUser({ stream: null })} />)
      expect(audioTags(html)).toHaveLength(0)
    })
  })

  describe('mini tile', () => {
    const tile = (props: Partial<React.ComponentProps<typeof VideoTile>> = {}) =>
      renderToStaticMarkup(
        <VideoTile id="peer-1" stream={peerStream()} name="Ana" isLocal={false} isCameraOff={true} {...props} />
      )

    it('a remote participant is heard through the audio element, the video is silent', () => {
      const html = tile()
      expect(audioTags(html)).toHaveLength(1)
      expect(audioTags(html)[0]).not.toContain('muted')
      expect(videoTags(html)).toHaveLength(1)
      expect(videoTags(html)[0]).toContain('muted')
    })

    it('goes silent while the grid is open, so the sound is not doubled', () => {
      const html = tile({ suppressAudio: true })
      expect(audioTags(html)[0]).toContain('muted')
    })

    it('the local participant has no playback of their own audio', () => {
      const html = tile({ isLocal: true })
      expect(audioTags(html)).toHaveLength(0)
      expect(videoTags(html)[0]).toContain('muted')
    })

    it('has nothing to play before the call delivers a stream', () => {
      expect(audioTags(tile({ stream: null }))).toHaveLength(0)
    })
  })
})
