// @vitest-environment jsdom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpaceTranscriptionProvider } from '../../components/collaboration/SpaceTranscriptionProvider'
import { CollaborationButtons } from '../../components/collaboration/CollaborationButtons'
import { MeetingSummaryPanel } from '../../components/collaboration/MeetingSummaryPanel'
import { FullScreenGrid } from '../../components/FullScreenGrid'
import { useGameStore } from '../../store/useGameStore'
import { useMediaStore } from '../../store/useMediaStore'
import { useMeetingStore } from '../../store/useMeetingStore'

vi.mock('../../media/transcriptionModule', () => ({ isTranscriptionInstalled: async () => true }))
vi.mock('../../p2p/PeerManager', () => ({ PeerManager: { getInstance: vi.fn() } }))
vi.mock('../../media/MediaManager', () => ({ MediaManager: {} }))
vi.mock('../../components/ScreenShareModal', () => ({ ScreenShareModal: () => null }))
vi.mock('../../components/grid/CallControlsBar', () => ({ CallControlsBar: () => null }))
vi.mock('../../components/grid/GridParticipantTile', () => ({ GridParticipantTile: () => null }))
vi.mock('../../components/grid/ParticipantContextMenu', () => ({ ParticipantContextMenu: () => null }))
vi.mock('../../components/grid/FullScreenLiveOverlay', () => ({ FullScreenLiveOverlay: () => null }))

const game = useGameStore.getState(), media = useMediaStore.getState(), meetings = useMeetingStore.getState()
const workers: TestWorker[] = []
const captured: string[] = []
class TestWorker {
  onmessage: ((event: any) => void) | null = null
  onerror = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { workers.push(this) }
  emit(data: unknown) { this.onmessage?.({ data }) }
}
const stream = (id: string) => ({ getAudioTracks: () => [{ id, readyState: 'live', enabled: true, muted: false }] }) as unknown as MediaStream

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
})
beforeEach(() => {
  workers.length = 0; captured.length = 0
  vi.stubGlobal('Worker', TestWorker)
  vi.stubGlobal('MediaStream', class { constructor(private tracks: any[]) {} getAudioTracks() { return this.tracks } })
  vi.stubGlobal('AudioContext', class {
    sampleRate = 48000
    destination = {}
    resume = async () => {}
    close = async () => {}
    createMediaStreamSource(value: MediaStream) {
      captured.push(value.getAudioTracks()[0].id)
      return { connect: vi.fn(), disconnect: vi.fn() }
    }
    createScriptProcessor() { return { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null } }
  })
  useGameStore.setState({ roomId: 'space', isConnected: true, isOwner: false,
    localPlayer: { ...game.localPlayer, id: 'local', name: 'Ana', currentZoneId: 'zone' },
    remotePlayers: {
      bob: { ...game.localPlayer, id: 'bob', name: 'Bruno', currentZoneId: 'zone', isScreenSharing: true, isMuted: false, isMutedByAdmin: false },
      other: { ...game.localPlayer, id: 'other', name: 'Outra sala', currentZoneId: 'other-zone' },
      'dj-bot': { ...game.localPlayer, id: 'dj-bot', name: 'DJ', currentZoneId: 'zone' },
    },
  })
  useMediaStore.setState({ isGridCallOpen: false, isMuted: false, localStream: stream('local-mic'),
    peerStreams: { bob: stream('screen-audio'), other: stream('other-room'), 'dj-bot': stream('music') },
    peerVoiceStreams: { bob: stream('bob-voice') }, peerScreenStreams: {},
  })
  useMeetingStore.setState({ meetings: [], isOpen: false })
})
afterEach(() => {
  cleanup()
  for (const worker of workers) worker.emit({ type: 'stopped' })
  useGameStore.setState(game); useMediaStore.setState(media); useMeetingStore.setState(meetings)
  vi.unstubAllGlobals(); vi.restoreAllMocks()
})

function mount() {
  return render(<SpaceTranscriptionProvider>
    <CollaborationButtons /><MeetingSummaryPanel /><FullScreenGrid />
  </SpaceTranscriptionProvider>)
}
async function startFromMap() {
  fireEvent.click(screen.getByRole('button', { name: 'Abrir transcrições e resumo' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Iniciar transcrição', exact: true })).toBeDefined())
  fireEvent.click(screen.getByRole('button', { name: 'Iniciar transcrição', exact: true }))
  await waitFor(() => expect(workers[0]?.postMessage).toHaveBeenCalledWith({ type: 'load' }))
  return workers[0]
}

describe('transcription shared by the map and expanded call', () => {
  it('starts from the map and keeps the same recording when panels and the expanded call close', async () => {
    mount()
    expect(workers).toHaveLength(0)
    const worker = await startFromMap()
    fireEvent.click(screen.getByRole('button', { name: 'Fechar transcrições e resumo' }))
    expect(worker.postMessage).not.toHaveBeenCalledWith({ type: 'stop' })
    act(() => worker.emit({ type: 'ready' }))
    expect(captured).toEqual(['local-mic', 'bob-voice'])
    act(() => useMediaStore.getState().setGridCallOpen(true))
    fireEvent.click(screen.getByTitle('Transcrição da chamada por participante'))
    expect(screen.getByRole('button', { name: 'Parar transcrição' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Voltar ao Mapa 2D' }))
    expect(workers).toHaveLength(1)
    expect(worker.postMessage).not.toHaveBeenCalledWith({ type: 'stop' })
    fireEvent.click(screen.getByRole('button', { name: 'Abrir transcrições e resumo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Parar transcrição' }))
    act(() => {
      worker.emit({ type: 'result', entry: { id: 1, speakerId: 'bob', speakerName: 'Bruno', text: 'Decisão final.', timestamp: 1 } })
      worker.emit({ type: 'stopped' })
    })
    expect(useMeetingStore.getState().meetings).toHaveLength(1)
    expect(useMeetingStore.getState().meetings[0]).toMatchObject({ endedAt: expect.any(Number), entries: [{ text: 'Decisão final.' }] })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('finishes the previous room and keeps its final words when moving to another room', async () => {
    mount()
    const worker = await startFromMap()
    act(() => worker.emit({ type: 'ready' }))
    act(() => useGameStore.getState().setLocalPlayer({ currentZoneId: 'next-zone' }))
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'stop' })
    expect(workers).toHaveLength(1)
    act(() => {
      worker.emit({ type: 'result', entry: { id: 1, speakerId: 'local', speakerName: 'Ana', text: 'Última fala.', timestamp: 1 } })
      worker.emit({ type: 'stopped' })
    })
    expect(useMeetingStore.getState().meetings[0]).toMatchObject({ zoneId: 'zone', endedAt: expect.any(Number), entries: [{ text: 'Última fala.' }] })
  })

  it('does not start a worker or offer recording outside a room', async () => {
    useGameStore.getState().setLocalPlayer({ currentZoneId: null })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir transcrições e resumo' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Iniciar transcrição', exact: true }).hasAttribute('disabled')).toBe(true))
    expect(workers).toHaveLength(0)
  })
})
