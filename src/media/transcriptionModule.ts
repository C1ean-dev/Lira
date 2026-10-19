export const TRANSCRIPTION_VERSION = '3.8.1'
export const TRANSCRIPTION_CACHE = `transcription/${TRANSCRIPTION_VERSION}/`
export const TRANSCRIPTION_ASSETS = [
  { name: 'transformers.min.js', size: 888173, sha256: 'aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa', type: 'text/javascript' },
  { name: 'ort-wasm-simd-threaded.jsep.mjs', size: 44484, sha256: '08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9', type: 'text/javascript' },
  { name: 'ort-wasm-simd-threaded.jsep.wasm', size: 21596019, sha256: 'c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39', type: 'application/wasm' },
] as const

export interface TranscriptionDownload {
  phase: 'dependencies' | 'model'
  loaded: number
  total?: number
  file?: string
}

export interface ModuleStore {
  get(key: string): Promise<Blob | undefined>
  put(key: string, value: Blob): Promise<void>
}

// IndexedDB also works in Electron's file renderer, where CacheStorage cannot
// reliably be used. Versioned dependencies and model files share one store.
let database: Promise<IDBDatabase> | undefined
function openDatabase(): Promise<IDBDatabase> {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('lira-optional-modules', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('files')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }).catch(error => { database = undefined; throw error })
  return database
}

export const transcriptionStore: ModuleStore = {
  async get(key) {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const request = db.transaction('files').objectStore('files').get(TRANSCRIPTION_CACHE + key)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  },
  async put(key, value) {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('files', 'readwrite')
      transaction.objectStore('files').put(value, TRANSCRIPTION_CACHE + key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error || new Error('Download interrompido'))
    })
  },
}

export async function isTranscriptionInstalled(store = transcriptionStore): Promise<boolean> {
  try {
    return Boolean(await store.get('installed')) && (await Promise.all(
      TRANSCRIPTION_ASSETS.map(asset => store.get(asset.name)),
    )).every((blob, index) => blob?.size === TRANSCRIPTION_ASSETS[index].size)
  } catch { return false }
}

export async function markTranscriptionInstalled(store = transcriptionStore) {
  await store.put('installed', new Blob(['ready']))
}

async function validAsset(blob: Blob | undefined, asset: typeof TRANSCRIPTION_ASSETS[number]): Promise<boolean> {
  if (!blob || blob.size !== asset.size) return false
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') === asset.sha256
}

export async function downloadTranscriptionDependencies(
  onProgress: (progress: TranscriptionDownload) => void,
  store = transcriptionStore,
  fetchFile: typeof fetch = fetch,
): Promise<Blob[]> {
  const total = TRANSCRIPTION_ASSETS.reduce((sum, asset) => sum + asset.size, 0)
  let loaded = 0
  const blobs: Blob[] = []
  for (const asset of TRANSCRIPTION_ASSETS) {
    let blob = await store.get(asset.name)
    if (!await validAsset(blob, asset)) {
      const response = await fetchFile(`https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSCRIPTION_VERSION}/dist/${asset.name}`)
      if (!response.ok || !response.body) throw new Error('Não foi possível baixar o módulo de transcrição.')
      const reader = response.body.getReader()
      const chunks: Uint8Array<ArrayBuffer>[] = []
      let received = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          received += value.byteLength
          if (received > asset.size) throw new Error('Arquivo de transcrição inválido.')
          chunks.push(new Uint8Array(value))
          onProgress({ phase: 'dependencies', loaded: loaded + received, total })
        }
      } catch (error) { await reader.cancel().catch(() => {}); throw error }
      blob = new Blob(chunks, { type: asset.type })
      if (!await validAsset(blob, asset)) throw new Error('O download da transcrição está incompleto ou inválido. Tente novamente.')
      await store.put(asset.name, blob)
    }
    blobs.push(new Blob([blob!], { type: asset.type }))
    loaded += asset.size
    onProgress({ phase: 'dependencies', loaded, total })
  }
  return blobs
}

// Transformers expects this subset of the Web Cache interface for model files.
export function transcriptionModelCache(store = transcriptionStore) {
  return {
    async match(request: string | Request) {
      const blob = await store.get(typeof request === 'string' ? request : request.url)
      return blob ? new Response(blob) : undefined
    },
    async put(request: string | Request, response: Response) {
      await store.put(typeof request === 'string' ? request : request.url, await response.blob())
    },
  }
}
