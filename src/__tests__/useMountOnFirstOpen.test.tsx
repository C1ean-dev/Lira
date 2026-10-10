import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useMountOnFirstOpen, nextMounted } from '../hooks/useMountOnFirstOpen'

const Probe: React.FC<{ open: boolean }> = ({ open }) => {
  const mounted = useMountOnFirstOpen(open)
  return React.createElement('span', null, mounted ? 'mounted' : 'not mounted')
}

describe('nextMounted', () => {
  it('turns on when the modal opens and never turns off again', () => {
    expect(nextMounted(false, false)).toBe(false)
    expect(nextMounted(false, true)).toBe(true)
    expect(nextMounted(true, true)).toBe(true)
    expect(nextMounted(true, false)).toBe(true)
  })
})

describe('useMountOnFirstOpen', () => {
  it('does not mount a modal that was never opened', () => {
    expect(renderToStaticMarkup(React.createElement(Probe, { open: false }))).toContain('not mounted')
  })

  it('mounts it in the same render in which it opens (no frame without it)', () => {
    expect(renderToStaticMarkup(React.createElement(Probe, { open: true }))).toContain('>mounted<')
  })
})
