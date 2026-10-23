import { beforeEach, describe, expect, it, vi } from 'vitest'

// Exercise hook events and commit effects without opening the app or a browser.
const runtime = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[] }))
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
    if (!previous || deps.some((dep, i) => dep !== previous[i])) runtime.effects.push(effect)
    runtime.slots[index] = deps
  },
}))

import { useChatPagination } from '../../hooks/useChatPagination'

const messages = Array.from({ length: 123 }, (_, i) => ({ id: `${i + 1}` }))
let container: { scrollTop: number; scrollHeight: number; clientHeight: number }
function render(items = messages, channel = 'general') {
  runtime.cursor = 0
  const hook = useChatPagination(items, channel)
  ;(hook.messagesRef as any).current = container
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
  container = { scrollTop: 0, scrollHeight: 2000, clientHeight: 400 }
})

describe('automatic chat pagination', () => {
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
