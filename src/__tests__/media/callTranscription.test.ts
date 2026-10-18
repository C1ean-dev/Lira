import { describe, expect, it, vi } from 'vitest'
import { CallTranscription, SpeechSegmenter, selectTranscriptionSources } from '../../media/callTranscription'

// A waveform with zero mean, rather than a constant (DC offset is not speech).
const voice = (length: number, level: number, rate = 16000) => Float32Array.from(
  { length }, (_, i) => i % (rate / 200) < rate / 400 ? level : -level,
)

describe('call transcription audio isolation', () => {
  const stream = (id: string) => ({ id } as MediaStream)
  it('uses voice tracks, excludes screen audio, muted people, bots and other rooms', () => {
    const mic = stream('mic'), voice = stream('voice'), screen = stream('screen')
    const people = [
      { id: 'me', name: 'Ana', isLocal: true, stream: mic },
      { id: 'bob', name: 'Bruno', stream: screen, isScreenSharing: true },
      { id: 'muted', name: 'Carlos', stream: mic, isMuted: true },
      { id: 'bot', name: 'DJ', stream: mic, isDjBot: true },
      { id: 'screen-only', name: 'Dani', stream: screen, isScreenSharing: true },
    ]
    expect(selectTranscriptionSources(people, { bob: voice })).toEqual([
      { id: 'me', name: 'Ana', stream: mic }, { id: 'bob', name: 'Bruno', stream: voice },
    ])
  })

  it('segments each speaker independently, skips silence and flushes the last words', () => {
    const first = vi.fn(), second = vi.fn()
    const ana = new SpeechSegmenter(16000, first)
    const bob = new SpeechSegmenter(16000, second)
    ana.push(new Float32Array(16000))
    expect(first).not.toHaveBeenCalled()
    ana.push(voice(16000, 0.1))
    bob.push(voice(8000, 0.2))
    ana.push(new Float32Array(16000))
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
    bob.flush()
    expect(second).toHaveBeenCalledOnce()
    expect(second.mock.calls[0][0][0]).toBeCloseTo(0.2)
    expect(Math.max(...first.mock.calls[0][0])).toBeCloseTo(0.1)
    bob.flush()
    expect(second).toHaveBeenCalledOnce()
  })

  it('caps long speech at six seconds and resamples to 16kHz', () => {
    const emit = vi.fn()
    const segmenter = new SpeechSegmenter(48000, emit)
    for (let i = 0; i < 6; i++) segmenter.push(voice(48000, 0.1, 48000))
    expect(emit).toHaveBeenCalledOnce()
    expect(emit.mock.calls[0][0]).toHaveLength(96000)
  })

  it('keeps quiet speech that is audible through the call noise gate', () => {
    const emit = vi.fn()
    const segmenter = new SpeechSegmenter(16000, emit)
    segmenter.push(voice(16000, 0.0065))
    segmenter.flush()
    expect(emit).toHaveBeenCalledOnce()
  })

  it('does not send DC offsets or short clicks to the speech model', () => {
    const emit = vi.fn()
    const segmenter = new SpeechSegmenter(16000, emit)
    segmenter.push(new Float32Array(16000).fill(0.1))
    segmenter.flush()
    segmenter.push(voice(800, 0.2))
    segmenter.push(new Float32Array(16000))
    segmenter.flush()
    expect(emit).not.toHaveBeenCalled()
  })

  it('preserves word beginnings and keeps a sentence together through a brief pause', () => {
    const emit = vi.fn()
    const segmenter = new SpeechSegmenter(16000, emit)
    segmenter.push(new Float32Array(4096).fill(0.001))
    segmenter.push(voice(8000, 0.05))
    segmenter.push(new Float32Array(12000))
    expect(emit).not.toHaveBeenCalled()
    segmenter.push(voice(8000, 0.05))
    segmenter.push(new Float32Array(16000))
    expect(emit).toHaveBeenCalledOnce()
    expect(emit.mock.calls[0][0].length).toBeGreaterThan(30000)
    expect(emit.mock.calls[0][0].length).toBeLessThan(40000)
  })
})

describe('transcription lifecycle', () => {
  function setup() {
    const nodes: any[] = []
    const close = vi.fn(async () => {}), disconnect = vi.fn()
    vi.stubGlobal('AudioContext', class {
      sampleRate = 16000
      destination = {}
      resume = async () => {}
      close = close
      createMediaStreamSource = () => ({ connect: vi.fn(), disconnect })
      createScriptProcessor = () => {
        const node = { connect: vi.fn(), disconnect, onaudioprocess: null }
        nodes.push(node); return node
      }
    })
    vi.stubGlobal('MediaStream', class { constructor(public tracks: unknown[]) {} })
    const worker = { postMessage: vi.fn(), terminate: vi.fn(), onmessage: null as any, onerror: null as any }
    const status = vi.fn(), entry = vi.fn()
    const service = new CallTranscription(worker as any, status, entry, () => {})
    const track = { readyState: 'live', enabled: true, muted: false, stop: vi.fn() }
    const people = [{ id: 'ana', name: 'Ana', stream: { getAudioTracks: () => [track] } as any }]
    return { service, worker, status, entry, track, people, nodes, close, disconnect }
  }

  it('captures only after loading and keeps speaker identity in worker requests/results', async () => {
    const s = setup()
    await s.service.start()
    s.service.sync(s.people)
    expect(s.nodes).toHaveLength(0)
    s.worker.onmessage({ data: { type: 'ready' } })
    s.service.sync(s.people)
    s.service.sync(s.people)
    expect(s.nodes).toHaveLength(1)
    s.nodes[0].onaudioprocess({ inputBuffer: { getChannelData: () => voice(16000, 0.1) } })
    s.service.sync([])
    const message = s.worker.postMessage.mock.calls.find(([data]) => data.type === 'audio')![0]
    expect(message.entry).toMatchObject({ speakerId: 'ana', speakerName: 'Ana' })
    s.worker.onmessage({ data: { type: 'result', entry: { ...message.entry, text: 'Olá' } } })
    expect(s.entry).toHaveBeenCalledWith(expect.objectContaining({ speakerName: 'Ana', text: 'Olá' }))
    s.service.dispose()
    expect(s.track.stop).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('flushes the last phrase before stopping and waits for queued results', async () => {
    const s = setup()
    await s.service.start()
    s.worker.onmessage({ data: { type: 'ready' } })
    s.service.sync(s.people)
    s.nodes[0].onaudioprocess({ inputBuffer: { getChannelData: () => voice(8000, 0.1) } })
    s.service.stop()
    expect(s.worker.postMessage.mock.calls.map(([data]) => data.type)).toEqual(['load', 'audio', 'stop'])
    expect(s.worker.terminate).not.toHaveBeenCalled()
    s.worker.onmessage({ data: { type: 'stopped' } })
    expect(s.worker.terminate).toHaveBeenCalledOnce()
    expect(s.close).toHaveBeenCalledOnce()
    expect(s.track.stop).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('cancels model loading and ignores late results after leaving the room', async () => {
    const s = setup()
    await s.service.start()
    s.service.stop()
    s.worker.onmessage({ data: { type: 'ready' } })
    s.service.sync(s.people)
    s.worker.onmessage({ data: { type: 'result', entry: { text: 'late' } } })
    expect(s.nodes).toHaveLength(0)
    expect(s.entry).not.toHaveBeenCalled()
    expect(s.worker.terminate).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('reports worker failure and releases capture without stopping call tracks', async () => {
    const s = setup()
    await s.service.start()
    s.worker.onmessage({ data: { type: 'ready' } })
    s.service.sync(s.people)
    s.worker.onerror()
    expect(s.status).toHaveBeenLastCalledWith('error', expect.any(String))
    expect(s.worker.terminate).toHaveBeenCalledOnce()
    expect(s.disconnect).toHaveBeenCalled()
    expect(s.track.stop).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
