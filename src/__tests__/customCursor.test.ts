import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { fileURLToPath } from 'url'

// The app draws its own mouse cursor: a faceted arrow, the arrow with a ring at its tip (link), the
// arrow with a clock (busy) and an I-beam (text), in src/assets/cursors/*.svg, declared once as CSS
// variables in src/styles/cursors.css. Tailwind's cursor-default / cursor-pointer / cursor-wait /
// cursor-text and the base rules read those variables. These tests keep the pieces wired together, and
// keep the images something the browser will actually use as a cursor.

const read = (relative: string) => fs.readFileSync(fileURLToPath(new URL(`../../${relative}`, import.meta.url)), 'utf-8')
const css = read('src/styles/cursors.css')

// Chromium draws a cursor image bigger than 32x32 only while it stays inside the page, and falls back
// to the keyword at the edge of the window; the cursors have to fit in 32x32 to always show.
const MAX_CURSOR_SIZE = 32

const declaration = (name: 'default' | 'pointer' | 'wait' | 'text') => {
  const match = css.match(new RegExp(`--cursor-${name}:\\s*url\\('\\.\\./assets/cursors/([\\w-]+\\.svg)'\\)\\s+(\\d+)\\s+(\\d+),\\s*([\\w-]+);`))
  if (!match) throw new Error(`--cursor-${name} is not declared as: url('../assets/cursors/<file>.svg') <x> <y>, <keyword>;`)
  const [, file, x, y, fallback] = match
  return { file, hotspot: [Number(x), Number(y)], fallback }
}

describe.each([
  { name: 'default' as const, fallback: 'default', isArrow: true },
  { name: 'pointer' as const, fallback: 'pointer', isArrow: true },
  { name: 'wait' as const, fallback: 'wait', isArrow: true },
  { name: 'text' as const, fallback: 'text', isArrow: false },
])('the $name cursor', ({ name, fallback, isArrow }) => {
  const { file, hotspot, fallback: declaredFallback } = declaration(name)
  const svg = read(`src/assets/cursors/${file}`)
  const width = Number(svg.match(/<svg[^>]*\swidth="(\d+)"/)?.[1])
  const height = Number(svg.match(/<svg[^>]*\sheight="(\d+)"/)?.[1])

  it('is an SVG with a size of its own, which the browser needs to use it as a cursor', () => {
    expect(svg).toMatch(/^<svg\b/)
    expect(width).toBeGreaterThan(0)
    expect(height).toBeGreaterThan(0)
  })

  it(`fits in ${MAX_CURSOR_SIZE}x${MAX_CURSOR_SIZE}`, () => {
    expect(width).toBeLessThanOrEqual(MAX_CURSOR_SIZE)
    expect(height).toBeLessThanOrEqual(MAX_CURSOR_SIZE)
  })

  it('has its hotspot inside the image', () => {
    expect(hotspot[0]).toBeLessThan(width)
    expect(hotspot[1]).toBeLessThan(height)
  })

  it.runIf(isArrow)('has the hotspot on the tip of the arrow, where the three arrows share it', () => {
    expect(hotspot).toEqual(declaration('default').hotspot)
  })

  it.runIf(!isArrow)('has the hotspot in the middle of the I-beam, where the system one has it', () => {
    expect(hotspot).toEqual([width / 2, height / 2])
  })

  it('falls back to the system cursor of the same kind if the image does not load', () => {
    expect(declaredFallback).toBe(fallback)
  })
})

describe('where the cursors are used', () => {
  it('index.css loads them', () => {
    expect(read('src/index.css')).toContain("@import './styles/cursors.css'")
  })

  it('makes them Tailwind\'s cursor-default, cursor-pointer, cursor-wait and cursor-text, so the markup needs no change', () => {
    const config = read('tailwind.config.js')
    expect(config).toContain("default: 'var(--cursor-default)'")
    expect(config).toContain("pointer: 'var(--cursor-pointer)'")
    expect(config).toContain("wait: 'var(--cursor-wait)'")
    expect(config).toContain("text: 'var(--cursor-text)'")
  })

  it('puts the arrow on the whole app and the link cursor on buttons and links', () => {
    expect(css).toMatch(/html\s*{\s*cursor:\s*var\(--cursor-default\);/)
    expect(css).toMatch(/button,\s*\[role='button'\],\s*a\[href\]\s*{\s*cursor:\s*var\(--cursor-pointer\);/)
  })

  it('puts the I-beam on text fields: textarea, editable text and every input that is not a button-like control', () => {
    const selectors = css.match(/([^{}]*){\s*cursor:\s*var\(--cursor-text\);/)?.[1] ?? ''
    expect(selectors).toMatch(/\btextarea\b/)
    expect(selectors).toContain('[contenteditable]')
    expect(selectors).toContain('.select-text')
    // the inputs are picked by what they are not, so text, search, email, password, number... and an
    // input with no type at all get it
    const excluded = selectors.match(/input:where\(:not\(([^)]*)\)\)/)?.[1] ?? ''
    for (const type of ['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset', 'image', 'hidden']) {
      expect(excluded).toContain(`[type='${type}']`)
    }
    for (const type of ['text', 'search', 'email', 'password', 'number', 'url', 'tel']) {
      expect(excluded).not.toContain(`[type='${type}']`)
    }
  })

  it('has disabled controls show the arrow, not the I-beam or the link cursor, so that rule comes last', () => {
    expect(css).toMatch(/:disabled\s*{\s*cursor:\s*var\(--cursor-default\);/)
    const disabled = css.indexOf(':disabled {')
    expect(disabled).toBeGreaterThan(css.indexOf('cursor: var(--cursor-text);'))
    expect(disabled).toBeGreaterThan(css.indexOf('cursor: var(--cursor-pointer);', css.indexOf('@layer base')))
  })

  it('gives the link cursor to selects too', () => {
    expect(read('src/styles/forms.css')).toMatch(/select\s*{[^}]*cursor:\s*var\(--cursor-pointer\);/)
  })
})
