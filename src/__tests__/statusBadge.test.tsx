import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StatusBadge } from '../components/common/StatusBadge'

const render = (props: React.ComponentProps<typeof StatusBadge>) =>
  renderToStaticMarkup(React.createElement(StatusBadge, props))

describe('StatusBadge', () => {
  it('shows the status planet and label, with no colored dot', () => {
    const html = render({ status: 'available', label: 'Disponível' })
    expect(html).toContain('alt="Disponível (Terra)"')
    expect(html).toContain('Disponível')
    expect(html).not.toContain('bg-emerald-400')
  })

  it('uses the image of each status', () => {
    expect(render({ status: 'busy', label: 'Ocupado' })).toContain('alt="Ocupado (Marte)"')
    expect(render({ status: 'away', label: 'Ausente' })).toContain('alt="Ausente (Lua dourada)"')
    expect(render({ status: 'focusing', label: 'Em foco' })).toContain(
      'alt="Em foco (Lua e silêncio)"'
    )
  })

  it('shows a custom status text next to the image', () => {
    const html = render({ status: 'busy', label: 'Em reunião' })
    expect(html).toContain('Em reunião')
    expect(html).toContain('alt="Ocupado (Marte)"')
  })

  it('falls back to the status name when no text is given', () => {
    expect(render({ status: 'focusing' })).toContain('Em foco')
  })

  it('renders offline with the offline mark and label', () => {
    const html = render({ status: 'offline' })
    expect(html).toContain('aria-label="Offline"')
    expect(html).toContain('Offline')
    expect(html).toContain('bg-slate-800')
    expect(html).not.toContain('<img')
  })
})
