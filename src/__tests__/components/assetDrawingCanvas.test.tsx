import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AssetDrawingStudio } from '../../editor/custom-element/AssetDrawingStudio'

const hooks = vi.hoisted(() => ({ state: vi.fn(), ref: vi.fn(), effect: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: hooks.state, useRef: hooks.ref, useEffect: hooks.effect }))
let slots: any[], cursor: number, dirty: boolean, effects: Array<() => void>, tree: React.ReactNode
let props: React.ComponentProps<typeof AssetDrawingStudio>, pixels: Uint8ClampedArray, canvas: any
let lastWidth: number | undefined, lastHeight: number | undefined, sequence: number
let viewport: any, listeners: Map<string, (event: any) => void>
const changes = vi.fn()
function elements(node: React.ReactNode): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!React.isValidElement(node)) return []
  return [node, ...elements(node.props.children)]
}
function render() {
  for (let pass = 0; pass < 20; pass++) {
    cursor = 0; dirty = false; effects = []
    tree = AssetDrawingStudio(props)
    const element = elements(tree).find(node => node.type === 'canvas')!
    ;(element as any).ref.current = canvas
    const area = elements(tree).find(node => node.props['aria-label'] === 'Área de navegação do desenho')
    if (area) (area as any).ref.current = viewport
    // Like the DOM, changing either intrinsic canvas dimension clears its pixels.
    if (element.props.width !== lastWidth) { canvas.width = element.props.width; lastWidth = element.props.width }
    if (element.props.height !== lastHeight) { canvas.height = element.props.height; lastHeight = element.props.height }
    effects.forEach(effect => effect())
    if (!dirty) return
  }
  throw new Error('Drawing canvas did not settle')
}
beforeEach(() => {
  slots = []; lastWidth = undefined; lastHeight = undefined; sequence = 0; changes.mockClear()
  hooks.state.mockImplementation((initial: any) => {
    const index = cursor++
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
    return [slots[index], (value: any) => { const next = typeof value === 'function' ? value(slots[index]) : value; if (!Object.is(next, slots[index])) { slots[index] = next; dirty = true } }]
  })
  hooks.ref.mockImplementation((initial: any) => { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) })
  hooks.effect.mockImplementation((effect: () => void, deps: any[]) => {
    const index = cursor++, previous = slots[index]
    if (!previous || deps.some((value, i) => !Object.is(value, previous[i]))) { slots[index] = deps; effects.push(effect) }
  })
  vi.stubGlobal('ImageData', class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} })
  let width = 5, height = 5
  pixels = new Uint8ClampedArray(100)
  const context = { putImageData: (image: ImageData) => { pixels = image.data.slice() }, getImageData: () => ({ data: pixels.slice() }), imageSmoothingEnabled: false }
  canvas = { get width() { return width }, set width(value: number) { width = value; pixels = new Uint8ClampedArray(width * height * 4) },
    get height() { return height }, set height(value: number) { height = value; pixels = new Uint8ClampedArray(width * height * 4) },
    getContext: () => context, getBoundingClientRect: () => ({ left: 0, top: 0, width, height }), focus: vi.fn(), setPointerCapture: vi.fn(),
    toDataURL: () => `png-${++sequence}`,
  }
  listeners = new Map()
  viewport = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }), clientWidth: 640, clientHeight: 480,
    addEventListener: vi.fn((name, callback) => listeners.set(name, callback)), removeEventListener: vi.fn(),
    focus: vi.fn(), setPointerCapture: vi.fn(),
  }
  props = { width: 5, height: 5, onChange: edit => { changes(edit); props = { ...props, width: edit.width, height: edit.height, source: edit.dataUrl } } }
  render()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('keeps trimmed pixels visible when the shared document updates the canvas dimensions', () => {
  const node = () => elements(tree).find(element => element.type === 'canvas')!
  node().props.onPointerDown({ button: 0, pointerId: 1, clientX: 2, clientY: 1, currentTarget: canvas })
  node().props.onPointerUp(); render()
  elements(tree).find(element => element.type === 'button' && Array.isArray(element.props.children) && element.props.children.includes('Aparar bordas'))!.props.onClick()
  render()
  expect(canvas.width).toBe(1)
  expect(canvas.height).toBe(1)
  expect(pixels[3]).toBe(255)
})
it('does not create a blank drawing when undo is pressed with an empty history', () => {
  elements(tree).find(element => element.type === 'section')!.props.onKeyDown({ ctrlKey: true, key: 'z', target: { tagName: 'CANVAS' }, preventDefault: vi.fn(), stopPropagation: vi.fn() })
  expect(changes).not.toHaveBeenCalled()
})

it('zooms with the mouse wheel without scrolling the page or changing pixels', () => {
  const wheel = listeners.get('wheel')
  expect(wheel).toBeTypeOf('function')
  expect(viewport.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false })
  const bitmap = () => elements(tree).find(node => node.type === 'canvas')!
  const before = bitmap().props.style.width
  const preventDefault = vi.fn()
  wheel!({ deltaY: 120, deltaMode: 0, clientX: 320, clientY: 240, preventDefault })
  render()
  expect(bitmap().props.style.width).toBeLessThan(before)
  expect(preventDefault).toHaveBeenCalled()
  expect(changes).not.toHaveBeenCalled()
})

it('pans the view with the right button, including right-button chords during a left-button stroke', () => {
  const area = () => elements(tree).find(node => node.props['aria-label'] === 'Área de navegação do desenho')!
  const board = () => elements(tree).find(node => node.props['data-pixel-board'])!
  expect(area()).toBeDefined()
  const x = board().props.style.left
  const event = (clientX: number, buttons: number, button = 2) => ({ button, buttons, pointerId: 1, clientX, clientY: 200, currentTarget: viewport, preventDefault: vi.fn(), stopPropagation: vi.fn() })
  area().props.onPointerDownCapture(event(100, 2))
  area().props.onPointerMoveCapture(event(160, 2)); render()
  expect(board().props.style.left).toBe(x + 60)
  area().props.onPointerUp(event(160, 0)); render()
  expect(changes).not.toHaveBeenCalled()
  // Extra mouse buttons do not dispatch a second pointerdown: navigation must
  // also inspect the buttons bitmask on pointermove while left is held.
  area().props.onPointerDownCapture(event(160, 1, 0))
  area().props.onPointerMoveCapture(event(180, 3)); render()
  expect(board().props.style.left).toBe(x + 80)
  expect(changes).not.toHaveBeenCalled()
  const menu = event(180, 0)
  area().props.onContextMenu(menu)
  expect(menu.preventDefault).toHaveBeenCalled()
})

it('fits the available viewport initially and offers a command to restore the fit', () => {
  const bitmap = () => elements(tree).find(node => node.type === 'canvas')!
  expect(bitmap().props.style.width).toBeGreaterThan(100)
  const button = elements(tree).find(node => node.props['aria-label'] === 'Ajustar desenho à área')
  expect(button).toBeDefined()
  button!.props.onClick(); render()
  expect(changes).not.toHaveBeenCalled()
})

it('resumes drawing after a right-button pan without painting the path of the camera', () => {
  const area = () => elements(tree).find(node => node.props['aria-label'] === 'Área de navegação do desenho')!
  const board = () => elements(tree).find(node => node.props['data-pixel-board'])!
  const node = () => elements(tree).find(element => element.type === 'canvas')!
  const scale = node().props.style.width / 5
  const x = board().props.style.left + 1.5 * scale, y = board().props.style.top + 1.5 * scale
  const event = (clientX: number, buttons: number, target = viewport) => ({ button: 0, buttons, pointerId: 1, clientX, clientY: y, currentTarget: target, preventDefault: vi.fn(), stopPropagation: vi.fn() })
  area().props.onPointerDownCapture(event(x, 1))
  node().props.onPointerDown(event(x, 1, canvas))
  area().props.onPointerMoveCapture(event(x + 20, 3)); render()
  expect(changes).not.toHaveBeenCalled()
  area().props.onPointerMoveCapture(event(x + 20 + scale, 1))
  node().props.onPointerMove(event(x + 20 + scale, 1, canvas))
  node().props.onPointerUp(); render()
  expect(changes).toHaveBeenCalledTimes(1)
  expect(pixels[(1 * 5 + 1) * 4 + 3]).toBe(255)
  expect(pixels[(1 * 5 + 2) * 4 + 3]).toBe(255)
  expect(pixels[3]).toBe(0)
})
