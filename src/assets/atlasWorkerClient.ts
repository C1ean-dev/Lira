let worker: Worker | null = null
let nextId = 0
const pending = new Map<number, { resolve(value: any): void; reject(reason: Error): void }>()
export function runAtlasTask<T>(method: 'build' | 'read' | 'digest' | 'encode' | 'decodeTransfer', value: unknown, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    if (!worker) {
      worker = new Worker(new URL('./atlas.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = event => {
        const request = pending.get(event.data.id)
        if (!request) return
        pending.delete(event.data.id)
        if (event.data.error) request.reject(new Error(event.data.error))
        else request.resolve(event.data.result)
      }
      worker.onerror = event => {
        const failed = worker
        worker = null
        failed?.terminate()
        for (const request of pending.values()) request.reject(new Error(event.message || 'Falha no processamento do atlas'))
        pending.clear()
      }
    }
    const id = ++nextId
    pending.set(id, { resolve, reject })
    try { worker.postMessage({ id, method, value }, transfer) }
    catch (error) { pending.delete(id); reject(error) }
  })
}