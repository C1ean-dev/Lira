import { describe, it, expect, vi } from 'vitest'
import { guardIpcHandler, guardIpcMain } from '../../electron/ipcGuard'

const makeHooks = () => {
  const clock = { ms: 1000 }
  const hooks = { onError: vi.fn(), onSlow: vi.fn(), now: () => clock.ms, slowMs: 500 }
  return { hooks, clock }
}

describe('guardIpcHandler', () => {
  it('returns what the handler returns and passes its arguments on', () => {
    const { hooks } = makeHooks()
    const handler = vi.fn((_event: unknown, a: number, b: number) => a + b)
    const guarded = guardIpcHandler('add', handler, hooks)

    expect(guarded({}, 2, 3)).toBe(5)
    expect(handler).toHaveBeenCalledWith({}, 2, 3)
    expect(hooks.onError).not.toHaveBeenCalled()
    expect(hooks.onSlow).not.toHaveBeenCalled()
  })

  it('reports a handler that throws, with the channel and how long it ran, and still throws', () => {
    const { hooks, clock } = makeHooks()
    const failure = new Error('EACCES')
    const guarded = guardIpcHandler('save-native-assets', () => {
      clock.ms += 12
      throw failure
    }, hooks)

    expect(() => guarded()).toThrow(failure)
    expect(hooks.onError).toHaveBeenCalledWith('save-native-assets', failure, 12)
  })

  it('reports a handler whose promise rejects, and still rejects', async () => {
    const { hooks, clock } = makeHooks()
    const failure = new Error('ECONNRESET')
    const guarded = guardIpcHandler('check-update', async () => {
      clock.ms += 40
      throw failure
    }, hooks)

    await expect(guarded()).rejects.toBe(failure)
    expect(hooks.onError).toHaveBeenCalledWith('check-update', failure, 40)
  })

  it('resolves with the value of an async handler', async () => {
    const { hooks } = makeHooks()
    await expect(guardIpcHandler('load', async () => ({ ok: true }), hooks)()).resolves.toEqual({ ok: true })
    expect(hooks.onError).not.toHaveBeenCalled()
  })

  it('notes a handler that kept the main process busy, sync or async', async () => {
    const { hooks, clock } = makeHooks()
    guardIpcHandler('sync-work', () => {
      clock.ms += 500
    }, hooks)()
    await guardIpcHandler('async-work', async () => {
      clock.ms += 900
    }, hooks)()
    guardIpcHandler('quick', () => {
      clock.ms += 499
    }, hooks)()

    expect(hooks.onSlow.mock.calls).toEqual([
      ['sync-work', 500],
      ['async-work', 900],
    ])
  })

  it('does not count the time an async handler spends waiting', async () => {
    const { hooks, clock } = makeHooks()
    const guarded = guardIpcHandler('download-update', async () => {
      clock.ms += 20
      await Promise.resolve()
      clock.ms += 60000
      return 'done'
    }, hooks)

    await expect(guarded()).resolves.toBe('done')
    expect(hooks.onSlow).not.toHaveBeenCalled()
  })

  it('never lets a hook change the outcome', async () => {
    const hooks = {
      onError: () => {
        throw new Error('hook broke')
      },
      onSlow: () => {
        throw new Error('hook broke')
      },
      slowMs: 0,
    }
    const failure = new Error('real failure')

    expect(guardIpcHandler('ok', () => 7, hooks)()).toBe(7)
    expect(() =>
      guardIpcHandler('bad', () => {
        throw failure
      }, hooks)()
    ).toThrow(failure)
    await expect(guardIpcHandler('bad-async', () => Promise.reject(failure), hooks)()).rejects.toBe(failure)
  })

  it('works without a slow hook', () => {
    const onError = vi.fn()
    expect(guardIpcHandler('x', () => 1, { onError })()).toBe(1)
  })
})

describe('guardIpcMain', () => {
  const makeIpc = () => {
    const handlers = new Map<string, (...args: any[]) => any>()
    return {
      handlers,
      handle(channel: string, listener: (...args: any[]) => any) {
        handlers.set(channel, listener)
      },
    }
  }

  it('guards every handler registered after it', () => {
    const { hooks } = makeHooks()
    const ipc = makeIpc()
    guardIpcMain(ipc, hooks)
    const failure = new Error('boom')
    ipc.handle('fails', () => {
      throw failure
    })
    ipc.handle('works', (_event: unknown, value: number) => value * 2)

    expect(() => ipc.handlers.get('fails')!({})).toThrow(failure)
    expect(ipc.handlers.get('works')!({}, 4)).toBe(8)
    expect(hooks.onError).toHaveBeenCalledTimes(1)
    expect(hooks.onError.mock.calls[0][0]).toBe('fails')
  })

  it('stops guarding after its restore function is called', () => {
    const { hooks } = makeHooks()
    const ipc = makeIpc()
    const restore = guardIpcMain(ipc, hooks)
    restore()
    ipc.handle('fails', () => {
      throw new Error('boom')
    })

    expect(() => ipc.handlers.get('fails')!({})).toThrow('boom')
    expect(hooks.onError).not.toHaveBeenCalled()
  })
})
