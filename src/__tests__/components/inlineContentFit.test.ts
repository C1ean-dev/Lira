import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  useEffect: (effect: () => void, deps: unknown[]) => {
    const index = runtime.cursor++
    const previous = runtime.slots[index]
    if (!previous || deps.some((dep, i) => dep !== previous[i])) runtime.effects.push(() => {
      runtime.cleanups[index]?.()
      runtime.cleanups[index] = effect()
    })
    runtime.slots[index] = deps
  },
}))

import { useInlineContentFit } from '../../hooks/useInlineContentFit'

let available: number
let badgeWidth: number
let extraControlWidth: number
let observers: { callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[]
let button: any
let container: any
let content: any

function render(enabled = true, version = 'servers') {
  runtime.cursor = 0
  const hook = useInlineContentFit(enabled, version)
  // Showing the badges adds their width plus the button's 6px gap.
  button.offsetWidth = 90 + (hook.fits ? badgeWidth + 6 : 0)
  ;(hook.containerRef as any).current = container
  ;(hook.contentRef as any).current = content
  runtime.effects.splice(0).forEach(effect => effect())
  return hook
}

beforeEach(() => {
  runtime.slots = []; runtime.effects = []; runtime.cleanups = []
  available = 700; badgeWidth = 240; extraControlWidth = 0; observers = []
  const control = { get offsetWidth() { return 300 + extraControlWidth }, getClientRects: () => [{}] }
  button = { getClientRects: () => [{}] }
  container = { children: [control, button], get clientWidth() { return available } }
  content = { parentElement: button, get offsetWidth() { return badgeWidth } }
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('getComputedStyle', (node: unknown) => ({ columnGap: node === container ? '12px' : '6px', paddingLeft: '0px', paddingRight: '0px' }))
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn()
    disconnect = vi.fn()
    constructor(public callback: () => void) { observers.push(this) }
  })
})
afterEach(() => {
  runtime.cleanups.forEach(cleanup => cleanup?.())
  vi.unstubAllGlobals()
})

describe('publication badges fit the actual navigation space', () => {
  it('shows the servers when the controls and badges fit, without a viewport breakpoint', () => {
    render()
    expect(render().fits).toBe(true)
  })

  it('hides the group when it would overlap other controls and restores it after resizing', () => {
    available = 600
    render()
    expect(render().fits).toBe(false)
    available = 700
    observers.at(-1)!.callback()
    expect(render().fits).toBe(true)
    available = 600
    observers.at(-1)!.callback()
    expect(render().fits).toBe(false)
  })

  it('accounts for gaps and allows an exact fit without oscillating', () => {
    available = 300 + 12 + 90 + 6 + badgeWidth
    render()
    expect(render().fits).toBe(true)
    observers.at(-1)!.callback()
    expect(render().fits).toBe(true)
    available -= 1
    observers.at(-1)!.callback()
    expect(render().fits).toBe(false)
  })

  it('rechecks when a reconnect indicator or longer server names consume more space', () => {
    render()
    expect(render().fits).toBe(true)
    extraControlWidth = 120
    observers.at(-1)!.callback()
    expect(render().fits).toBe(false)
    extraControlWidth = 0; badgeWidth = 320
    render(true, 'longer server names')
    expect(render(true, 'longer server names').fits).toBe(false)
    badgeWidth = 100
    observers.at(-1)!.callback()
    expect(render().fits).toBe(true)
  })

  it('observes the controls and badges and disconnects when publication is disabled', () => {
    render()
    const observer = observers.at(-1)!
    for (const node of [container, ...container.children, content]) expect(observer.observe).toHaveBeenCalledWith(node)
    render(false)
    expect(observer.disconnect).toHaveBeenCalled()
    expect(render(false).fits).toBe(false)
  })
})
