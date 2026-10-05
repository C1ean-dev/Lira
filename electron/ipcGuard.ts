/**
 * Wraps the handlers of `ipcMain.handle` so that a failing one is reported with
 * the name of its channel (the renderer only sees "Error invoking remote
 * method"), and one that keeps the main process busy is noted: while a handler
 * runs, every window waits. Only the synchronous part counts for that; the time
 * an async handler spends waiting (a download, a network call) blocks nothing.
 * The result of the handler is never changed.
 */

export interface IpcGuardHooks {
  onError(channel: string, error: unknown, ms: number): void
  onSlow?(channel: string, ms: number): void
  /** From how many milliseconds of synchronous work a handler counts as slow. */
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
        // a hook must not change the outcome
      }
    }
  }
  const failed = (startedAt: number, error: unknown) => {
    try {
      hooks.onError(channel, error, now() - startedAt)
    } catch {
      // a hook must not change the outcome
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

/** Guards every handler registered from now on. Returns the function that undoes it. */
export function guardIpcMain(ipc: { handle(channel: string, listener: Handler): void }, hooks: IpcGuardHooks): () => void {
  const original = ipc.handle
  ipc.handle = (channel: string, listener: Handler) => original.call(ipc, channel, guardIpcHandler(channel, listener, hooks))
  return () => {
    ipc.handle = original
  }
}
