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
