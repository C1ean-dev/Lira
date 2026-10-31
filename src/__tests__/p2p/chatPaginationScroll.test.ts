import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Exercise hook events and commit effects without opening the app or a browser.
const runtime = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as any[] }))
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = runtime.cursor++
    if (!(index in runtime.slots)) runtime.slots[index] = initial
    return [runtime.slots[index], (next: unknown) => { runtime.slots[index] = next }]
  },
  useRef: (initial: unknown) => {
    const index = runtime.cursor++
    return runtime.slots[index] ??= { current: initial }
  },
  useLayoutEffect: (effect: () => void, deps: unknown[]) => {
    const index = runtime.cursor++
    const previous = runtime.slots[index]
    if (!previous || deps.some((dep, i) => dep !== previous[i])) runtime.effects.push(() => {
      runtime.cleanups[index]?.()
      runtime.cleanups[index] = effect()
    })
    runtime.slots[index] = deps
  },
}))

import { useChatPagination } from '../../hooks/useChatPagination'

const messages = Array.from({ length: 123 }, (_, i) => ({ id: `${i + 1}` }))
let container: { scrollTop: number; scrollHeight: number; clientHeight: number }
let observers: { callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[]
const content = {}
function render(items = messages, channel = 'general') {
  runtime.cursor = 0
  const hook = useChatPagination(items, channel)
  ;(hook.messagesRef as any).current = container
  if ('contentRef' in hook) (hook.contentRef as any).current = content
  runtime.effects.splice(0).forEach((effect) => effect())
  return hook
}
function scroll(hook: ReturnType<typeof render>, top: number) {
  container.scrollTop = top
  hook.onScroll({ currentTarget: container } as any)
}

beforeEach(() => {
  runtime.slots = []
  runtime.effects = []
  runtime.cleanups = []
  observers = []
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn()
    disconnect = vi.fn()
    constructor(public callback: () => void) { observers.push(this) }
  })
  container = { scrollTop: 0, scrollHeight: 2000, clientHeight: 400 }
})

afterEach(() => {
  runtime.cleanups.forEach(cleanup => cleanup?.())
  vi.unstubAllGlobals()
})

describe('automatic chat pagination', () => {
  it('stays at the exact bottom when an image loads after opening', () => {
    render()
    expect(observers.length).toBeGreaterThan(0)
    expect(observers.at(-1)!.observe).toHaveBeenCalledWith(content)
    container.scrollHeight += 300
    observers.at(-1)!.callback()
    expect(container.scrollTop).toBe(1900)
  })

  it('keeps the bottom visible when the viewport shrinks', () => {
    const hook = render()
    expect(observers.length).toBeGreaterThan(0)
    expect(observers.at(-1)!.observe).toHaveBeenCalledWith(container)
    container.clientHeight = 200
    hook.onScroll({ currentTarget: container } as any)
    observers.at(-1)!.callback()
    expect(container.scrollTop).toBe(1800)
  })

  it('does not pull the reader down when reading earlier messages', () => {
    const hook = render()
    scroll(hook, 600)
    container.scrollHeight += 300
    expect(observers.length).toBeGreaterThan(0)
    observers.at(-1)!.callback()
    expect(container.scrollTop).toBe(600)
    render([...messages, { id: '124' }])
    expect(container.scrollTop).toBe(600)
  })

  it('resumes following after scrolling back to the bottom and cleans up on channel changes', () => {
    const hook = render()
    scroll(hook, 600)
    scroll(hook, 1600)
    expect(observers.length).toBeGreaterThan(0)
    const previous = observers.at(-1)!
    container.scrollHeight += 300
    previous.callback()
    expect(container.scrollTop).toBe(1900)
    render(messages, 'another')
    expect(previous.disconnect).toHaveBeenCalled()
  })

  it('opens at the bottom and loads the previous 50 when scrolling to the top', () => {
    let hook = render()
    expect(container.scrollTop).toBe(1600)
    scroll(hook, 0)
    hook = render()
    expect(hook.page.messages).toEqual(messages.slice(23, 73))
    expect(container.scrollTop).toBe(1599)
    scroll(hook, 0)
    hook = render()
    expect(hook.page.messages).toEqual(messages.slice(0, 23))
  })

  it('loads newer messages at the bottom and starts that batch at the top', () => {
    let hook = render()
    scroll(hook, 0)
    hook = render()
    scroll(hook, 1600)
    hook = render()
    expect(hook.page.messages).toEqual(messages.slice(73))
    expect(container.scrollTop).toBe(1)
  })

  it('does not change batches in the middle or process duplicate edge events', () => {
    let hook = render()
    scroll(hook, 500)
    expect(render().page.messages).toEqual(messages.slice(73))
    scroll(hook, 0)
    scroll(hook, 0)
    hook = render()
    expect(hook.page.messages).toEqual(messages.slice(23, 73))
  })

  it('keeps historical messages stable on arrival and resets when switching channels', () => {
    let hook = render()
    scroll(hook, 0)
    hook = render()
    container.scrollTop = 600
    hook = render([...messages, { id: '124' }])
    expect(hook.page.messages).toEqual(messages.slice(23, 73))
    expect(container.scrollTop).toBe(600)
    hook = render(messages.slice(0, 51), 'other')
    expect(hook.page.messages).toEqual(messages.slice(1, 51))
    expect(container.scrollTop).toBe(1600)
  })

  it('discards a pending history navigation when opening another conversation', () => {
    const hook = render()
    scroll(hook, 0)
    render(messages, 'other')
    expect(container.scrollTop).toBe(1600)
  })

  it('allows returning from a short batch that does not fill the viewport', () => {
    let hook = render(messages.slice(0, 51))
    scroll(hook, 0)
    container.scrollHeight = 100
    hook = render(messages.slice(0, 51))
    hook.onWheel({ currentTarget: container, deltaY: 100 } as any)
    hook = render(messages.slice(0, 51))
    expect(hook.page.messages).toEqual(messages.slice(1, 51))
  })
})
