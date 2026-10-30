import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MentionSuggestions } from '../../components/chat/MentionSuggestions'

describe('mention suggestions', () => {
  it('distinguishes people and pets with identical names', () => {
    const html = renderToStaticMarkup(<MentionSuggestions selectedIndex={0} onSelect={vi.fn()} candidates={[
      { kind: 'person', id: 'ana', name: 'Mingau' },
      { kind: 'pet', id: 'pet1', name: 'Mingau', ownerName: 'Ana' },
      { kind: 'pet', id: 'pet2', name: 'Mingau', ownerName: 'Bia' },
    ]} />)
    expect(html).toContain('Pessoa')
    expect(html).toContain('Pet de Ana')
    expect(html).toContain('Pet de Bia')
    expect(html).toContain('role="listbox"')
  })
})
