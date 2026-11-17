import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const runtime = vi.hoisted(() => ({ slots: [] as any[], cursor: 0, effects: [] as (() => void)[], cleanups: [] as any[] }))
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    const index = runtime.cursor++
    if (!(index in runtime.slots)) {
      runtime.slots[index] = typeof initial === 'function' ? (initial as Function)() : initial
    }
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

import { useHeaderActionsFit } from '../../hooks/useHeaderActionsFit'

let available: number
let leftOccupiedWidth: number
let actionsWidth: number
let observers: { callback: () => void; observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[]
let headerNode: any
let leftNode: any
let actionsNode: any

function render(enabled = true, buffer = 12) {
  runtime.cursor = 0
  const hook = useHeaderActionsFit({ enabled, buffer })
  ;(hook.headerRef as any).current = headerNode
  ;(hook.leftRef as any).current = leftNode
  ;(hook.actionsRef as any).current = actionsNode
  runtime.effects.splice(0).forEach(effect => effect())
  runtime.cursor = 0
  return useHeaderActionsFit({ enabled, buffer })
}

beforeEach(() => {
  runtime.slots = []; runtime.effects = []; runtime.cleanups = []
  available = 1240; leftOccupiedWidth = 600; actionsWidth = 380; observers = []
  const leftChild = {
    get offsetWidth() { return leftOccupiedWidth },
    getClientRects: () => [{}],
  }
  leftNode = {
    children: [leftChild],
    get clientWidth() { return available - actionsWidth },
  }
  actionsNode = {
    get offsetWidth() { return actionsWidth },
    get scrollWidth() { return actionsWidth },
    getClientRects: () => [{}],
  }
  headerNode = {
    get clientWidth() { return available },
    querySelector: () => null,
  }
  vi.stubGlobal('window', { innerWidth: 1240, addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('getComputedStyle', (node: unknown) => ({
    columnGap: '8px',
    gap: '8px',
    paddingLeft: '16px',
    paddingRight: '16px',
    position: 'relative',
  }))
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

describe('small header actions fit available space', () => {
  it('keeps small action icons visible when there is enough space in the header', () => {
    available = 1240
    expect(render().fits).toBe(true)
  })

  it('collapses into compact mode when available space shrinks below the required width', () => {
    available = 900 // 900 - 32 = 868 available. Required: 600 + 8 + 380 + 12 = 1000 > 868
    expect(render().fits).toBe(false)
  })

  it('dynamically restores small icons when resized back to larger viewport', () => {
    available = 900
    expect(render().fits).toBe(false)

    available = 1366
    observers.at(-1)!.callback()
    expect(render().fits).toBe(true)
  })

  it('recalculates when left controls consume more space (e.g. reconnecting banner)', () => {
    available = 1050
    expect(render().fits).toBe(true)

    // Left controls consume 150px more
    leftOccupiedWidth += 150
    observers.at(-1)!.callback()
    expect(render().fits).toBe(false)
  })
})
