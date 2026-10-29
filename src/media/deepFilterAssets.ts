import upstreamWorklet from '@lofcz/deepfilternet-web/worklet?raw'
import wasmUrl from '@lofcz/deepfilternet-web/df_bg.wasm?url'
import workletSource from './deepFilterWorkletSrc.js?raw'
import workletCompat from './deepFilterWorkletCompat.js?raw'

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

export async function buildDeepFilterModule(name: string) {
  const wasmModule = await loadDeepFilterModule()
  return {
    blobUrl: URL.createObjectURL(new Blob([buildDeepFilterWorkletSource(name)], { type: 'application/javascript' })),
    procName: name,
    debug: 'DeepFilterNet3 WASM SIMD',
    processorOptions: { wasmModule },
  }
}
