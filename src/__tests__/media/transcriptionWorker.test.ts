import { afterEach, describe, expect, it, vi } from 'vitest'

const { pipeline, recognize } = vi.hoisted(() => ({ pipeline: vi.fn(), recognize: vi.fn() }))
vi.mock('../../media/transcriptionRuntime', () => ({ loadTranscriptionRuntime: pipeline }))

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.resetAllMocks() })

describe('local transcription worker', () => {
  it('loads multilingual Whisper once and serializes people before finishing', async () => {
    pipeline.mockResolvedValue(recognize)
    let finish!: (value: { text: string }) => void
    recognize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      .mockResolvedValueOnce({ text: ' Resposta de Bruno ' })
    const scope = { onmessage: null as any, postMessage: vi.fn() }
    vi.stubGlobal('self', scope)
    await import('../../media/transcription.worker')
    scope.onmessage({ data: { type: 'load' } })
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith({ type: 'ready' }))
    expect(pipeline).toHaveBeenCalledOnce()
    scope.onmessage({ data: { type: 'audio', audio: new Float32Array(16000), entry: { speakerId: 'ana', speakerName: 'Ana' } } })
    scope.onmessage({ data: { type: 'audio', audio: new Float32Array(16000), entry: { speakerId: 'bruno', speakerName: 'Bruno' } } })
    scope.onmessage({ data: { type: 'stop' } })
    await vi.waitFor(() => expect(recognize).toHaveBeenCalledOnce())
    expect(scope.postMessage).not.toHaveBeenCalledWith({ type: 'stopped' })
    finish({ text: ' Olá, Bruno ' })
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenLastCalledWith({ type: 'stopped' }))
    expect(scope.postMessage.mock.calls.map(([data]) => data.type)).toEqual(['ready', 'result', 'result', 'stopped'])
    expect(scope.postMessage).toHaveBeenCalledWith({ type: 'result', entry: { speakerId: 'ana', speakerName: 'Ana', text: 'Olá, Bruno' } })
    expect(recognize).toHaveBeenCalledWith(expect.any(Float32Array), expect.objectContaining({
      language: 'portuguese', task: 'transcribe', max_new_tokens: 24, no_repeat_ngram_size: 3,
    }))
  })

  it('discards degenerate repetition rather than publishing invented paragraphs', async () => {
    pipeline.mockResolvedValue(recognize)
    recognize.mockResolvedValueOnce({ text: 'É, é... '.repeat(80) })
      .mockResolvedValueOnce({ text: 'Vamos ver aqui. '.repeat(25) })
      .mockResolvedValueOnce({ text: 'Sim, sim. Vamos ver aqui como ficou a chamada.' })
    const scope = { onmessage: null as any, postMessage: vi.fn() }
    vi.stubGlobal('self', scope)
    await import('../../media/transcription.worker')
    scope.onmessage({ data: { type: 'load' } })
    for (let i = 0; i < 3; i++) scope.onmessage({ data: { type: 'audio', audio: new Float32Array(16000), entry: { id: i, speakerId: 'ana' } } })
    scope.onmessage({ data: { type: 'stop' } })
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenLastCalledWith({ type: 'stopped' }))
    const results = scope.postMessage.mock.calls.map(([data]) => data).filter(data => data.type === 'result')
    expect(results.map(data => data.entry.text)).toEqual(['', '', 'Sim, sim. Vamos ver aqui como ficou a chamada.'])
  })

  it('reports model download failures so capture can be released', async () => {
    pipeline.mockRejectedValueOnce(new Error('offline'))
    const scope = { onmessage: null as any, postMessage: vi.fn() }
    vi.stubGlobal('self', scope)
    await import('../../media/transcription.worker')
    scope.onmessage({ data: { type: 'load' } })
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })))
  })
})
