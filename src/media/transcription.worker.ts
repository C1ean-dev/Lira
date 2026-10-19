import type { AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { loadTranscriptionRuntime } from './transcriptionRuntime'
let recognizer: AutomaticSpeechRecognitionPipeline | null = null
let queue = Promise.resolve()

self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    if (data.type === 'load') {
      recognizer = await loadTranscriptionRuntime(progress => self.postMessage({ type: 'progress', progress }))
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
    self.postMessage({ type: 'error', message: 'Não foi possível preparar a transcrição. Verifique a conexão e o espaço livre no dispositivo e tente novamente.' })
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
