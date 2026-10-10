
export interface IpcGuardHooks {
  onError(channel: string, error: unknown, ms: number): void
  onSlow?(channel: string, ms: number): void
  slowMs?: number
  now?: () => number
}

export const SLOW_IPC_MS = 300

type Handler = (...args: any[]) => any

export function guardIpcHandler<T extends Handler>(channel: string, listener: T, hooks: IpcGuardHooks): T {
  const now = hooks.now ?? (() => Date.now())
  const slowMs = hooks.slowMs ?? SLOW_IPC_MS

  const returned = (startedAt: number) => {
    const ms = now() - startedAt
    if (ms >= slowMs) {
      try {
        hooks.onSlow?.(channel, ms)
      } catch {
      }
    }
  }
  const failed = (startedAt: number, error: unknown) => {
    try {
      hooks.onError(channel, error, now() - startedAt)
    } catch {
    }
  }

  const guarded = (...args: any[]) => {
    const startedAt = now()
    let result: unknown
    try {
      result = listener(...args)
    } catch (error) {
      failed(startedAt, error)
      throw error
    }
    returned(startedAt)
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      return (result as Promise<unknown>).then(undefined, (error) => {
        failed(startedAt, error)
        throw error
      })
    }
    return result
  }
  return guarded as T
}

export function guardIpcMain(ipc: { handle(channel: string, listener: Handler): void }, hooks: IpcGuardHooks): () => void {
  const original = ipc.handle
  ipc.handle = (channel: string, listener: Handler) => original.call(ipc, channel, guardIpcHandler(channel, listener, hooks))
  return () => {
    ipc.handle = original
  }
}
