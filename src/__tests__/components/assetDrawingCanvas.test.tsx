import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AssetDrawingStudio } from '../../editor/custom-element/AssetDrawingStudio'

const hooks = vi.hoisted(() => ({ state: vi.fn(), ref: vi.fn(), effect: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(), useState: hooks.state, useRef: hooks.ref, useEffect: hooks.effect }))
let slots: any[], cursor: number, dirty: boolean, effects: Array<() => void>, tree: React.ReactNode
let props: React.ComponentProps<typeof AssetDrawingStudio>, pixels: Uint8ClampedArray, canvas: any
let lastWidth: number | undefined, lastHeight: number | undefined, sequence: number
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
