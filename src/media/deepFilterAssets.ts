import upstreamWorklet from '@lofcz/deepfilternet-web/worklet?raw'
import wasmUrl from '@lofcz/deepfilternet-web/df_bg.wasm?url'
import workletSource from './deepFilterWorkletSrc.js?raw'
import workletCompat from './deepFilterWorkletCompat.js?raw'
import workerSource from './deepFilterWorkerSrc.js?raw'
import workerBridge from './deepFilterWorkerBridgeSrc.js?raw'
import type { NeuralWorkletModule } from './RnnoiseProcessor'

let modulePromise: Promise<WebAssembly.Module> | null = null

export function loadDeepFilterModule(): Promise<WebAssembly.Module> {
  if (!modulePromise) {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error('DeepFilterNet model load timeout'))
      }, 4500)
    })
    const compile = fetch(wasmUrl, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`DeepFilterNet WASM: HTTP ${response.status}`)
      return WebAssembly.compile(await response.arrayBuffer())
    })
    modulePromise = Promise.race([compile, timeout])
      .catch(error => { modulePromise = null; throw error })
      .finally(() => clearTimeout(timer))
  }
  return modulePromise
}

export function buildDeepFilterWorkletSource(name: string, testGlue?: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid DeepFilterNet processor name')
  const marker = upstreamWorklet.indexOf('  // src/worklet.ts')
  if (marker < 0) throw new Error('Unsupported DeepFilterNet glue; expected @lofcz/deepfilternet-web 0.1.0')
  const glue = testGlue === undefined
    ? upstreamWorklet.slice(0, marker).replace('  // pkg/df.js', `${workletCompat}\n  // pkg/df.js`)
    : `(() => {\n${testGlue}\n`
  return glue + workletSource.replace('__LIRA_DEEPFILTER_NAME__', name) + '\n})();\n'
}

export async function buildDeepFilterModule(name: string): Promise<NeuralWorkletModule> {
  const wasmModule = await loadDeepFilterModule()
  if (typeof Worker !== 'undefined' && typeof MessageChannel !== 'undefined') {
    try { return await buildWorkerModule(name, wasmModule) } catch { /* Preserve the synchronous backend on unsupported hosts. */ }
  }
  return {
    blobUrl: URL.createObjectURL(new Blob([buildDeepFilterWorkletSource(name)], { type: 'application/javascript' })),
    procName: name,
    debug: 'DeepFilterNet3 WASM SIMD',
    processorOptions: { wasmModule },
  }
}

async function buildWorkerModule(name: string, wasmModule: WebAssembly.Module): Promise<NeuralWorkletModule> {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Invalid DeepFilterNet processor name')
  const marker = upstreamWorklet.indexOf('  // src/worklet.ts')
  if (marker < 0) throw new Error('Unsupported DeepFilterNet WASM glue')
  const glue = upstreamWorklet.slice(0, marker).replace('  // pkg/df.js', `${workletCompat}\n  // pkg/df.js`)
  const url = URL.createObjectURL(new Blob([glue, workerSource, '\n})();'], { type: 'application/javascript' }))
  const channel = new MessageChannel()
  let worker: Worker
  try { worker = new Worker(url) } catch (error) {
    channel.port1.close(); channel.port2.close(); URL.revokeObjectURL(url); throw error
  }
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    worker.onerror = null
    worker.onmessage = null
    worker.terminate()
    channel.port1.close()
    channel.port2.close()
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { dispose(); reject(new Error('DeepFilterNet worker initialization timeout')) }, 2000)
      const fail = (message: string) => { clearTimeout(timer); reject(new Error(message)) }
      worker.onmessage = ({ data }) => { clearTimeout(timer); data?.ready ? resolve() : fail(data?.error || 'Worker initialization failed') }
      worker.onerror = event => fail(event.message || 'Worker initialization failed')
      try { worker.postMessage({ wasmModule, port: channel.port1 }, [channel.port1]) }
      catch (error) { fail(error instanceof Error ? error.message : String(error)) }
    })
    const blobUrl = URL.createObjectURL(new Blob([workerBridge.replace('__NAME__', name)], { type: 'application/javascript' }))
    return {
      blobUrl, procName: name, debug: 'DeepFilterNet3 WASM SIMD Worker', executionMode: 'worker', processorOptions: {}, dispose,
      connect(node) {
        if (disposed) throw new Error('DeepFilterNet worker disposed')
        worker.onerror = event => node.port.postMessage({ type: 'worker-error', message: event.message || 'Worker failed' })
        node.port.postMessage({ type: 'bind', port: channel.port2 }, [channel.port2])
      },
    }
  } catch (error) { dispose(); throw error } finally { URL.revokeObjectURL(url) }
}
