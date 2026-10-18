import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

env.allowLocalModels = false
// WASM executes inside this worker, including on Electron without WebGPU.
env.backends.onnx.wasm!.numThreads = 1
let recognizer: AutomaticSpeechRecognitionPipeline | null = null
let queue = Promise.resolve()
// Narrow the generic factory before calling it: its union of every supported
// model exceeds TypeScript's complexity limit when instantiated by Whisper.
const createRecognizer = pipeline as unknown as (
  task: 'automatic-speech-recognition', model: string, options: { device: 'wasm'; dtype: 'q8' },
) => Promise<AutomaticSpeechRecognitionPipeline>

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    if (data.type === 'load') {
      recognizer = await createRecognizer('automatic-speech-recognition', 'Xenova/whisper-base', { device: 'wasm', dtype: 'q8' })
      self.postMessage({ type: 'ready' })
    } else if (data.type === 'audio' && recognizer) {
      const result = await recognizer(data.audio, {
        language: 'portuguese', task: 'transcribe',
        // A short audio segment must not generate hundreds of invented tokens.
        max_new_tokens: Math.min(128, Math.max(24, Math.ceil(data.audio.length / 16000 * 12))),
        no_repeat_ngram_size: 3,
        repetition_penalty: 1.1,
      })
      const text = Array.isArray(result) ? result.map(part => part.text).join(' ') : result.text
      self.postMessage({ type: 'result', entry: { ...data.entry, text: cleanTranscript(text) } })
    } else if (data.type === 'stop') {
      self.postMessage({ type: 'stopped' })
    }
  }).catch(() => {
    self.postMessage({ type: 'error', message: 'Não foi possível transcrever. Verifique a conexão para baixar o modelo e tente novamente.' })
  })
}

function cleanTranscript(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  const words = trimmed.toLocaleLowerCase('pt-BR').match(/[\p{L}\p{N}]+/gu) || []
  // Reject a degenerate decoding loop, without rewriting plausible speech or
  // removing ordinary repetitions such as "sim, sim".
  if (words.length >= 12) {
    const phrases = new Set<string>()
    for (let i = 0; i < words.length - 2; i++) phrases.add(words.slice(i, i + 3).join(' '))
    if (phrases.size / (words.length - 2) < 0.35) return ''
  }
  return trimmed
}
