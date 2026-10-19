import type { AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import { downloadTranscriptionDependencies, markTranscriptionInstalled, transcriptionModelCache, type TranscriptionDownload } from './transcriptionModule'

export async function loadTranscriptionRuntime(onProgress: (progress: TranscriptionDownload) => void): Promise<AutomaticSpeechRecognitionPipeline> {
  const blobs = await downloadTranscriptionDependencies(onProgress)
  // These URLs remain alive for this worker's lifetime, including ONNX imports.
  // Terminating the worker releases them and cancels in-flight downloads.
  const [runtimeURL, mjs, wasm] = blobs.map(blob => URL.createObjectURL(blob))
  const { env, pipeline } = await import(/* @vite-ignore */ runtimeURL) as typeof import('@huggingface/transformers')
  env.allowLocalModels = false
  env.useBrowserCache = false
  env.useCustomCache = true
  env.customCache = transcriptionModelCache()
  env.backends.onnx.wasm!.numThreads = 1
  env.backends.onnx.wasm!.proxy = false
  env.backends.onnx.wasm!.wasmPaths = { mjs, wasm }
  onProgress({ phase: 'model', loaded: 0 })
  const create = pipeline as unknown as (
    task: string, model: string, options: Record<string, unknown>,
  ) => Promise<AutomaticSpeechRecognitionPipeline>
  const recognizer = await create('automatic-speech-recognition', 'Xenova/whisper-base', {
    device: 'wasm', dtype: 'q8',
    progress_callback: (event: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (event.status === 'progress') onProgress({ phase: 'model', file: event.file, loaded: event.loaded || 0, total: event.total })
    },
  })
  await markTranscriptionInstalled()
  return recognizer
}
