import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GridParticipantTile } from '../../components/grid/GridParticipantTile'

const state = vi.hoisted(() => ({
  audio: [] as any[],
  media: { participantVolumes: { speaker: 80 }, liveStreamVolume: 20, outputVolume: 100, selectedAudioOutput: 'default', isDeafened: false, isUserSilenced: () => false, removeCaptureBorder: false, setParticipantVolume: vi.fn(), setLiveStreamVolume: vi.fn() },
}))
vi.mock('../../store/useMediaStore', () => ({ useMediaStore: (select: any) => select(state.media) }))
vi.mock('../../store/useNetworkQualityStore', () => ({ useUserNetworkQuality: () => ({}) }))
vi.mock('../../components/NetworkSignalIcon', () => ({ NetworkSignalIcon: () => null }))
vi.mock('../../hooks/useLiveGate', () => ({ useLiveGate: () => ({ needsClick: false, watching: true, connecting: false }) }))
vi.mock('../../hooks/useLiveViewBox', () => ({ useLiveViewBox: () => {} }))
vi.mock('../../components/common/RemoteAudio', () => ({ RemoteAudio: (props: any) => { state.audio.push(props); return null } }))

const stream = (id: string) => ({ id, getVideoTracks: () => [{ kind: 'video', readyState: 'live', enabled: true }], getAudioTracks: () => [{ kind: 'audio', id }] }) as any
const voice = stream('voice')
const live = stream('live')
const user = { id: 'speaker', name: 'Pessoa', stream: voice, screenStream: live, isScreenSharing: true }
const render = () => { state.audio = []; renderToStaticMarkup(<GridParticipantTile user={user} />); return state.audio }
beforeEach(() => { state.media.participantVolumes.speaker = 80; state.media.liveStreamVolume = 20; state.media.isDeafened = false })
describe('independent live listening volume', () => {
  it('plays microphone and live from separate streams at separate gains', () => {
    const audio = render()
    expect(audio.find(a => a.stream === voice)?.volume).toBe(0.8)
    expect(audio.find(a => a.stream === live)?.volume).toBe(0.2)
  })
  it('muting the live leaves voice audible and muting voice leaves the live audible', () => {
    state.media.liveStreamVolume = 0
    let audio = render()
    expect(audio.find(a => a.stream === live)?.muted).toBe(true)
    expect(audio.find(a => a.stream === voice)?.muted).toBe(false)
    state.media.liveStreamVolume = 100
    state.media.participantVolumes.speaker = 0
    audio = render()
    expect(audio.find(a => a.stream === live)?.muted).toBe(false)
    expect(audio.find(a => a.stream === voice)?.muted).toBe(true)
  })
  it('deafening still silences both channels', () => {
    state.media.isDeafened = true
    expect(render().every(audio => audio.muted)).toBe(true)
  })
})
