import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { LiveWatchPrompt } from '../components/LiveWatchPrompt'
import { FloatingScreenPreview, VideoTile } from '../components/MiniCallOverlay'
import { GridParticipantTile, ParticipantData } from '../components/grid/GridParticipantTile'
import { FullScreenLiveOverlay } from '../components/grid/FullScreenLiveOverlay'

// The stream of somebody who is live: the sound of the call and the screen.
const liveStream = () =>
  ({
    getAudioTracks: () => [{ kind: 'audio', id: 'mic', enabled: true, readyState: 'live' }],
    getVideoTracks: () => [{ kind: 'video', id: 'screen', enabled: true, readyState: 'live' }],
  }) as unknown as MediaStream

const videoTags = (html: string) => html.match(/<video[^>]*>/g) || []
const audioTags = (html: string) => html.match(/<audio[^>]*>/g) || []
const buttonsNamed = (html: string, label: string) =>
  (html.match(/<button[^>]*>[\s\S]*?<\/button>/g) || []).filter((b) => b.includes(label))

const WATCH = 'Assistir'
const STOP = 'Parar de assistir'
const CONNECTING = 'Conectando'

/**
 * Server rendering reads the stores' initial state, so who is being watched
 * comes in through props here, the way the overlays pass it down.
 */
describe('the click to watch a live', () => {
  describe('LiveWatchPrompt', () => {
    for (const size of ['tile', 'card', 'stage'] as const) {
      it(`${size}: is a button to watch`, () => {
        const html = renderToStaticMarkup(<LiveWatchPrompt size={size} name="Ana" onWatch={() => {}} />)
        expect(buttonsNamed(html, WATCH)).toHaveLength(1)
        expect(html).not.toContain(CONNECTING)
      })

      it(`${size}: says it is connecting after the click, with nothing left to click`, () => {
        const html = renderToStaticMarkup(<LiveWatchPrompt size={size} name="Ana" connecting />)
        expect(html).toContain(CONNECTING)
        expect(html).not.toContain('<button')
      })
    }

    it('says whose live it is where there is room for it', () => {
      for (const size of ['card', 'stage'] as const) {
        expect(renderToStaticMarkup(<LiveWatchPrompt size={size} name="Ana" onWatch={() => {}} />)).toContain('Ana')
      }
    })

    it('tells what the click brings, on the large one', () => {
      const html = renderToStaticMarkup(<LiveWatchPrompt size="stage" name="Ana" onWatch={() => {}} />)
      expect(html).toContain('vídeo')
      expect(html).toContain('som')
    })
  })

  describe('mini tile', () => {
    const tile = (props: Partial<React.ComponentProps<typeof VideoTile>> = {}) =>
      renderToStaticMarkup(
        <VideoTile
          id="peer-1"
          stream={liveStream()}
          name="Ana"
          isLocal={false}
          isScreenSharing={true}
          isScreenTrack={true}
          {...props}
        />
      )

    it('shows the button, and no picture, for a live that waits for the click', () => {
      const html = tile({ liveOptIn: true })
      expect(buttonsNamed(html, WATCH)).toHaveLength(1)
      expect(videoTags(html)).toHaveLength(0)
      expect(html).not.toContain(STOP)
    })

    it('still plays the sound of the call: the microphone of who is live', () => {
      const html = tile({ liveOptIn: true })
      expect(audioTags(html)).toHaveLength(1)
      expect(audioTags(html)[0]).not.toContain('muted')
    })

    it('shows the picture once this user is watching, with a way to stop', () => {
      const html = tile({ liveOptIn: true, liveWatching: true })
      expect(videoTags(html)).toHaveLength(1)
      expect(buttonsNamed(html, WATCH)).toHaveLength(0)
      expect(html).toContain(STOP)
      // No frame arrived yet.
      expect(html).toContain(CONNECTING)
    })

    it('shows a live of a version without the click right away, as before', () => {
      // Whatever the list of watched lives says: there is nothing to stop or to wait for.
      for (const html of [tile(), tile({ liveWatching: true })]) {
        expect(videoTags(html)).toHaveLength(1)
        expect(html).not.toContain(WATCH)
        expect(html).not.toContain(STOP)
        expect(html).not.toContain(CONNECTING)
      }
    })

    it('never asks for a click on what is not a live of somebody else', () => {
      const notLive = tile({ liveOptIn: true, isScreenSharing: false, isScreenTrack: false, isCameraOff: false })
      expect(videoTags(notLive)).toHaveLength(1)
      expect(notLive).not.toContain(WATCH)

      const own = tile({ liveOptIn: true, isLocal: true })
      expect(videoTags(own)).toHaveLength(1)
      expect(own).not.toContain(WATCH)
    })
  })

  describe('mini player', () => {
    const player = (props: Partial<React.ComponentProps<typeof FloatingScreenPreview>> = {}) =>
      renderToStaticMarkup(
        <FloatingScreenPreview
          stream={liveStream()}
          presenterId="peer-1"
          presenterName="Ana"
          isLocal={false}
          onExpand={() => {}}
          onClose={() => {}}
          {...props}
        />
      )

    it('shows the button, and no picture, for a live that waits for the click', () => {
      const html = player({ asksFirst: true })
      expect(buttonsNamed(html, WATCH)).toHaveLength(1)
      expect(videoTags(html)).toHaveLength(0)
      expect(html).not.toContain(STOP)
    })

    it('shows the picture once this user is watching, with a way to stop', () => {
      const html = player({ asksFirst: true, watching: true })
      expect(videoTags(html)).toHaveLength(1)
      expect(buttonsNamed(html, WATCH)).toHaveLength(0)
      expect(html).toContain(STOP)
      expect(html).toContain(CONNECTING)
    })

    it('shows a live of a version without the click right away', () => {
      const html = player()
      expect(videoTags(html)).toHaveLength(1)
      expect(html).not.toContain(WATCH)
      expect(html).not.toContain(STOP)
    })

    it('shows the own live without asking', () => {
      const html = player({ isLocal: true, asksFirst: true })
      expect(videoTags(html)).toHaveLength(1)
      expect(html).not.toContain(WATCH)
    })
  })

  const liveUser = (extra: Partial<ParticipantData> = {}): ParticipantData => ({
    id: 'peer-1',
    name: 'Ana',
    stream: liveStream(),
    screenStream: liveStream(),
    isScreenSharing: true,
    isLocal: false,
    ...extra,
  })

  describe('grid', () => {
    for (const isSidebar of [false, true]) {
      const where = isSidebar ? 'sidebar' : 'main'
      const tile = (extra: Partial<ParticipantData> = {}) =>
        renderToStaticMarkup(<GridParticipantTile user={liveUser(extra)} isSidebar={isSidebar} />)

      it(`${where}: shows the button, and no picture, for a live that waits for the click`, () => {
        const html = tile({ liveOptIn: true })
        expect(buttonsNamed(html, WATCH)).toHaveLength(1)
        expect(videoTags(html)).toHaveLength(0)
        expect(html).not.toContain(STOP)
        // The microphone of who is live goes on.
        expect(audioTags(html)).toHaveLength(1)
      })

      it(`${where}: shows the picture once this user is watching`, () => {
        const html = tile({ liveOptIn: true, liveWatching: true })
        expect(videoTags(html)).toHaveLength(1)
        expect(buttonsNamed(html, WATCH)).toHaveLength(0)
        expect(html).toContain(CONNECTING)
      })

      it(`${where}: shows a live of a version without the click right away`, () => {
        const html = tile()
        expect(videoTags(html)).toHaveLength(1)
        expect(html).not.toContain(WATCH)
        expect(html).not.toContain(STOP)
        expect(html).not.toContain(CONNECTING)
      })

      it(`${where}: shows the own live without asking`, () => {
        const html = tile({ isLocal: true, liveOptIn: true })
        expect(videoTags(html)).toHaveLength(1)
        expect(html).not.toContain(WATCH)
      })

      it(`${where}: never asks for a click on somebody who is not live`, () => {
        const html = tile({ liveOptIn: true, isScreenSharing: false, screenStream: null, isCameraOff: false })
        expect(videoTags(html)).toHaveLength(1)
        expect(html).not.toContain(WATCH)
      })
    }

    it('main: has a way to stop watching', () => {
      const html = renderToStaticMarkup(<GridParticipantTile user={liveUser({ liveOptIn: true, liveWatching: true })} />)
      expect(buttonsNamed(html, STOP)).toHaveLength(1)
    })
  })

  describe('full screen', () => {
    const theater = (extra: Partial<ParticipantData> = {}) =>
      renderToStaticMarkup(<FullScreenLiveOverlay user={liveUser(extra)} onClose={() => {}} />)

    it('shows the button, and no picture, for a live that waits for the click', () => {
      const html = theater({ liveOptIn: true })
      expect(buttonsNamed(html, WATCH)).toHaveLength(1)
      expect(videoTags(html)).toHaveLength(0)
      expect(html).not.toContain(STOP)
    })

    it('shows the picture once this user is watching, with a way to stop', () => {
      const html = theater({ liveOptIn: true, liveWatching: true })
      expect(videoTags(html)).toHaveLength(1)
      expect(buttonsNamed(html, WATCH)).toHaveLength(0)
      expect(buttonsNamed(html, STOP)).toHaveLength(1)
      expect(html).toContain(CONNECTING)
    })

    it('shows a live of a version without the click right away', () => {
      const html = theater()
      expect(videoTags(html)).toHaveLength(1)
      expect(html).not.toContain(WATCH)
      expect(html).not.toContain(STOP)
    })

    it('shows the own live without asking', () => {
      const html = theater({ isLocal: true, liveOptIn: true })
      expect(videoTags(html)).toHaveLength(1)
      expect(html).not.toContain(WATCH)
    })

    it('shows a camera in full screen without asking', () => {
      const html = theater({ liveOptIn: true, isScreenSharing: false, screenStream: null })
      expect(videoTags(html)).toHaveLength(1)
      expect(html).not.toContain(WATCH)
    })
  })
})
