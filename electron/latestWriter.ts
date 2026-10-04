interface Waiter {
  resolve: () => void
  reject: (error: unknown) => void
}

interface Job<T> {
  value: T
  waiters: Waiter[]
}

interface KeyState<T> {
  running: boolean
  pending: Job<T> | null
}

/**
 * Writes one thing at a time per key. What is submitted while a write is going on waits, and when
 * several pile up only the latest is written (the others would be overwritten at once anyway). Every
 * caller is answered when the write that covers what it submitted has finished, or has failed.
 */
export function createLatestWriter<T>(write: (key: string, value: T) => Promise<void>): (key: string, value: T) => Promise<void> {
  const states = new Map<string, KeyState<T>>()

  const run = async (key: string, state: KeyState<T>, first: Job<T>): Promise<void> => {
    state.running = true
    let job: Job<T> | null = first
    while (job) {
      const current: Job<T> = job
      try {
        await write(key, current.value)
        current.waiters.forEach((waiter) => waiter.resolve())
      } catch (error) {
        current.waiters.forEach((waiter) => waiter.reject(error))
      }
      job = state.pending
      state.pending = null
    }
    state.running = false
  }

  return (key, value) =>
    new Promise<void>((resolve, reject) => {
      let state = states.get(key)
      if (!state) {
        state = { running: false, pending: null }
        states.set(key, state)
      }
      const waiter = { resolve, reject }
      if (state.running) state.pending = { value, waiters: [...(state.pending?.waiters ?? []), waiter] }
      else void run(key, state, { value, waiters: [waiter] })
    })
}
